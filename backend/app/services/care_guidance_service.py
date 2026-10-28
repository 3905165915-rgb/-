"""Non-task guidance, stored atomically and scoped to the current admission."""
import copy
from datetime import timedelta, timezone

from app.models.entities import CareRecord
from app.services.care_scope_service import require_elder_access
from app.services.facility_service import care_eligible
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, parse_time, replayable

SUPPORTED_CONTENT_TYPES = ['routine_hint', 'one_off_reminder', 'followup_task']
CHINA = timezone(timedelta(hours=8))
HINT_STATUSES = {'pending', 'enabled', 'needs_adjustment', 'disabled'}


def today():
    return parse_time(now()).astimezone(CHINA).date().isoformat()


def access(data, elder_id, user_id, role, management=False):
    current_staff(data, user_id, role, management=management)
    require_elder_access(data, elder_id, user_id, role)
    return care_eligible(data, elder_id)


def require_key(key):
    if not key:
        raise DomainError('guidance_idempotency_required', 422)


def valid_service_date(day):
    if day.isoformat() < today():
        raise DomainError('guidance_service_date_expired', 422)


def create(data, elder_id, line, user_id, role, *, service_date=None, source_advice=None, plan_id=None):
    elder = access(data, elder_id, user_id, role)
    management = role in {'admin', 'supervisor'}
    if line['content_type'] == 'one_off_reminder':
        valid_service_date(service_date)
    stamp = now()
    row = dict(copy.deepcopy(line), id=identifier('GUIDANCE'), elder_id=elder_id,
               admission_id=elder.get('current_admission_id'), revision=1,
               status=('enabled' if management else 'pending') if line['content_type'] == 'routine_hint' else 'active',
               created_by=user_id, created_at=stamp, updated_at=stamp,
               confirmed_by=user_id if management or line['content_type'] == 'one_off_reminder' else None,
               confirmed_at=stamp if management or line['content_type'] == 'one_off_reminder' else None,
               source_advice_id=source_advice['id'] if source_advice else None,
               source_advice_revision=source_advice['revision'] if source_advice else None,
               source_plan_id=plan_id)
    if service_date is not None:
        row['service_date'] = service_date.isoformat()
    data['care_guidance'].append(row)
    audit(data, 'create_care_guidance', row['id'], user_id, elder_id=elder_id,
          content_type=row['content_type'], status=row['status'])
    return copy.deepcopy(row)


def view(row):
    result = copy.deepcopy(row)
    if row['content_type'] == 'one_off_reminder' and row['status'] == 'active' and row['service_date'] < today():
        result.update(status='expired', revision=row['revision'] + 1)
    return result


def expire(data):
    for row in data['care_guidance']:
        updated = view(row)
        if updated['status'] != row['status']:
            row.update(status='expired', revision=updated['revision'], updated_at=now())
            audit(data, 'expire_care_guidance', row['id'], 'system:guidance', elder_id=row['elder_id'])


def expire_due(store):
    data = store.read()
    if any(view(row)['status'] != row['status'] for row in data['care_guidance']):
        store.mutate(expire)


def _item(data, elder_id, guidance_id, user_id, role):
    elder = access(data, elder_id, user_id, role)
    row = find(data, 'care_guidance', guidance_id, 'guidance_not_found')
    if row['elder_id'] != elder_id or row.get('admission_id') != elder.get('current_admission_id'):
        raise DomainError('guidance_not_found', 404)
    return row


def listing(store, elder_id, user_id, role):
    data = store.read()
    elder = access(data, elder_id, user_id, role)
    items = [view(row) for row in data['care_guidance'] if row['elder_id'] == elder_id
             and row.get('admission_id') == elder.get('current_admission_id')]
    if role == 'caregiver':
        items = [row for row in items if (row['content_type'] == 'routine_hint' and row['status'] == 'enabled')
                 or (row['content_type'] == 'one_off_reminder' and row['status'] == 'active'
                     and row['service_date'] == today())]
    items.sort(key=lambda row: (row['created_at'], row['id']), reverse=True)
    return {'elder_id': elder_id, 'items': items}


def status(store, elder_id, guidance_id, payload, user_id, role, key=None):
    require_key(key)
    def commit(data):
        row = _item(data, elder_id, guidance_id, user_id, role)
        def operation():
            if row['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if row['content_type'] == 'routine_hint':
                if payload.status not in HINT_STATUSES or payload.status == row['status']:
                    raise DomainError('guidance_transition_invalid', 422)
                if role == 'caregiver' and not (row['status'] == 'enabled' and payload.status == 'needs_adjustment'):
                    raise DomainError('guidance_management_required', 403)
            else:
                current_staff(data, user_id, role, management=True)
                if payload.status != 'cancelled' or view(row)['status'] != 'active':
                    raise DomainError('guidance_transition_invalid', 409)
            stamp = now()
            row.update(status=payload.status, revision=row['revision'] + 1,
                       updated_at=stamp, updated_by=user_id, status_reason=payload.reason)
            if payload.status == 'enabled':
                row.update(confirmed_by=user_id, confirmed_at=stamp)
            audit(data, 'update_care_guidance', guidance_id, user_id, elder_id=elder_id,
                  status=payload.status, detail=payload.reason)
            return copy.deepcopy(row)
        return replayable(data, user_id, 'guidance_status', key,
                          {'elder_id': elder_id, 'guidance_id': guidance_id, **payload.model_dump()}, operation)
    return store.mutate(commit)


def record(store, elder_id, guidance_id, payload, user_id, role, key=None):
    require_key(key)
    def commit(data):
        row = _item(data, elder_id, guidance_id, user_id, role)
        def operation():
            if row['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if row['content_type'] != 'one_off_reminder' or view(row)['status'] != 'active' or row['service_date'] != today():
                raise DomainError('guidance_reminder_inactive')
            stamp = now()
            if payload.happened_at > parse_time(stamp) or payload.happened_at.astimezone(CHINA).date().isoformat() != row['service_date']:
                raise DomainError('guidance_record_time_invalid', 422)
            saved = CareRecord(id=identifier('REC'), elder_id=elder_id, admission_id=row.get('admission_id'),
                raw_text=payload.observation, observations=[payload.observation], created_by=user_id,
                created_at=stamp, recorded_at=stamp, updated_at=stamp, happened_at=payload.happened_at.isoformat())
            value = saved.model_dump()
            value.update(source_guidance_id=guidance_id, source_guidance_revision=row['revision'],
                         care_response=payload.response)
            data['care_records'].append(value)
            row.update(status='recorded', revision=row['revision'] + 1, updated_at=stamp,
                       recorded_by=user_id, record_id=saved.id, response=payload.response)
            # This record is factual feedback only. Do not enqueue the automatic
            # preference/task organiser as a side effect of saving a response.
            audit(data, 'create_manual_record', saved.id, user_id, queue_record_job=False,
                  elder_id=elder_id, record_id=saved.id, detail='本次照护提醒的实际询问与回应')
            audit(data, 'record_care_guidance', guidance_id, user_id, elder_id=elder_id, record_id=saved.id)
            return {'guidance': copy.deepcopy(row), 'record': value, 'created_tasks': []}
        return replayable(data, user_id, 'guidance_record', key,
                          {'elder_id': elder_id, 'guidance_id': guidance_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(commit)
