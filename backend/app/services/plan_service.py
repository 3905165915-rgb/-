"""Human-approved recurring plans. Generating a task never records service execution."""
import copy
import json
from datetime import date, datetime, time, timedelta, timezone

from app.models.entities import CareTask
from app.services import assessment_service
from app.services.facility_service import care_eligible, version
from app.services.workflow import DomainError, active_staff, audit, current_staff, find, identifier, now, open_shift, parse_time, replayable

CHINA = timezone(timedelta(hours=8))


def local_date(at):
    return parse_time(at).astimezone(CHINA).date()


def reasons(data, item, at=None, service_date=None):
    at = at or now()
    result = []
    if item['status'] != 'active':
        result.append('plan_not_active')
    elder = next((row for row in data['elders'] if row['id'] == item['elder_id']), None)
    if not elder or elder.get('status', 'active') not in {'active', 'out'}:
        result.append('elder_not_in_care')
    if not elder or elder.get('current_admission_id') != item.get('admission_id'):
        result.append('plan_admission_changed')
    day = service_date or local_date(at)
    if not date.fromisoformat(item['starts_on']) <= day <= date.fromisoformat(item['ends_on']):
        result.append('outside_plan_dates')
    assessment = next((row for row in data['assessments'] if row['id'] == item['assessment_id']), None)
    if not assessment or assessment.get('revision', 1) != item['expected_assessment_revision']:
        result.append('plan_assessment_changed')
    if assessment:
        result.extend(assessment_service.reasons(data, assessment, at))
    else:
        result.append('assessment_not_found')
    return sorted(set(result))


def view(data, item):
    result = copy.deepcopy(item)
    blocked = reasons(data, item)
    result['current'] = {'effective': not blocked, 'blocked_reasons': blocked}
    return result


def access(item, role):
    if role == 'caregiver' and item['status'] in {'draft', 'rejected'}:
        raise DomainError('management_required_for_plan_draft', 403)


def get(store, plan_id, role):
    data = store.read()
    item = find(data, 'care_plans', plan_id, 'plan_not_found')
    access(item, role)
    return view(data, item)


def listing(store, role, elder_id=None, limit=100, offset=0):
    data = store.read()
    rows = []
    for item in reversed(data['care_plans']):
        if elder_id and item['elder_id'] != elder_id:
            continue
        try:
            access(item, role)
        except DomainError:
            continue
        rows.append(view(data, item))
    return rows[offset:offset + limit]


def create(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            elder = care_eligible(data, payload.elder_id)
            assessment = find(data, 'assessments', payload.assessment_id, 'assessment_not_found')
            if assessment['elder_id'] != elder['id']:
                raise DomainError('plan_assessment_elder_mismatch', 422)
            version(assessment, payload.expected_assessment_revision)
            if assessment_service.reasons(data, assessment):
                raise DomainError('assessment_not_effective')
            parent = None
            if payload.supersedes_id:
                parent = find(data, 'care_plans', payload.supersedes_id, 'plan_not_found')
                if (parent['elder_id'] != elder['id'] or parent.get('admission_id') != elder.get('current_admission_id')
                        or parent['status'] not in {'active', 'retired'}):
                    raise DomainError('invalid_plan_predecessor')
            item = {'id': identifier('PLAN'), **payload.model_dump(mode='json'),
                    'admission_id': elder.get('current_admission_id'), 'status': 'draft', 'revision': 1,
                    'created_by': user_id, 'created_at': now(), 'approved_by': None, 'approved_at': None,
                    'assessment_snapshot': None, 'events': []}
            item['series_id'] = parent['series_id'] if parent else item['id']
            data['care_plans'].append(item)
            audit(data, 'create_plan', item['id'], user_id, elder_id=elder['id'], detail='建立照护计划草稿')
            return view(data, item)
        return replayable(data, user_id, 'create_plan', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def review(store, plan_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'care_plans', plan_id, 'plan_not_found')
            version(item, payload.expected_revision)
            at = now()
            if payload.action == 'approve':
                if item['status'] != 'draft':
                    raise DomainError('plan_not_draft')
                # A future plan can be approved, but its assessment must be valid now.
                blocked = [code for code in reasons(data, item, at, date.fromisoformat(item['starts_on'])) if code != 'plan_not_active']
                if blocked:
                    raise DomainError('plan_basis_not_current')
                heads = [row for row in data['care_plans'] if row['id'] != item['id'] and row['elder_id'] == item['elder_id']
                         and row.get('admission_id') == item.get('admission_id') and row['status'] in {'active', 'retired'}]
                if heads and (len(heads) != 1 or heads[0]['id'] != item['supersedes_id']):
                    raise DomainError('plan_supersession_required')
                if item['supersedes_id']:
                    parent = find(data, 'care_plans', item['supersedes_id'], 'plan_not_found')
                    if parent['status'] not in {'active', 'retired'}:
                        raise DomainError('plan_predecessor_changed')
                    if parent['status'] == 'active' and date.fromisoformat(item['starts_on']) > local_date(at):
                        raise DomainError('cannot_supersede_before_effective_date')
                    parent.update(status='superseded', revision=parent['revision'] + 1)
                    parent['events'].append({'action': 'superseded', 'at': at, 'by': user_id, 'successor_id': item['id']})
                    audit(data, 'supersede_plan', parent['id'], user_id, elder_id=parent['elder_id'], detail=payload.reason)
                assessment = find(data, 'assessments', item['assessment_id'], 'assessment_not_found')
                item.update(status='active', approved_by=user_id, approved_at=at, assessment_snapshot=copy.deepcopy(assessment))
            elif payload.action == 'reject':
                if item['status'] != 'draft':
                    raise DomainError('plan_not_draft')
                item['status'] = 'rejected'
            else:
                if item['status'] != 'active':
                    raise DomainError('plan_not_active')
                item['status'] = 'retired'
            item['revision'] += 1
            item['events'].append({'action': payload.action, 'at': at, 'by': user_id, 'reason': payload.reason})
            audit(data, 'review_plan', item['id'], user_id, elder_id=item['elder_id'], detail=payload.reason, decision=payload.action)
            return view(data, item)
        return replayable(data, user_id, 'review_plan', key, {'plan_id': plan_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def scheduled(item, day):
    return day.isoweekday() in item['weekdays']


def occurrences(plan, day):
    anchor = date.fromisoformat(plan['starts_on'])
    if not anchor <= day <= date.fromisoformat(plan['ends_on']):
        return []
    result = []
    for item in plan['items']:
        if not scheduled(item, day) or (day - anchor).days % item['every_n_days']:
            continue
        for clock in item['times']:
            instant = datetime.combine(day, time.fromisoformat(clock), tzinfo=CHINA)
            occurrence = f'{plan["series_id"]}/{item["key"]}/{day.isoformat()}/{clock}'
            result.append((item, instant, occurrence))
    return result


def _assignee(data, shift_id, assigned_to, user_id, role):
    open_shift(data, shift_id, user_id, role)
    shift = find(data, 'shifts', shift_id, 'shift_not_found')
    active_staff(data, assigned_to)
    if assigned_to not in shift['caregiver_ids']:
        raise DomainError('assignee_not_in_shift', 422)
    return shift


def _new_task(data, plan, item, instant, occurrence, shift_id, assigned_to, user_id, replaces=None):
    at = now()
    snapshot = {field: copy.deepcopy(plan[field]) for field in
                ('id', 'revision', 'series_id', 'title', 'goal', 'admission_id', 'assessment_id',
                 'expected_assessment_revision', 'approved_at', 'approved_by')}
    snapshot['item'] = copy.deepcopy(item)
    task = CareTask(id=identifier('TASK'), elder_id=plan['elder_id'], title=item['title'],
                    completion_criteria=item['instruction'], source_type='care_plan', source_id=plan['id'],
                    source_revision=plan['revision'],
                    due_at=(instant + timedelta(minutes=item['window_minutes'])).isoformat(),
                    assigned_to=assigned_to, shift_id=shift_id, condition=item.get('condition'),
                    created_at=at, updated_at=at, created_by=user_id,
                    source_plan_id=plan['id'], source_plan_revision=plan['revision'], plan_item_key=item['key'],
                    service_date=instant.date().isoformat(), scheduled_at=instant.isoformat(),
                    occurrence_key=occurrence, source_plan_snapshot=snapshot, replaces_task_id=replaces)
    data['care_tasks'].append(task.model_dump())
    audit(data, 'create_plan_task', task.id, user_id, elder_id=plan['elder_id'], plan_id=plan['id'],
          detail=item['title'], after={'plan_id': plan['id'], 'plan_revision': plan['revision'], 'occurrence_key': occurrence,
                                      'replaces_task_id': replaces})
    return task.model_dump()


def generate(store, plan_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'care_plans', plan_id, 'plan_not_found')
            version(item, payload.expected_revision)
            at = now()
            if reasons(data, item, at, payload.service_date):
                raise DomainError('plan_not_effective_for_generation')
            shift = _assignee(data, payload.shift_id, payload.assigned_to, user_id, role)
            selected = [(line, instant, occurrence) for line, instant, occurrence in occurrences(item, payload.service_date)
                        if parse_time(shift['start_at']) <= instant < parse_time(shift['end_at'])]
            if len(selected) > 100:
                raise DomainError('too_many_plan_tasks', 422)
            assessment = find(data, 'assessments', item['assessment_id'], 'assessment_not_found')
            created, existing = [], []
            for line, instant, occurrence in selected:
                # Generation cannot plan beyond the next human review deadline.
                if parse_time(assessment['review_due_at']) <= instant:
                    raise DomainError('assessment_review_due_before_service')
                previous = next((row for row in reversed(data['care_tasks']) if row.get('occurrence_key') == occurrence), None)
                if previous:
                    existing.append(previous['id'])
                else:
                    created.append(_new_task(data, item, line, instant, occurrence, shift['id'], payload.assigned_to, user_id))
            return {'plan_id': plan_id, 'service_date': payload.service_date.isoformat(),
                    'created_tasks': created, 'existing_task_ids': existing,
                    'notice': '仅生成待执行任务，不代表服务已执行；已有任务包括已取消任务，不自动补发。'}
        return replayable(data, user_id, 'generate_plan_tasks', key, {'plan_id': plan_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def task_state(data, task, at=None):
    if not task.get('source_plan_id'):
        return {'required': False, 'ready': True, 'blocked_reasons': []}
    at = at or now()
    plan = next((row for row in data['care_plans'] if row['id'] == task['source_plan_id']), None)
    blocked = []
    if not plan:
        blocked.append('plan_not_found')
    else:
        if plan['elder_id'] != task['elder_id'] or plan['revision'] != task.get('source_plan_revision'):
            blocked.append('task_plan_version_changed')
        if not task.get('source_plan_snapshot') or not task.get('service_date'):
            blocked.append('task_plan_snapshot_missing')
        else:
            blocked.extend(reasons(data, plan, at, date.fromisoformat(task['service_date'])))
    return {'required': True, 'ready': not blocked, 'blocked_reasons': sorted(set(blocked)),
            'plan_id': task['source_plan_id'], 'used_revision': task.get('source_plan_revision'),
            'current_revision': plan['revision'] if plan else None}


def assert_task_ready(data, task, at):
    if not task_state(data, task, at)['ready']:
        raise DomainError('task_plan_requires_review')


def reissue(store, plan_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            plan = find(data, 'care_plans', plan_id, 'plan_not_found')
            old = find(data, 'care_tasks', payload.previous_task_id, 'task_not_found')
            version(plan, payload.expected_revision)
            version(old, payload.expected_task_revision)
            if old['status'] != 'cancelled' or not old.get('source_plan_snapshot'):
                raise DomainError('reissue_requires_cancelled_plan_task')
            if old['elder_id'] != plan['elder_id'] or old['source_plan_snapshot']['series_id'] != plan['series_id']:
                raise DomainError('reissue_plan_scope_mismatch', 422)
            day = date.fromisoformat(old['service_date'])
            if reasons(data, plan, service_date=day):
                raise DomainError('plan_not_effective_for_generation')
            latest = next((row for row in reversed(data['care_tasks']) if row.get('occurrence_key') == old['occurrence_key']), None)
            if latest['id'] != old['id']:
                raise DomainError('plan_task_already_reissued')
            selected = next(((line, instant, occurrence) for line, instant, occurrence in occurrences(plan, day)
                             if occurrence == old['occurrence_key']), None)
            if selected is None:
                raise DomainError('occurrence_not_in_current_plan')
            line, instant, occurrence = selected
            shift = _assignee(data, payload.shift_id, payload.assigned_to, user_id, role)
            if not parse_time(shift['start_at']) <= instant < parse_time(shift['end_at']):
                raise DomainError('service_not_in_shift', 422)
            assessment = find(data, 'assessments', plan['assessment_id'], 'assessment_not_found')
            if parse_time(assessment['review_due_at']) <= instant:
                raise DomainError('assessment_review_due_before_service')
            created = _new_task(data, plan, line, instant, occurrence, shift['id'], payload.assigned_to, user_id, old['id'])
            audit(data, 'reissue_plan_task', created['id'], user_id, elder_id=plan['elder_id'], plan_id=plan_id,
                  detail=payload.reason, before={'previous_task_id': old['id']})
            return created
        return replayable(data, user_id, 'reissue_plan_task', key, {'plan_id': plan_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def context_sources(data, elder_id, scene, at):
    result = []
    for plan in data['care_plans']:
        if plan['elder_id'] != elder_id or reasons(data, plan, at):
            continue
        for line in plan['items']:
            if line['scene'] != scene:
                continue
            text = json.dumps({'goal': plan['goal'], 'item': line}, sort_keys=True, ensure_ascii=False)
            result.append({'source_id': f'plan/{plan["id"]}/v{plan["revision"]}/{line["key"]}',
                           'kind': 'plan', 'object_id': plan['id'], 'revision': plan['revision'], 'text': text,
                           'assessment_id': plan['assessment_id'], 'assessment_revision': plan['expected_assessment_revision']})
    return result
