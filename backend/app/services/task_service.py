from __future__ import annotations

from datetime import datetime, timezone

from app.models.entities import CareTask
from app.schemas.api import TaskTransitionRequest, TaskUpdateRequest
from app.services.workflow import DomainError, active_staff, audit, current_staff, find, now, open_shift, parse_time, replayable
from app.storage.json_store import JsonStore


def task_view(item: dict) -> dict:
    result = CareTask.model_validate(item).model_dump()
    if result['status'] in {'pending', 'in_progress', 'overdue'} and result['due_at']:
        try:
            due = parse_time(result['due_at'])
            if due.tzinfo and due < datetime.now(timezone.utc):
                result['status'] = 'overdue'
            elif result['status'] == 'overdue':
                result['status'] = 'pending'
        except ValueError:
            pass  # Legacy invalid deadlines are reported by quality checks.
    return result


def list_tasks(store: JsonStore, elder_id=None, shift_id=None, assigned_to=None, status=None, limit=100, offset=0):
    items = [task_view(item) for item in store.read()['care_tasks']]
    items = [item for item in items if (elder_id is None or item['elder_id'] == elder_id)
             and (shift_id is None or item['shift_id'] == shift_id)
             and (assigned_to is None or item['assigned_to'] == assigned_to)
             and (status is None or item['status'] == status)]
    return [CareTask.model_validate(item) for item in sorted(items, key=lambda item: item['id'])[offset:offset+limit]]


def actor_can_execute(item: dict, user_id: str, role: str):
    if role == 'caregiver' and item.get('assigned_to') not in {None, user_id}:
        raise DomainError('task_assigned_to_another_caregiver', 403)


def update(store: JsonStore, task_id: str, payload: TaskUpdateRequest, user_id: str) -> CareTask:
    def mutate(data):
        actor = current_staff(data, user_id, management=True)
        item = find(data, 'care_tasks', task_id, 'task_not_found')
        if item['status'] in {'completed', 'cancelled'}:
            raise DomainError('task_is_terminal')
        if payload.expected_revision != item.get('revision', 1):
            raise DomainError('stale_revision')
        open_shift(data, item.get('shift_id'), user_id, actor['role'])
        changes = payload.model_dump(mode='json', exclude_unset=True, exclude={'expected_revision'})
        if not changes:
            raise DomainError('no_task_changes', 422)
        if 'assigned_to' in changes:
            active_staff(data, changes['assigned_to'])
            if changes['assigned_to'] and item.get('shift_id'):
                shift = find(data, 'shifts', item['shift_id'], 'shift_not_found')
                if changes['assigned_to'] not in shift['caregiver_ids']:
                    raise DomainError('assignee_not_in_shift', 422)
        before = {key: item.get(key) for key in changes}
        item.update(changes, revision=item.get('revision', 1) + 1, updated_at=now())
        audit(data, 'update_task', task_id, user_id, elder_id=item['elder_id'], record_id=item.get('source_record_id'),
              detail='调整任务负责人或截止时间', before=before, after=changes)
        return CareTask.model_validate(task_view(item))
    return store.mutate(mutate)


def complete(store: JsonStore, task_id: str, user_id: str, role: str, result: str, key=None) -> CareTask:
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'care_tasks', task_id, 'task_not_found')
        actor_can_execute(item, user_id, role)
        def operation():
            if item['status'] == 'completed':
                if item.get('result') != result:
                    raise DomainError('completed_task_result_is_immutable')
                return CareTask.model_validate(item).model_dump()
            if item['status'] not in {'pending', 'in_progress', 'overdue'}:
                raise DomainError('task_must_be_active_to_complete')
            open_shift(data, item.get('shift_id'), user_id, role)
            from app.services.facility_service import care_eligible
            care_eligible(data, item['elder_id'])
            from app.services.task_condition_service import assert_ready
            at = now()
            from app.services.plan_service import assert_task_ready
            assert_task_ready(data, item, at)
            assert_ready(data, item, at)
            item.update(status='completed', result=result, completed_by=user_id, completed_at=at,
                        revision=item.get('revision', 1) + 1, updated_at=at)
            audit(data, 'complete_task', task_id, user_id, elder_id=item['elder_id'],
                  record_id=item.get('source_record_id'), detail=result)
            return CareTask.model_validate(item).model_dump()
        return replayable(data, user_id, 'complete_task', key, {'task_id': task_id, 'result': result}, operation)
    return CareTask.model_validate(store.mutate(mutate))


def transition(store: JsonStore, task_id: str, payload: TaskTransitionRequest, user_id: str, role: str, key=None):
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'care_tasks', task_id, 'task_not_found')
        def operation():
            # A successful transfer changes ownership. An identical retry by its
            # original actor must replay the saved result before this check.
            actor_can_execute(item, user_id, role)
            if payload.expected_revision != item.get('revision', 1):
                raise DomainError('stale_revision')
            if item['status'] in {'completed', 'cancelled'}:
                raise DomainError('task_is_terminal')
            open_shift(data, item.get('shift_id'), user_id, role)
            at = now()
            action = payload.action
            if action == 'cancel' and role not in {'admin', 'supervisor'}:
                raise DomainError('management_required_to_cancel', 403)
            if action in {'not_done', 'cancel', 'transfer', 'reopen'} and not payload.note:
                raise DomainError('transition_note_required', 422)
            before = dict(item)
            if action == 'start':
                if item['status'] not in {'pending', 'overdue'}:
                    raise DomainError('invalid_task_transition')
                from app.services.facility_service import care_eligible
                care_eligible(data, item['elder_id'])
                from app.services.task_condition_service import assert_ready
                from app.services.plan_service import assert_task_ready
                assert_task_ready(data, item, at)
                assert_ready(data, item, at)
                item['status'] = 'in_progress'
            elif action == 'not_done':
                if item['status'] not in {'pending', 'in_progress', 'overdue'} or not payload.reason_code:
                    raise DomainError('not_done_reason_required', 422)
                item.update(status='not_done', reason_code=payload.reason_code, result=payload.note)
            elif action == 'reopen':
                if item['status'] != 'not_done':
                    raise DomainError('only_not_done_tasks_can_reopen')
                item.update(status='pending', reason_code=None, result=None)
            elif action == 'transfer':
                if payload.assigned_to is None or payload.assigned_to == item.get('assigned_to'):
                    raise DomainError('different_assignee_required', 422)
                active_staff(data, payload.assigned_to)
                if item.get('shift_id'):
                    shift = find(data, 'shifts', item['shift_id'], 'shift_not_found')
                    if payload.assigned_to not in shift['caregiver_ids']:
                        raise DomainError('assignee_not_in_shift', 422)
                item['assigned_to'] = payload.assigned_to
            elif action == 'cancel':
                item.update(status='cancelled', result=payload.note)
            item.update(revision=item.get('revision', 1) + 1, updated_at=at)
            audit(data, f'task_{action}', task_id, user_id, elder_id=item['elder_id'],
                  record_id=item.get('source_record_id'), detail=payload.note or action,
                  before=before, after=dict(item))
            return task_view(item)
        return replayable(data, user_id, 'transition_task', key, {'task_id': task_id, **payload.model_dump()}, operation)
    return CareTask.model_validate(store.mutate(mutate))
