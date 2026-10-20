"""Deterministic change-impact cases. Human actions never rewrite historical care evidence."""
from __future__ import annotations

import copy
import hashlib
import json

from app.services import task_memory_service
from app.services.workflow import DomainError, active_staff, audit, find, identifier, now, parse_time, replayable


MANAGEMENT = {'admin', 'supervisor'}


def _actor(data, user_id, role, management=False):
    user = find(data, 'users', user_id, 'staff_not_found')
    if (not user.get('active', True) or user.get('role') != role or
            role not in (MANAGEMENT if management else MANAGEMENT | {'caregiver'})):
        raise DomainError('change_review_permission_denied', 403)


def access(item, user_id, role):
    if role not in MANAGEMENT and item['assigned_to'] != user_id:
        raise DomainError('change_review_not_assigned_to_you', 403)


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _handovers(data, task_id, reference_id):
    parents = {row['id']: row for row in data['handovers']}
    result = []
    for row in data['handover_items']:
        if row.get('kind') != 'task' or row['source_id'] != task_id:
            continue
        reference = next((ref for ref in row.get('memory_references', []) if ref['id'] == reference_id), None)
        parent = parents.get(row['handover_id'])
        result.append({
            'handover_id': row['handover_id'], 'item_id': row['id'],
            'handover_status': parent['status'] if parent else 'missing',
            'handover_revision': parent.get('revision', 1) if parent else None,
            'source_shift_id': parent.get('source_shift_id') if parent else None,
            'target_shift_id': parent.get('target_shift_id') if parent else None,
            'source_revision': row.get('source_revision', 1), 'item_status': row['status'],
            'snapshot_contains_reference': reference is not None,
            'snapshot_reference_status': reference['status'] if reference else None,
            'snapshot_memory_revision': reference['memory_revision'] if reference else None,
            'historical_only': bool(parent and parent['status'] != 'draft'),
        })
    return sorted(result, key=lambda row: (row['handover_id'], row['item_id']))


def _context(data, item, at):
    task = next((row for row in data['care_tasks'] if row['id'] == item['task_id']), None)
    if task is None or task['elder_id'] != item['elder_id']:
        return {'task': None, 'reference': None, 'replacements': [], 'needs_review': True,
                'integrity_error': 'task_missing_or_elder_mismatch', 'handovers': []}
    checked = task_memory_service.view_from_data(data, task, at)
    reference = next((row for row in checked['references'] if row['id'] == item['reference_id']), None)
    integrity = None
    if reference is None or reference['memory_id'] != item['memory_id']:
        integrity = 'reference_missing_or_memory_mismatch'
    replacements = [
        {'id': row['id'], 'memory_id': row['memory_id'], 'memory_revision': row['memory_revision'],
         'scene': row['scene'], 'current': row['current']}
        for row in checked['references'] if row['id'] != item['reference_id'] and row['status'] == 'active'
        and row['scene'] == item['initial_snapshot']['reference']['scene']
        and not row['current']['outdated'] and row['current']['effective']
    ]
    handovers = _handovers(data, task['id'], item['reference_id'])
    if any(row['handover_status'] == 'missing' for row in handovers):
        integrity = integrity or 'related_handover_missing'
    return {
        'task': {key: task.get(key) for key in ('id', 'revision', 'status', 'shift_id', 'assigned_to')},
        'reference': reference, 'replacements': replacements,
        'needs_review': bool(integrity or (reference and reference['needs_review'])),
        'integrity_error': integrity,
        'handovers': handovers,
    }


def _view(data, item, at=None):
    at = at or now()
    context = _context(data, item, at)
    return {**copy.deepcopy(item), 'current': context, 'fingerprint': _hash(context),
            'overdue': bool(item['status'] != 'closed' and item['due_at'] and parse_time(item['due_at']) <= parse_time(at))}


def reconcile(data, user_id, memory_id=None, elder_id=None, at=None):
    """Within caller's transaction: create one open case per affected task/reference.

    Repeated detection preserves initial evidence and all submitted attempts.
    No automatic assignment, closure, task mutation or handover mutation.
    """
    at = at or now()
    created, updated, count = [], [], 0
    for task in data['care_tasks']:
        if elder_id and task['elder_id'] != elder_id:
            continue
        if memory_id and not any(row['memory_id'] == memory_id for row in task.get('memory_references', [])):
            continue
        count += 1
        for ref in task_memory_service.view_from_data(data, task, at)['references']:
            if not ref['needs_review'] or (memory_id and ref['memory_id'] != memory_id):
                continue
            trigger = _hash(ref['current'])
            item = next((row for row in data['change_reviews'] if row['task_id'] == task['id']
                         and row['reference_id'] == ref['id'] and row['status'] != 'closed'), None)
            observation = {'detected_at': at, 'detected_by': user_id, 'fingerprint': trigger,
                           'current': copy.deepcopy(ref['current'])}
            if item:
                if item['observations'][-1]['fingerprint'] != trigger:
                    item['observations'].append(observation)
                    item['revision'] += 1
                    item['updated_at'] = at
                    if item['status'] == 'awaiting_review':
                        item['status'] = 'assigned'
                    updated.append(item['id'])
                    audit(data, 'change_review_changed', item['id'], user_id, elder_id=item['elder_id'],
                          task_id=task['id'], detail='采用依据再次变化，保留原快照并重新核验', observation=observation)
                continue
            item = {
                'id': identifier('CR'), 'elder_id': task['elder_id'], 'task_id': task['id'],
                'reference_id': ref['id'], 'memory_id': ref['memory_id'],
                'status': 'pending', 'revision': 1, 'assigned_to': None, 'due_at': None,
                'created_by': user_id, 'created_at': at, 'updated_at': at, 'closed_by': None, 'closed_at': None,
                'initial_snapshot': {
                    'task_revision': task.get('revision', 1), 'task_status': task['status'],
                    'reference': copy.deepcopy(ref),
                    'handovers': _handovers(data, task['id'], ref['id']),
                },
                'observations': [observation], 'submissions': [], 'reviews': [],
            }
            data['change_reviews'].append(item)
            created.append(item['id'])
            audit(data, 'create_change_review', item['id'], user_id, elder_id=item['elder_id'],
                  task_id=task['id'], detail='检测到任务采用依据变化，待人工核验', observation=observation)
    return {'as_of': at, 'created_ids': created, 'updated_ids': updated, 'scanned_tasks': count}


def scan(store, payload, user_id, role, key=None):
    def mutate(data):
        _actor(data, user_id, role, management=True)
        def operation():
            if payload.elder_id:
                find(data, 'elders', payload.elder_id, 'elder_not_found')
            result = reconcile(data, user_id, elder_id=payload.elder_id)
            audit(data, 'scan_change_reviews', 'change_reviews', user_id, detail='扫描当前任务采用依据', **result)
            return result
        return replayable(data, user_id, 'scan_change_reviews', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def get(store, case_id, user_id, role):
    data = store.read()
    _actor(data, user_id, role)
    item = find(data, 'change_reviews', case_id, 'change_review_not_found')
    access(item, user_id, role)
    return _view(data, item)


def listing(store, user_id, role, status=None, elder_id=None, task_id=None, assigned_to=None, limit=100, offset=0):
    data = store.read()
    _actor(data, user_id, role)
    rows = [row for row in data['change_reviews'] if
            (role in MANAGEMENT or row['assigned_to'] == user_id) and
            all(value is None or row[field] == value for field, value in (
                ('status', status), ('elder_id', elder_id), ('task_id', task_id), ('assigned_to', assigned_to)))]
    at = now()
    return [_view(data, row, at) for row in sorted(rows, key=lambda row: (row['updated_at'], row['id']), reverse=True)[offset:offset+limit]]


def _check(data, item, payload, at):
    if item['revision'] != payload.expected_revision:
        raise DomainError('stale_revision')
    if item['status'] == 'closed':
        raise DomainError('change_review_closed')
    view = _view(data, item, at)
    if view['fingerprint'] != payload.expected_fingerprint:
        raise DomainError('change_review_context_changed')
    return view


def _write(store, case_id, payload, user_id, role, action, operation, key=None, management=False):
    def mutate(data):
        _actor(data, user_id, role, management)
        item = find(data, 'change_reviews', case_id, 'change_review_not_found')
        access(item, user_id, role)
        def run():
            at = now()
            view = _check(data, item, payload, at)
            operation(data, item, view, at)
            item['revision'] += 1
            item['updated_at'] = at
            audit(data, action, item['id'], user_id, elder_id=item['elder_id'], task_id=item['task_id'],
                  detail=getattr(payload, 'note', getattr(payload, 'reason', '')), case_revision=item['revision'],
                  change_action=payload.model_dump(mode='json'))
            return _view(data, item, at)
        return replayable(data, user_id, action, key, {'case_id': case_id, **payload.model_dump(mode='json')}, run)
    return store.mutate(mutate)


def assign(store, case_id, payload, user_id, role, key=None):
    def operation(data, item, view, at):
        active_staff(data, payload.assigned_to)
        if payload.due_at and payload.due_at <= parse_time(at):
            raise DomainError('change_review_due_at_must_be_future', 422)
        item.update(assigned_to=payload.assigned_to, due_at=payload.due_at.isoformat() if payload.due_at else None,
                    status='assigned')
    return _write(store, case_id, payload, user_id, role, 'assign_change_review', operation, key, management=True)


def _evidence(data, elder_id, payloads):
    result = []
    for payload in payloads:
        record = find(data, 'care_records', payload.record_id, 'record_not_found')
        if record['elder_id'] != elder_id:
            raise DomainError('change_evidence_elder_mismatch', 422)
        if record.get('status') not in {'confirmed', 'corrected'} or record.get('revision', 1) != payload.revision:
            raise DomainError('change_evidence_not_current')
        if payload.field == 'raw_text' and (record.get('revision', 1) != 1 or record['status'] == 'corrected'):
            raise DomainError('corrected_source_requires_observations', 422)
        texts = [record['raw_text']] if payload.field == 'raw_text' else record['observations']
        text = next((text for text in texts if payload.quote in text), None)
        if text is None:
            raise DomainError('change_evidence_quote_not_found', 422)
        result.append({**payload.model_dump(), 'snapshot_text': text})
    return result


def _disposition(context, disposition):
    if context['integrity_error']:
        raise DomainError('change_review_integrity_error')
    ref = context['reference']
    terminal = context['task']['status'] in task_memory_service.TERMINAL_TASK
    valid = {
        'reference_withdrawn': ref['status'] == 'withdrawn',
        'reference_replaced': ref['status'] == 'withdrawn' and bool(context['replacements']),
        'task_terminal': terminal,
        'no_current_difference': ref['status'] == 'active' and not ref['current']['outdated'],
    }
    if not valid[disposition]:
        raise DomainError('change_review_resolution_not_satisfied')
    if context['needs_review']:
        raise DomainError('change_review_still_unresolved')


def submit(store, case_id, payload, user_id, role, key=None):
    def operation(data, item, view, at):
        if item['status'] != 'assigned' or item['assigned_to'] != user_id:
            raise DomainError('change_review_only_assignee_can_submit', 403)
        _disposition(view['current'], payload.disposition)
        expected_ids = {row['handover_id'] for row in view['current']['handovers'] if row['historical_only']}
        if set(payload.acknowledged_handover_ids) != expected_ids or len(payload.acknowledged_handover_ids) != len(expected_ids):
            raise DomainError('change_review_handover_acknowledgment_required', 422)
        evidence = _evidence(data, item['elder_id'], payload.evidence)
        item['submissions'].append({
            'id': identifier('CRS'), 'submitted_by': user_id, 'submitted_at': at,
            'disposition': payload.disposition, 'note': payload.note, 'evidence': evidence,
            'acknowledged_handover_ids': sorted(expected_ids), 'fingerprint': view['fingerprint'],
            'context_snapshot': copy.deepcopy(view['current']),
        })
        item['status'] = 'awaiting_review'
    return _write(store, case_id, payload, user_id, role, 'submit_change_review', operation, key)


def review(store, case_id, payload, user_id, role, key=None):
    def operation(data, item, view, at):
        if item['status'] != 'awaiting_review':
            raise DomainError('change_review_not_awaiting_review')
        submission = item['submissions'][-1]
        if payload.decision == 'accept':
            if submission['submitted_by'] == user_id:
                raise DomainError('change_review_requires_another_reviewer', 403)
            if submission['fingerprint'] != view['fingerprint']:
                raise DomainError('change_review_submission_outdated')
            # Evidence snapshots remain immutable; current sources are checked again at closure.
            from app.schemas.change_review import ReviewEvidence
            evidence = _evidence(data, item['elder_id'], [ReviewEvidence(**{key: row[key] for key in
                                 ('record_id', 'revision', 'field', 'quote')}) for row in submission['evidence']])
            if evidence != submission['evidence']:
                raise DomainError('change_evidence_not_current')
            _disposition(view['current'], submission['disposition'])
            item.update(status='closed', closed_by=user_id, closed_at=at)
        else:
            item['status'] = 'assigned'
        item['reviews'].append({'submission_id': submission['id'], 'decision': payload.decision,
                                'note': payload.note, 'reviewed_by': user_id, 'reviewed_at': at,
                                'context_snapshot': copy.deepcopy(view['current'])})
    return _write(store, case_id, payload, user_id, role, 'review_change_review', operation, key, management=True)
