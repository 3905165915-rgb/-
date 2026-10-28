"""Human-decided life-care advice. Provider requests never hold the JSON lock.

No diagnosis, automatic long-term memory or automatic scheduling is performed.
Formal task operations keep the existing authorization/condition/handover rules.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import timedelta

from pydantic import ValidationError

from app.models.entities import CareRecord
from app.schemas.care_advice import AdviceOutput
from app.services import assistant_service, memory_service, task_service
from app.services import care_guidance_service as guidance_service
from app.services.ai_service import AIProviderError, get_ai_provider
from app.services.facility_service import care_eligible, care_state
from app.services.workflow import (DomainError, audit, current_staff, find,
                                   identifier, now, open_shift, parse_time, replayable)

PROMPT_VERSION = 'care-advice-2026-10-25-v1'
NOTICE = '建议仅供生活照护参考，可能有误；请核对本人意愿和专业要求，不能替代诊断或专业处置。'


def _hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _access(data, elder_id, user_id, role):
    current_staff(data, user_id, role)
    from app.services.care_scope_service import require_elder_access
    require_elder_access(data, elder_id, user_id, role)


def _context(data, elder_id, payload, user_id, role):
    context = assistant_service._snapshot(data, elder_id, payload.shift_id, payload.scene, user_id, role)
    at = parse_time(context['as_of'])
    cutoff = at - timedelta(days=payload.lookback_days)
    elder = find(data, 'elders', elder_id, 'elder_not_found')
    records = [r for r in data['care_records'] if r['elder_id'] == elder_id
               and r.get('status') in {'confirmed', 'corrected'}
               and r.get('admission_id') == elder.get('current_admission_id')
               and cutoff <= parse_time(r.get('happened_at') or r['created_at']) <= at
               and r.get('observations')]
    records.sort(key=lambda r: (r.get('happened_at') or r['created_at'], r['id']))
    selected = records[-30:]
    for row in selected:
        context['sources'].append({
            'source_id': f'record/{row["id"]}/v{row.get("revision", 1)}', 'kind': 'record',
            'object_id': row['id'], 'revision': row.get('revision', 1),
            'text': '\n'.join(row['observations']),
            'happened_at': row.get('happened_at') or row['created_at'],
            'recorded_at': row['created_at'],
        })
    context['coverage']['recent_records'] = {'window_days': payload.lookback_days,
        'eligible': len(records), 'included': len(selected), 'excluded': len(records)-len(selected),
        'notice': '仅纳入当前入住、非未来的正式记录；最多最近30条。任务和计划不是已发生的服务结果。'}
    if len(json.dumps(context, ensure_ascii=False)) > 50000:
        raise DomainError('advice_scope_too_large', 422)
    return context


def _validate(output, context):
    try:
        result = AdviceOutput.model_validate(output).model_dump()
        lookup = {r['source_id']: r for r in context['sources']}
        for point in result['suggestions']:
            seen = set()
            substantive = False
            for citation in point['citations']:
                source = lookup.get(citation['source_id'])
                key = (citation['source_id'], citation['quote'])
                if not source or citation['quote'] not in source['text'] or key in seen:
                    raise ValueError('Invalid advice citation')
                seen.add(key)
                substantive |= source['kind'] in {'record', 'memory'}
            if not substantive:
                raise ValueError('An arrangement alone is not personal evidence')
            # This is a conservative textual filter, not a clinical safety guarantee.
            text = ' '.join(point[k] or '' for k in ('title', 'action', 'rationale', 'uncertainty', 'condition'))
            if re.search(r'诊断为|确诊|建议(?:服用|停药|加药|减药|增加剂量|减少剂量)|\d+\s*(?:mg|毫克)|心梗预警|脑梗预警', text, re.I):
                raise ValueError('Professional intervention is outside this feature')
        return result['suggestions']
    except (ValidationError, ValueError, TypeError, KeyError) as exc:
        raise AIProviderError('Invalid life-care advice or source evidence') from exc


def _source_state(data, item):
    elder = find(data, 'elders', item['elder_id'], 'elder_not_found')
    reasons = []
    if care_state(elder) != item['elder_state']:
        reasons.append('入住或老人资料已变化')
    for source in item['evidence_sources']:
        kind = source['kind']
        if kind == 'record':
            row = next((r for r in data['care_records'] if r['id'] == source['object_id']), None)
            valid = bool(row and row['elder_id'] == item['elder_id'] and
                row.get('status') in {'confirmed', 'corrected'} and
                row.get('revision', 1) == source['revision'] and
                '\n'.join(row.get('observations', [])) == source['text'])
        elif kind == 'memory':
            row = next((r for r in data['care_memories'] if r['id'] == source['object_id']), None)
            view = memory_service._view(data, row) if row else None
            valid = bool(view and view['elder_id'] == item['elder_id'] and view['effective'] and
                         view['revision'] == source['revision'] and view['content'] == source['text'])
        elif kind == 'task':
            row = next((r for r in data['care_tasks'] if r['id'] == source['object_id']), None)
            valid = bool(row and row['elder_id'] == item['elder_id'] and row.get('revision', 1) == source['revision'])
        else:
            from app.services.plan_service import context_sources
            valid = any(r == source for r in context_sources(data, item['elder_id'], item['scene'], now()))
        if not valid:
            reasons.append('引用依据已更正、失效或状态变化')
    return sorted(set(reasons))


def _feedback_state(data, item):
    result = []
    for row in item['feedback']:
        current = next((r for r in data['care_records'] if r['id'] == row['record_id']), None)
        task = next((r for r in data['care_tasks'] if r['id'] == row['task_id']), None)
        valid = bool(current and current.get('revision', 1) == row['record_revision'] and
                     current.get('status') in {'confirmed', 'corrected'} and task and
                     current.get('observations') == [row['observation']] and
                     task.get('revision', 1) == row['task_revision'] and
                     task.get('status') == row['execution_status'] and
                     task.get('result') == row['task_result'])
        result.append({**copy.deepcopy(row), 'source_current': valid,
                       'current_record_revision': current.get('revision', 1) if current else None,
                       'current_task_revision': task.get('revision', 1) if task else None})
    return result


def _view(data, item):
    result = copy.deepcopy(item)
    result['source_issues'] = _source_state(data, item)
    result['source_current'] = not result['source_issues']
    result['expired'] = parse_time(item['valid_until']) <= parse_time(now())
    result['can_adopt'] = item['status'] == 'proposed' and result['source_current'] and not result['expired']
    result['feedback'] = _feedback_state(data, item)
    # The review token also covers current source state: a correction between
    # opening and submitting the review must not be silently acknowledged.
    collections = {'record': 'care_records', 'memory': 'care_memories',
                   'task': 'care_tasks', 'plan': 'care_plans'}
    source_state = [next((r for r in data[collections[s['kind']]] if r['id'] == s['object_id']), None)
                    for s in item['evidence_sources']]
    result['feedback_fingerprint'] = _hash({'feedback': result['feedback'], 'sources': source_state,
        'source_issues': result['source_issues'],
        'elder_state': care_state(find(data, 'elders', item['elder_id'], 'elder_not_found'))})
    latest = item['reviews'][-1] if item['reviews'] else None
    result['latest_review'] = copy.deepcopy(latest)
    result['needs_review'] = bool(item['status'] == 'adopted' and item['feedback'] and (not latest or
        latest['feedback_fingerprint'] != result['feedback_fingerprint']))
    result['notice'] = NOTICE
    if item.get('task_id'):
        task = find(data, 'care_tasks', item['task_id'], 'task_not_found')
        result['task'] = task_service.task_view(task)
    else:
        result['task'] = None
    if item.get('guidance_id'):
        row = find(data, 'care_guidance', item['guidance_id'], 'guidance_not_found')
        result['guidance'] = guidance_service.view(row)
    return result


def generate(store, elder_id, payload, user_id, role):
    data = store.read()
    context = _context(data, elder_id, payload, user_id, role)
    if not any(s['kind'] in {'memory', 'record'} for s in context['sources']):
        raise DomainError('advice_insufficient_sources', 422)
    provider = get_ai_provider()
    model = getattr(provider, 'model', provider.name)
    fingerprint = assistant_service._fingerprint(context)
    def cached(data):
        return next((r for r in reversed(data['care_advice_batches']) if r['elder_id'] == elder_id and
            r['created_by'] == user_id and r['role'] == role and r['fingerprint'] == fingerprint and
            r['provider'] == provider.name and r['model'] == model and
            r['prompt_version'] == PROMPT_VERSION and parse_time(r['valid_until']) > parse_time(now())), None)
    def response(data, batch):
        return {'batch_id': batch['id'], 'coverage': batch['coverage'], 'model_status': batch['model_status'],
            'provider': batch['provider'], 'model': batch['model'], 'prompt_version': batch['prompt_version'],
            'items': [_view(data, r) for r in data['care_advice'] if r['batch_id'] == batch['id']],
            'notice': NOTICE}
    previous = cached(data)
    if previous:
        return response(data, previous)
    output = provider.care_advice(copy.deepcopy(context))
    points = _validate(output, context)
    stamp = now()
    until = (parse_time(stamp) + timedelta(hours=24)).isoformat()
    def save(current):
        fresh = _context(current, elder_id, payload, user_id, role)
        if assistant_service._fingerprint(fresh) != fingerprint:
            raise DomainError('advice_context_changed')
        previous = cached(current)
        if previous:
            return response(current, previous)
        batch = {'id': identifier('ADVICESET'), 'elder_id': elder_id, 'created_by': user_id,
                 'role': role, 'fingerprint': fingerprint, 'provider': provider.name,
                 'model': model, 'prompt_version': PROMPT_VERSION,
                 'model_status': 'demo' if provider.name == 'mock' else 'available',
                 'coverage': context['coverage'], 'created_at': stamp, 'valid_until': until}
        current['care_advice_batches'].append(batch)
        for point in points:
            ids = {c['source_id'] for c in point['citations']}
            item = {'id': identifier('ADVICE'), 'batch_id': batch['id'], 'elder_id': elder_id,
                'scene': payload.scene, 'shift_id': payload.shift_id, **point,
                'status': 'proposed', 'revision': 1, 'task_id': None, 'feedback': [], 'reviews': [],
                'created_at': stamp, 'created_by': user_id, 'valid_until': until,
                'provider': provider.name, 'model': model, 'prompt_version': PROMPT_VERSION,
                'model_status': batch['model_status'], 'elder_state': care_state(care_eligible(current, elder_id)),
                'evidence_sources': [copy.deepcopy(s) for s in context['sources'] if s['source_id'] in ids]}
            current['care_advice'].append(item)
            audit(current, 'generate_care_advice', item['id'], user_id, elder_id=elder_id, scene=payload.scene)
        return response(current, batch)
    return store.mutate(save)


def listing(store, elder_id, user_id, role, scene=None, status=None, limit=50, offset=0):
    data = store.read()
    _access(data, elder_id, user_id, role)
    items = [r for r in data['care_advice'] if r['elder_id'] == elder_id and
             (scene is None or r['scene'] == scene) and (status is None or r['status'] == status)]
    items.sort(key=lambda r: (r['created_at'], r['id']), reverse=True)
    return {'total': len(items), 'items': [_view(data, r) for r in items[offset:offset+limit]], 'notice': NOTICE,
            'supported_content_types': guidance_service.SUPPORTED_CONTENT_TYPES}


def _item(data, elder_id, advice_id, user_id, role):
    _access(data, elder_id, user_id, role)
    item = find(data, 'care_advice', advice_id, 'advice_not_found')
    if item['elder_id'] != elder_id:
        raise DomainError('advice_not_found', 404)
    return item


def detail(store, elder_id, advice_id, user_id, role):
    data = store.read()
    return _view(data, _item(data, elder_id, advice_id, user_id, role))


def adopt(store, elder_id, advice_id, payload, user_id, role, key=None):
    if payload.content_type != 'followup_task':
        guidance_service.require_key(key)
    def mutate(data):
        item = _item(data, elder_id, advice_id, user_id, role)
        def operation():
            if item['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if not _view(data, item)['can_adopt']:
                raise DomainError('advice_requires_refresh')
            if payload.content_type != 'followup_task':
                if item['condition'] and payload.condition != item['condition']:
                    raise DomainError('advice_condition_must_be_preserved', 422)
                fields = {'title', 'content_type', 'condition'} | (
                    {'scene', 'instruction'} if payload.content_type == 'routine_hint' else {'occasion', 'record_what'})
                line = payload.model_dump(include=fields)
                guidance = guidance_service.create(data, elder_id, line, user_id, role,
                    service_date=payload.service_date, source_advice=item)
                item.update(status='adopted', content_type=payload.content_type, guidance_id=guidance['id'],
                            revision=item['revision']+1, adopted_at=now(), adopted_by=user_id,
                            adoption_reason=payload.reason, adopted_action=payload.title)
                audit(data, 'adopt_care_advice', advice_id, user_id, elder_id=elder_id,
                      guidance_id=guidance['id'], detail=payload.reason)
                return _view(data, item)
            if payload.task.elder_id != elder_id or payload.task.source_type != 'manual':
                raise DomainError('advice_task_object_mismatch', 422)
            if item['condition'] and item['condition'] != payload.task.condition:
                raise DomainError('advice_condition_must_be_preserved', 422)
            task = task_service.create_from_data(data, payload.task, user_id, role, advice_id=advice_id)
            item.update(status='adopted', task_id=task['id'], revision=item['revision']+1,
                        adopted_at=now(), adopted_by=user_id, adoption_reason=payload.reason,
                        adopted_action=payload.task.title)
            audit(data, 'adopt_care_advice', advice_id, user_id, elder_id=elder_id,
                  task_id=task['id'], detail=payload.reason)
            return _view(data, item)
        return replayable(data, user_id, 'adopt_care_advice', key,
                          {'advice_id': advice_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def reject(store, elder_id, advice_id, payload, user_id, role, key=None):
    def mutate(data):
        item = _item(data, elder_id, advice_id, user_id, role)
        def operation():
            if item['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if item['status'] != 'proposed':
                raise DomainError('advice_not_proposed')
            item.update(status='rejected', revision=item['revision']+1, rejected_by=user_id,
                        rejected_at=now(), rejection_reason=payload.reason)
            audit(data, 'reject_care_advice', advice_id, user_id, elder_id=elder_id, detail=payload.reason)
            return _view(data, item)
        return replayable(data, user_id, 'reject_care_advice', key,
                          {'advice_id': advice_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def assert_task_ready(data, task):
    if not task.get('source_advice_id'):
        return
    item = find(data, 'care_advice', task['source_advice_id'], 'advice_not_found')
    if item['elder_id'] != task['elder_id'] or item['task_id'] != task['id'] or _source_state(data, item):
        raise DomainError('advice_source_changed')
    if item['reviews'] and item['reviews'][-1]['decision'] in {'stop', 'adjust'}:
        raise DomainError('advice_trial_paused')


def feedback(store, elder_id, advice_id, payload, user_id, role, key=None):
    def mutate(data):
        item = _item(data, elder_id, advice_id, user_id, role)
        def operation():
            if item['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if item['status'] != 'adopted':
                raise DomainError('advice_not_adopted')
            if not item.get('task_id'):
                raise DomainError('advice_feedback_use_guidance', 422)
            task = find(data, 'care_tasks', item['task_id'], 'task_not_found')
            task_service.actor_can_execute(task, user_id, role)
            if task.get('revision', 1) != payload.expected_task_revision:
                raise DomainError('stale_revision')
            if task['status'] not in {'completed', 'not_done'}:
                raise DomainError('advice_feedback_needs_task_result')
            if any(r['task_revision'] == task.get('revision', 1) and r['source_current']
                   for r in _feedback_state(data, item)):
                raise DomainError('advice_feedback_already_saved')
            elder = care_eligible(data, elder_id)
            open_shift(data, payload.shift_id, user_id, role)
            at = now()
            happened = payload.happened_at
            earliest = parse_time(task.get('created_at') or item['created_at'])
            if not earliest <= happened <= parse_time(at):
                raise DomainError('advice_feedback_time_invalid', 422)
            followup = None
            if payload.followup != 'none':
                if payload.followup_assigned_to is None or payload.followup_due_at is None:
                    raise DomainError('advice_followup_needs_assignment', 422)
                from app.schemas.api import TaskCreateRequest
                followup_request = TaskCreateRequest(elder_id=elder_id, title='复核本次照护反馈',
                    shift_id=payload.shift_id or task['shift_id'], assigned_to=payload.followup_assigned_to,
                    due_at=payload.followup_due_at, completion_criteria='核实本人感受及是否需要调整安排，并记录依据')
                followup = task_service.create_from_data(data, followup_request, user_id, role)
            elif payload.followup_assigned_to is not None or payload.followup_due_at is not None:
                raise DomainError('advice_followup_not_requested', 422)
            record = CareRecord(id=identifier('REC'), elder_id=elder_id,
                admission_id=elder.get('current_admission_id'), shift_id=payload.shift_id,
                raw_text=payload.observation, observations=[payload.observation],
                created_by=user_id, created_at=at, updated_at=at, happened_at=happened.isoformat())
            data['care_records'].append(record.model_dump())
            row = {'id': identifier('FEEDBACK'), 'task_id': task['id'],
                'task_revision': task.get('revision', 1), 'execution_status': task['status'],
                'task_result': task.get('result'),
                'response': payload.response, 'observation': payload.observation,
                'record_id': record.id, 'record_revision': 1, 'happened_at': happened.isoformat(),
                'created_at': at, 'created_by': user_id, 'followup': payload.followup,
                'followup_task_id': followup['id'] if followup else None}
            item['feedback'].append(row)
            item['revision'] += 1
            audit(data, 'create_manual_record', record.id, user_id, elder_id=elder_id,
                  record_id=record.id, shift_id=payload.shift_id, detail='照护建议的人工执行反馈')
            audit(data, 'feedback_care_advice', advice_id, user_id, elder_id=elder_id,
                  record_id=record.id, task_id=task['id'], detail='登记执行与本人反应，不自动认定建议有效')
            return _view(data, item)
        return replayable(data, user_id, 'feedback_care_advice', key,
                          {'advice_id': advice_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def review(store, elder_id, advice_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        item = _item(data, elder_id, advice_id, user_id, role)
        def operation():
            if item['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            view = _view(data, item)
            if not item['feedback']:
                raise DomainError('advice_review_needs_feedback')
            if view['feedback_fingerprint'] != payload.expected_feedback_fingerprint:
                raise DomainError('advice_feedback_changed')
            if not view['feedback'][-1]['source_current']:
                raise DomainError('advice_feedback_changed')
            if payload.decision == 'continue_trial' and not view['source_current']:
                raise DomainError('advice_source_changed')
            item['reviews'].append({'decision': payload.decision, 'note': payload.note,
                'reviewed_by': user_id, 'reviewed_at': now(),
                'feedback_fingerprint': view['feedback_fingerprint'],
                'feedback_id': view['feedback'][-1]['id'],
                'advice_source_current': view['source_current']})
            item['revision'] += 1
            audit(data, 'review_care_advice', advice_id, user_id, elder_id=elder_id,
                  detail=payload.note, decision=payload.decision)
            return _view(data, item)
        return replayable(data, user_id, 'review_care_advice', key,
                          {'advice_id': advice_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
