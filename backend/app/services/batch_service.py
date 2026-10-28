"""Isolate each item's mutation, then commit all receipts atomically."""
from copy import deepcopy
from app.services.workflow import DomainError, current_staff, replayable
from app.services.elder_workspace_service import TransactionStore


def execute(store, payload, user_id, role, kind, key=None, preview=False):
    expected = 'transfer' if kind == 'tasks' else 'read'
    if payload.action != expected:
        raise DomainError('batch_action_not_allowed', 422)
    def commit(data):
        current_staff(data, user_id, role, management=kind == 'tasks')
        def operation():
            results = []
            for item in payload.items:
                staged = deepcopy(data)
                nested = TransactionStore(staged)
                try:
                    if kind == 'tasks':
                        from app.services.task_service import transition
                        from app.schemas.api import TaskTransitionRequest
                        task = next((t for t in staged['care_tasks'] if t['id'] == item.id), None)
                        if task and (task.get('condition') or task.get('condition_verification')
                                     or task.get('source_plan_id') or task.get('source_advice_id')):
                            raise DomainError('batch_task_requires_individual_review', 409)
                        result = transition(nested, item.id, TaskTransitionRequest(action='transfer',
                            expected_revision=item.expected_revision, assigned_to=item.assigned_to,
                            note=payload.note), user_id, role).model_dump(mode='json')
                    else:
                        from app.services.notification_service import act
                        from app.schemas.batch import NotificationRead
                        result = act(nested, item.id, NotificationRead(expected_revision=item.expected_revision), user_id, role)
                    data.clear()
                    data.update(staged)
                    results.append({'id': item.id, 'success': True, 'result': result})
                except DomainError as exc:
                    results.append({'id': item.id, 'success': False, 'error_code': exc.code,
                                    'status_code': exc.status_code,
                                    'message': '本项未处理，请打开事项核对权限、版本及当前状态。'})
            return {'action': expected, 'preview': preview, 'items': results,
                    'succeeded': sum(r['success'] for r in results),
                    'failed': sum(not r['success'] for r in results)}
        return operation() if preview else replayable(data, user_id, 'batch_' + kind, key,
                                                    payload.model_dump(mode='json'), operation)
    # A preview runs the identical checks against an isolated snapshot.
    return commit(deepcopy(store.read())) if preview else store.mutate(commit)
