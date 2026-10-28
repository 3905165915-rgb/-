"""Explicit human condition checks; expiry/source changes never trigger automatic care."""
from __future__ import annotations

import copy

from app.services.workflow import (
    DomainError, active_staff, audit, current_staff, find, identifier, now, open_shift, parse_time, replayable,
)


TERMINAL = {'completed', 'cancelled'}
STATE_LABELS = {
    'not_required': '无需条件核验', 'unconfigured': '待主管配置', 'awaiting_assignment': '待认领核验责任',
    'waiting': '待核验', 'not_met': '条件未满足', 'met': '条件已满足', 'needs_recheck': '需重新核验',
}


def _evidence(data, elder_id, payloads):
    result = []
    for payload in payloads:
        record = find(data, 'care_records', payload.record_id, 'record_not_found')
        if record['elder_id'] != elder_id:
            raise DomainError('condition_evidence_elder_mismatch', 422)
        if record.get('status') not in {'confirmed', 'corrected'} or record.get('revision', 1) != payload.revision:
            raise DomainError('condition_evidence_not_current')
        if payload.field == 'raw_text' and (record.get('revision', 1) != 1 or record['status'] == 'corrected'):
            raise DomainError('corrected_source_requires_observations', 422)
        texts = [record['raw_text']] if payload.field == 'raw_text' else record['observations']
        text = next((text for text in texts if payload.quote in text), None)
        if text is None:
            raise DomainError('condition_evidence_quote_not_found', 422)
        result.append({**payload.model_dump(), 'snapshot_text': text})
    return result


def _sources_current(data, elder_id, evidence):
    if not evidence:
        return False
    for source in evidence:
        record = next((row for row in data['care_records'] if row['id'] == source['record_id']), None)
        if (not record or record['elder_id'] != elder_id or record.get('revision', 1) != source['revision'] or
                record.get('status') not in {'confirmed', 'corrected'}):
            return False
        if source['field'] == 'raw_text':
            if record.get('revision', 1) != 1 or record['status'] == 'corrected':
                return False
            texts = [record['raw_text']]
        else:
            texts = record['observations']
        if source['snapshot_text'] not in texts or source['quote'] not in source['snapshot_text']:
            return False
    return True


def state_from_data(data, task, at=None):
    at = at or now()
    verification = task.get('condition_verification')
    required = bool((task.get('condition') or '').strip()) or verification is not None
    state, reasons = 'not_required', []
    sources_current, expired = None, False
    check = verification.get('latest_check') if verification else None
    checker = verification.get('checker_id') if verification else None
    staff = next((row for row in data['users'] if row['id'] == checker), None) if checker else None
    shift = next((row for row in data['shifts'] if row['id'] == task.get('shift_id')), None)
    checker_available = bool(staff and staff.get('active', True) and staff.get('role') in {'admin', 'supervisor', 'caregiver', 'nurse'}
                             and (staff['role'] not in {'caregiver', 'nurse'} or not task.get('shift_id') or
                                  (shift and checker in shift['caregiver_ids'])))
    if required:
        if verification is None:
            state, reasons = 'unconfigured', ['condition_unconfigured']
        elif not checker:
            state, reasons = 'awaiting_assignment', ['condition_checker_unassigned']
        elif not checker_available:
            state, reasons = 'needs_recheck', ['condition_checker_unavailable']
        elif not check:
            state, reasons = 'waiting', ['condition_not_checked']
        else:
            sources_current = _sources_current(data, task['elder_id'], check['evidence'])
            expired = bool(check['valid_until'] and parse_time(check['valid_until']) <= parse_time(at))
            if not sources_current:
                reasons.append('condition_evidence_changed')
            if expired:
                reasons.append('condition_check_expired')
            state = 'needs_recheck' if reasons else check['outcome']
            if state == 'not_met':
                reasons.append('condition_not_met')
    ready = state in {'not_required', 'met'}
    shift_open = not task.get('shift_id') or bool(shift and shift['status'] == 'open')
    elder = next((row for row in data['elders'] if row['id'] == task['elder_id']), None)
    elder_in_care = bool(elder and elder.get('status', 'active') in {'active', 'out'})
    if not elder_in_care:
        reasons.append('elder_not_in_care')
    from app.services.plan_service import task_state
    plan_check = task_state(data, task, at)
    return {
        'required': required, 'state': state, 'criterion': verification['criterion'] if verification else None,
        'checker_id': checker, 'checker_available': checker_available,
        'check_due_at': verification.get('check_due_at') if verification else None,
        'overdue': bool(required and verification and verification.get('check_due_at') and not ready and
                        task['status'] not in TERMINAL and parse_time(verification['check_due_at']) <= parse_time(at)),
        'latest_check_id': check['id'] if check else None,
        'valid_until': check['valid_until'] if check else None, 'evidence_current': sources_current,
        'expired': expired, 'ready': ready, 'blocked_reasons': reasons,
        'execution_allowed': ready and shift_open and elder_in_care and plan_check['ready'] and task['status'] in {'pending', 'in_progress', 'overdue'},
    }


def view_from_data(data, task, at=None):
    at = at or now()
    return {'task_id': task['id'], 'task_revision': task.get('revision', 1), 'task_status': task['status'],
            'condition': task.get('condition'), 'verification': copy.deepcopy(task.get('condition_verification')),
            'current': state_from_data(data, task, at), 'historical_only': task['status'] in TERMINAL, 'as_of': at}


def get(store, task_id):
    data = store.read()
    return view_from_data(data, find(data, 'care_tasks', task_id, 'task_not_found'))


def assert_ready(data, task, at=None):
    if not state_from_data(data, task, at)['ready']:
        raise DomainError('task_condition_not_ready')


def _snapshot(verification):
    return copy.deepcopy({key: value for key, value in verification.items() if key != 'history'}) if verification else None


def _change(data, task, verification, before, action, user_id, reason, at):
    event = {'id': identifier('TCE'), 'action': action, 'created_by': user_id, 'created_at': at,
             'reason': reason, 'before': before, 'after': _snapshot(verification)}
    verification['history'].append(event)
    audit(data, action, task['id'], user_id, elder_id=task['elder_id'], detail=reason,
          task_revision=task.get('revision', 1), condition_change=copy.deepcopy(event))


def _write(store, task_id, payload, user_id, role, action, operation, key=None, management=False):
    def mutate(data):
        current_staff(data, user_id, role, management)
        task = find(data, 'care_tasks', task_id, 'task_not_found')
        # Recheck this before an idempotent replay so reassigned checkers cannot retrieve old responses.
        if action == 'check_task_condition':
            verification = task.get('condition_verification')
            if not verification or verification['checker_id'] != user_id:
                raise DomainError('only_condition_checker_can_check', 403)
        if action == 'claim_task_condition':
            from app.services.task_service import actor_can_execute
            actor_can_execute(task, user_id, role)
        def run():
            if task.get('revision', 1) != payload.expected_task_revision:
                raise DomainError('stale_revision')
            if task['status'] in TERMINAL:
                raise DomainError('task_is_terminal')
            open_shift(data, task.get('shift_id'), user_id, role)
            if not (task.get('condition') or '').strip():
                raise DomainError('task_has_no_condition', 422)
            at = now()
            before = _snapshot(task.get('condition_verification'))
            verification = operation(data, task, at)
            task.update(condition_verification=verification, revision=task.get('revision', 1) + 1, updated_at=at)
            reason = getattr(payload, 'reason', getattr(payload, 'note', ''))
            _change(data, task, verification, before, action, user_id, reason, at)
            return view_from_data(data, task, at)
        return replayable(data, user_id, action, key, {'task_id': task_id, **payload.model_dump(mode='json')}, run)
    return store.mutate(mutate)


def configure(store, task_id, payload, user_id, role, key=None):
    def operation(data, task, at):
        active_staff(data, payload.checker_id)
        checker = find(data, 'users', payload.checker_id, 'assignee_not_found')
        if checker['role'] in {'caregiver', 'nurse'} and task.get('shift_id'):
            shift = find(data, 'shifts', task['shift_id'], 'shift_not_found')
            if payload.checker_id not in shift['caregiver_ids']:
                raise DomainError('condition_checker_not_in_shift', 422)
        if payload.check_due_at and payload.check_due_at <= parse_time(at):
            raise DomainError('condition_check_due_at_must_be_future', 422)
        return {
            'criterion': payload.criterion, 'checker_id': payload.checker_id,
            'check_due_at': payload.check_due_at.isoformat() if payload.check_due_at else None,
            'status': 'waiting', 'latest_check': None,
            'history': copy.deepcopy((task.get('condition_verification') or {}).get('history', [])),
        }
    return _write(store, task_id, payload, user_id, role, 'configure_task_condition', operation, key, management=True)


def claim(store, task_id, payload, user_id, role, key=None):
    def operation(data, task, at):
        verification = task.get('condition_verification')
        if not verification:
            raise DomainError('condition_requires_configuration')
        if verification['checker_id'] is not None:
            raise DomainError('condition_checker_already_assigned')
        verification.update(checker_id=user_id, status='waiting', latest_check=None)
        return verification
    return _write(store, task_id, payload, user_id, role, 'claim_task_condition', operation, key)


def check(store, task_id, payload, user_id, role, key=None):
    def operation(data, task, at):
        if payload.valid_until and payload.valid_until <= parse_time(at):
            raise DomainError('condition_valid_until_must_be_future', 422)
        verification = task['condition_verification']
        evidence = _evidence(data, task['elder_id'], payload.evidence)
        verification.update(status=payload.outcome, latest_check={
            'id': identifier('TCC'), 'outcome': payload.outcome, 'note': payload.note,
            'checked_by': user_id, 'checked_at': at, 'evidence': evidence,
            'valid_until': payload.valid_until.isoformat() if payload.valid_until else None,
        })
        return verification
    return _write(store, task_id, payload, user_id, role, 'check_task_condition', operation, key)


def carry(data, task, user_id, at=None):
    """Called after handover carries the same task; old checks stay only in immutable history."""
    verification = task.get('condition_verification')
    if not verification:
        return
    at = at or now()
    before = _snapshot(verification)
    verification.update(checker_id=None, status='waiting', latest_check=None)
    _change(data, task, verification, before, 'carry_task_condition', user_id,
            '跨班后需接班人员明确认领并重新核验，旧结论仅保留历史', at)
