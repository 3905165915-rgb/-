"""Preview and atomically confirm a plan using existing versioned business rules."""
import copy
import hashlib
import json

from app.schemas.planning import PlanCreate, PlanReview, PlanGenerate
from app.services import assessment_service, plan_service
from app.services.elder_workspace_service import access, TransactionStore
from app.services.workflow import DomainError, replayable
from app.services.memory_service import listing as memories
from app.services import care_guidance_service as guidance
from app.services.workflow import audit, identifier, now


def context_data(data, elder_id, user_id, role):
    elder = access(data, elder_id, user_id, role, management=True)
    assessment = next((a for a in reversed(data['assessments']) if a['elder_id'] == elder_id
        and a.get('admission_id') == elder.get('current_admission_id')
        and not assessment_service.reasons(data, a)), None)
    active = next((p for p in reversed(data['care_plans']) if p['elder_id'] == elder_id
        and p.get('admission_id') == elder.get('current_admission_id') and p['status'] in {'active', 'retired'}), None)
    return {'elder': copy.deepcopy(elder), 'assessment': copy.deepcopy(assessment),
        'previous_plan': copy.deepcopy(active),
        'shifts': copy.deepcopy([s for s in data['shifts'] if s.get('status') == 'open']),
        'staff': [{'id': u['id'], 'display_name': u['display_name']} for u in data['users']
                  if u.get('active', True) and u['role'] in {'admin','supervisor','caregiver','nurse'}],
        'memories': memories(TransactionStore(data), elder_id),
        'needs_assessment': assessment is None,
        'supported_content_types': guidance.SUPPORTED_CONTENT_TYPES}


def context(store, elder_id, user_id, role):
    return context_data(store.read(), elder_id, user_id, role)


def fingerprint(data, elder_id, user_id, role, payload):
    value = context_data(data, elder_id, user_id, role)
    value['tasks'] = [t for t in data['care_tasks'] if t['elder_id'] == elder_id]
    value['batch'] = data.get('demo_batch_id')
    value['actor'] = [user_id, role]
    value['guidance'] = [r for r in data['care_guidance'] if r['elder_id'] == elder_id]
    value['proposed'] = payload.model_dump(mode='json', exclude={'context_token'})
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def execute(data, elder_id, payload, user_id, role):
    if payload.content_type != 'followup_task':
        elder = guidance.access(data, elder_id, user_id, role, management=True)
        if payload.content_type == 'one_off_reminder':
            guidance.valid_service_date(payload.service_date)
        plan = dict(id=identifier('GUIDANCEPLAN'), elder_id=elder_id,
                    admission_id=elder.get('current_admission_id'), revision=1,
                    status='confirmed', created_by=user_id, confirmed_by=user_id,
                    created_at=now(), **payload.model_dump(mode='json', exclude={'context_token'}))
        data['care_guidance_plans'].append(plan)
        items = [guidance.create(data, elder_id, line.model_dump(), user_id, role,
                 service_date=getattr(payload, 'service_date', None), plan_id=plan['id']) for line in payload.items]
        audit(data, 'confirm_guidance_arrangement', plan['id'], user_id, elder_id=elder_id,
              content_type=payload.content_type)
        return {'plan': copy.deepcopy(plan), 'guidance': items, 'created_tasks': [],
                'existing_task_ids': [], 'affected_task_ids': [], 'unassigned_items': [],
                'notice': '已保存照护提示，不生成任务或长期习惯。'}
    ctx = context_data(data, elder_id, user_id, role)
    assessment = ctx['assessment']
    if assessment is None:
        raise DomainError('assessment_not_effective', 409)
    previous = ctx['previous_plan']
    nested = TransactionStore(data)
    body = payload.model_dump(exclude={'shift_id','assigned_to','service_date','context_token','content_type'})
    body['items'] = [{k: v for k, v in line.items() if k != 'content_type'} for line in body['items']]
    plan = plan_service.create(nested, PlanCreate(elder_id=elder_id,
        assessment_id=assessment['id'], expected_assessment_revision=assessment['revision'],
        supersedes_id=previous['id'] if previous else None, **body), user_id, role)
    plan = plan_service.review(nested, plan['id'], PlanReview(expected_revision=plan['revision'],
        action='approve', reason='主管核对三步安排预览后确认'), user_id, role)
    generated = plan_service.generate(nested, plan['id'], PlanGenerate(expected_revision=plan['revision'],
        service_date=payload.service_date, shift_id=payload.shift_id, assigned_to=payload.assigned_to), user_id, role)
    selected = {t.get('occurrence_key') for t in generated['created_tasks']}
    selected.update(t.get('occurrence_key') for t in data['care_tasks'] if t['id'] in generated['existing_task_ids'])
    unassigned = [{'title': line['title'], 'scheduled_at': instant.isoformat(), 'reason': '所选班次不覆盖此时间，尚未安排'}
                  for line, instant, occurrence in plan_service.occurrences(plan, payload.service_date)
                  if occurrence not in selected]
    if not generated['created_tasks'] and not generated['existing_task_ids']:
        raise DomainError('arrangement_no_service_in_shift', 422)
    affected = [t['id'] for t in data['care_tasks'] if previous and t.get('source_plan_id') == previous['id']
        and t['status'] not in {'completed','cancelled'}]
    return {'plan': {**plan, 'content_type': 'followup_task'}, **generated, 'unassigned_items': unassigned, 'affected_task_ids': affected,
            'notice': '已安排今日服务。原任务保留；受计划变更影响的任务需逐项核对，不自动覆盖。'}


def preview(store, elder_id, payload, user_id, role):
    data = store.read()
    token = fingerprint(data, elder_id, user_id, role, payload)
    result = execute(copy.deepcopy(data), elder_id, payload, user_id, role)
    if payload.content_type != 'followup_task':
        return {'context_token': token, 'elder_id': elder_id, 'content_type': payload.content_type,
                'items': [line.model_dump() for line in payload.items],
                'unassigned_items': [], 'affected_task_ids': [], 'existing_task_count': 0,
                'notice': '预览尚未保存；确认后保存提示或本次提醒，不生成任务。'}
    # Preview IDs are temporary and must never be submitted as real object IDs.
    return {'context_token': token, 'elder_id': elder_id, 'content_type': payload.content_type,
            'items': [{k:t.get(k) for k in ('title','scheduled_at','due_at','condition','completion_criteria')}
            for t in result['created_tasks']], 'unassigned_items': result['unassigned_items'],
            'existing_task_count': len(result['existing_task_ids']), 'affected_task_ids': result['affected_task_ids'],
            'notice': '预览尚未保存；确认后一次完成批准与任务安排，已有任务保留。'}


def confirm(store, elder_id, payload, user_id, role, key=None):
    if payload.content_type != 'followup_task':
        guidance.require_key(key)
    def commit(data):
        access(data, elder_id, user_id, role, management=True)
        def operation():
            if not payload.context_token or payload.context_token != fingerprint(data, elder_id, user_id, role, payload):
                raise DomainError('arrangement_context_changed', 409)
            return execute(data, elder_id, payload, user_id, role)
        return replayable(data, user_id, 'confirm_arrangement', key,
                          {'elder_id': elder_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(commit)
