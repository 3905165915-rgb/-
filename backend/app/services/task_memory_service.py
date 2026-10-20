"""Explicit human adoption with immutable memory snapshots; no automatic task execution."""
from __future__ import annotations

import copy

from app.services import memory_service
from app.services.task_service import actor_can_execute
from app.services.workflow import DomainError, audit, find, identifier, now, open_shift, replayable


TERMINAL_TASK = {'completed', 'cancelled'}
SNAPSHOT_FIELDS = (
    'id', 'elder_id', 'revision', 'content', 'category', 'scenes', 'attributed_to', 'source',
    'status', 'valid_from', 'expires_at', 'review_due_at', 'confirmed_by', 'confirmed_at', 'candidate_source',
)


def _actor(data, task, user_id, role):
    user = find(data, 'users', user_id, 'staff_not_found')
    if role not in {'admin', 'supervisor', 'caregiver'} or not user.get('active', True) or user.get('role') != role:
        raise DomainError('task_memory_permissions_changed', 403)
    actor_can_execute(task, user_id, role)


def _editable_task(data, task, expected_revision, user_id, role):
    if task.get('revision', 1) != expected_revision:
        raise DomainError('stale_revision')
    if task['status'] in TERMINAL_TASK:
        raise DomainError('task_is_terminal')
    open_shift(data, task.get('shift_id'), user_id, role)


def _current(data, task, reference, at):
    memory = next((row for row in data['care_memories'] if row['id'] == reference['memory_id']), None)
    if memory is None or memory['elder_id'] != task['elder_id']:
        return {
            'memory_revision': None, 'memory_status': None, 'effective': False, 'source_current': False,
            'review_due': False, 'outdated': True,
            'reasons': ['memory_missing' if memory is None else 'memory_elder_mismatch'],
        }
    current = memory_service.view_from_data(data, memory['id'], at)
    reasons = []
    if current['revision'] != reference['memory_revision']:
        reasons.append('memory_revision_changed')
    if reference['scene'] not in current['scenes']:
        reasons.append('scene_no_longer_applicable')
    reasons.extend('memory_' + reason for reason in current['blocked_reasons'])
    return {
        'memory_revision': current['revision'], 'memory_status': current['status'],
        'effective': current['effective'], 'source_current': current['source_current'],
        'review_due': current['review_due'], 'outdated': bool(reasons), 'reasons': reasons,
    }


def view_from_data(data, task, at=None):
    at = at or now()
    historical = task['status'] in TERMINAL_TASK
    rows = []
    for stored in task.get('memory_references', []):
        row = copy.deepcopy(stored)
        row['current'] = _current(data, task, stored, at)
        row['needs_review'] = not historical and stored['status'] == 'active' and row['current']['outdated']
        rows.append(row)
    return {
        'task_id': task['id'], 'task_revision': task.get('revision', 1), 'task_status': task['status'],
        'historical_only': historical, 'as_of': at, 'needs_review': any(row['needs_review'] for row in rows),
        'references': rows,
    }


def get(store, task_id):
    data = store.read()
    return view_from_data(data, find(data, 'care_tasks', task_id, 'task_not_found'))


def adopt(store, task_id, payload, user_id, role, key=None):
    def mutate(data):
        task = find(data, 'care_tasks', task_id, 'task_not_found')
        _actor(data, task, user_id, role)
        def operation():
            _editable_task(data, task, payload.expected_task_revision, user_id, role)
            at = now()
            memory = memory_service.view_from_data(data, payload.memory_id, at)
            if memory['elder_id'] != task['elder_id']:
                raise DomainError('task_memory_elder_mismatch', 422)
            if memory['revision'] != payload.expected_memory_revision:
                raise DomainError('task_memory_revision_changed')
            if payload.scene not in memory['scenes']:
                raise DomainError('task_memory_scene_mismatch', 422)
            if not memory['effective']:
                raise DomainError('task_memory_not_effective')
            references = task.setdefault('memory_references', [])
            active = [row for row in references if row['status'] == 'active']
            if any(row['memory_id'] == memory['id'] for row in active):
                raise DomainError('task_memory_already_active')
            if len(active) >= 10:
                raise DomainError('too_many_active_task_memories', 422)
            reference = {
                'id': identifier('TMR'), 'memory_id': memory['id'], 'memory_revision': memory['revision'],
                'scene': payload.scene, 'snapshot': copy.deepcopy({field: memory.get(field) for field in SNAPSHOT_FIELDS}),
                'status': 'active', 'adopted_by': user_id, 'adopted_at': at, 'reason': payload.reason,
                'withdrawn_by': None, 'withdrawn_at': None, 'withdrawal_reason': None,
            }
            references.append(reference)
            task.update(revision=task.get('revision', 1) + 1, updated_at=at)
            audit(data, 'adopt_task_memory', task_id, user_id, elder_id=task['elder_id'],
                  detail=payload.reason, reference=copy.deepcopy(reference), task_revision=task['revision'])
            return view_from_data(data, task)
        return replayable(data, user_id, 'adopt_task_memory', key, {'task_id': task_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def withdraw(store, task_id, reference_id, payload, user_id, role, key=None):
    def mutate(data):
        task = find(data, 'care_tasks', task_id, 'task_not_found')
        _actor(data, task, user_id, role)
        def operation():
            _editable_task(data, task, payload.expected_task_revision, user_id, role)
            reference = next((row for row in task.get('memory_references', []) if row['id'] == reference_id), None)
            if reference is None:
                raise DomainError('task_memory_reference_not_found', 404)
            if reference['status'] != 'active':
                raise DomainError('task_memory_reference_already_withdrawn')
            reference.update(status='withdrawn', withdrawn_by=user_id, withdrawn_at=now(), withdrawal_reason=payload.reason)
            task.update(revision=task.get('revision', 1) + 1, updated_at=now())
            audit(data, 'withdraw_task_memory', task_id, user_id, elder_id=task['elder_id'], detail=payload.reason,
                  reference=copy.deepcopy(reference), task_revision=task['revision'])
            return view_from_data(data, task)
        return replayable(data, user_id, 'withdraw_task_memory', key,
                          {'task_id': task_id, 'reference_id': reference_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)
