"""Scoped contextual extraction. Provider calls run outside the JSON write lock."""
from __future__ import annotations

import hashlib
import json
import copy

from app.models.entities import AIDraft
from app.services.ai_outputs import validate_context_extraction
from app.services.ai_service import AIProviderError, get_ai_provider
from app.services.memory_service import context_from_data
from app.services.workflow import DomainError, audit, find, identifier, now, open_shift
from app.services.facility_service import care_eligible, care_state


def _snapshot(data, elder_id, shift_id, scene, user_id, role):
    user = find(data, 'users', user_id, 'staff_not_found')
    if role not in {'admin', 'supervisor', 'caregiver'} or not user.get('active', True) or user['role'] != role:
        raise DomainError('assistant_permissions_changed', 403)
    elder = find(data, 'elders', elder_id, 'elder_not_found')
    if elder.get('status') == 'discharged':
        raise DomainError('elder_inactive')
    care_eligible(data, elder_id)
    open_shift(data, shift_id, user_id, role)
    memories = context_from_data(data, elder_id, scene)
    tasks = [row for row in data['care_tasks'] if row['elder_id'] == elder_id
             and row['status'] in {'pending', 'in_progress', 'not_done', 'overdue'}
             and (shift_id is None or row.get('shift_id') == shift_id)
             and (role != 'caregiver' or row.get('assigned_to') in {None, user_id})]
    if len(memories['memories']) > 30 or len(tasks) > 30:
        raise DomainError('assistant_scope_too_large', 422)
    sources = []
    for row in memories['memories']:
        sources.append({
            'source_id': f'memory/{row["id"]}/v{row["revision"]}', 'kind': 'memory',
            'object_id': row['id'], 'revision': row['revision'], 'text': row['content'],
            'category': row['category'], 'attributed_to': row['attributed_to'],
            'valid_from': row['valid_from'], 'expires_at': row['expires_at'],
            'review_due': row['review_due'],
            'source_record_id': row['source']['record_id'], 'source_record_revision': row['source']['revision'],
        })
    for row in sorted(tasks, key=lambda row: row['id']):
        task_text = {field: row.get(field) for field in
                     ('title', 'status', 'condition', 'due_text', 'due_at', 'reason_code', 'result')}
        if row.get('source_plan_id'):
            from app.services.plan_service import task_state
            task_text['plan_check'] = task_state(data, row, memories['as_of'])
        if row.get('condition'):
            from app.services.task_condition_service import state_from_data
            task_text['condition_check'] = state_from_data(data, row, memories['as_of'])
        if row.get('memory_references'):
            from app.services.task_memory_service import view_from_data
            adopted = view_from_data(data, row, memories['as_of'])
            task_text['memory_reference_checks'] = [{
                'reference_id': ref['id'], 'memory_id': ref['memory_id'], 'used_revision': ref['memory_revision'],
                'current_revision': ref['current']['memory_revision'], 'needs_review': ref['needs_review'],
                'reasons': ref['current']['reasons'],
            } for ref in adopted['references'] if ref['status'] == 'active']
        sources.append({
            'source_id': f'task/{row["id"]}/v{row.get("revision", 1)}', 'kind': 'task',
            'object_id': row['id'], 'revision': row.get('revision', 1),
            'text': json.dumps(task_text, ensure_ascii=False, sort_keys=True),
        })
    shift = find(data, 'shifts', shift_id, 'shift_not_found') if shift_id else None
    from app.services.plan_service import context_sources
    sources.extend(context_sources(data, elder_id, scene, memories['as_of']))
    context = {
        'elder_id': elder_id, 'elder_status': elder.get('status', 'active'), 'scene': scene,
        'elder_care_state': care_state(elder),
        'shift': {field: shift.get(field) for field in ('id', 'name', 'start_at', 'end_at', 'status')} if shift else None,
        'as_of': memories['as_of'], 'sources': sources,
        'coverage': {'care_plans': 'effective_scene_filtered', 'task_scenes': 'not_classified'},
    }
    if any(len(source['text']) > 5000 for source in sources) or len(json.dumps(context, ensure_ascii=False)) > 30000:
        # Never silently truncate a condition or a negation to fit the prompt.
        raise DomainError('assistant_scope_too_large', 422)
    return context


def _fingerprint(context):
    stable = {key: value for key, value in context.items() if key != 'as_of'}
    return hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validate_draft_context(data, draft):
    if draft.get('generation_kind') != 'context_record':
        return
    snapshot = draft.get('context_snapshot')
    if not snapshot:
        raise DomainError('assistant_context_missing')
    current = _snapshot(data, draft['elder_id'], draft.get('shift_id'), snapshot['scene'],
                        snapshot['requested_by'], snapshot['requested_role'])
    if _fingerprint(current) != snapshot['fingerprint']:
        raise DomainError('assistant_context_changed')


def create_draft(store, payload, user_id, role):
    inputs = _snapshot(store.read(), payload.elder_id, payload.shift_id, payload.scene, user_id, role)
    fingerprint = _fingerprint(inputs)
    provider = get_ai_provider()
    output = provider.extract_context(payload.text, copy.deepcopy(inputs))
    try:
        # Validate again at the service boundary, including alternate adapters.
        output = validate_context_extraction(output, payload.text, inputs['sources'], payload.scene)
    except ValueError as exc:
        raise AIProviderError('Invalid contextual extraction or evidence') from exc
    warnings = output['warnings'] + [
        '仅参考当前有效且匹配服务场景的已审批计划；历史提醒和计划安排不是本次已发生事实。',
        '个性化候选须先核对正式记录，再单独提交并经主管确认；临时意愿期限由人填写。',
        '相关待办尚未按服务场景分类，请人工判断与当前服务的关系。',
    ]
    cited = {citation['source_id'] for note in output['context_notes'] for citation in note['citations']}
    if any(source['source_id'] not in cited for source in inputs['sources']):
        warnings.append('AI提醒未覆盖全部输入资料，请同时查看来源清单。')
    if provider.name == 'mock' and not any('演示' in value for value in warnings):
        warnings.append('当前为演示结果，非真实AI推理。')
    draft = AIDraft(
        id=identifier('AI'), elder_id=payload.elder_id, shift_id=payload.shift_id, raw_text=payload.text,
        **{key: value for key, value in output.items() if key != 'warnings'}, warnings=warnings,
        provider=provider.name, created_at=now(), created_by=user_id, generation_kind='context_record',
        context_snapshot={**inputs, 'fingerprint': fingerprint, 'requested_by': user_id, 'requested_role': role},
    )
    def mutate(data):
        validate_draft_context(data, draft.model_dump())
        data['ai_drafts'].append(draft.model_dump())
        audit(data, 'create_ai_draft', draft.id, user_id, elder_id=payload.elder_id, shift_id=payload.shift_id,
              detail='上下文AI生成事实、个性化候选和历史提醒草稿', provider=provider.name,
              scene=payload.scene, context_source_ids=[row['source_id'] for row in inputs['sources']])
    store.mutate(mutate)
    return draft
