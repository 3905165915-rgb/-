"""Server-side work scopes for the caregiver workbench.

Work scope comes from time-bounded explicit care assignments, temporary support,
current open-shift tasks, or nonterminal tasks assigned to the caregiver. A past
record never creates a permanent care relationship.
"""
from __future__ import annotations

from app.services.task_service import task_view
from app.services.workflow import current_staff, find
from app.services.workflow import now, parse_time, active_staff, audit, identifier, replayable, DomainError

TERMINAL = {'completed', 'not_done', 'cancelled'}


def _open_shift_ids(data, user_id):
    instant = parse_time(now())
    return {
        shift['id'] for shift in data['shifts']
        if shift.get('status') == 'open' and user_id in shift.get('caregiver_ids', [])
        and (not shift.get('start_at') or parse_time(shift['start_at']) <= instant)
        and (not shift.get('end_at') or instant < parse_time(shift['end_at']))
    }


def _assignments(data, user_id):
    instant = parse_time(now())
    return [row for row in data['care_assignments'] if row['caregiver_id'] == user_id
            and row['status'] == 'active'
            and parse_time(row['start_at']) <= instant < parse_time(row['end_at'])]


def _current_ids(data, user_id):
    shift_ids = _open_shift_ids(data, user_id)
    return {row['elder_id'] for row in _assignments(data, user_id)} | {
        task['elder_id'] for task in data['care_tasks']
        if task.get('status', 'pending') not in TERMINAL
        and (task.get('assigned_to') == user_id or task.get('shift_id') in shift_ids)
    }


def elder_ids(data, user_id, role):
    """Return the elders in an actor's current work scope.

    Management roles are intentionally institution-wide.  A caregiver's scope
    is limited to live task responsibility and current shift membership; this
    supports the workbench without turning historical activity into access.
    """
    current_staff(data, user_id, role)
    if role in {'admin', 'supervisor'}:
        return {row['id'] for row in data['elders'] if row.get('status', 'active') in {'active', 'out'}}
    scope = _current_ids(data, user_id)
    return scope & {r['id'] for r in data['elders'] if r.get('status', 'active') in {'active', 'out'}}


def require_elder_access(data, elder_id, user_id, role):
    elder = find(data, 'elders', elder_id, 'elder_not_found')
    current_staff(data, user_id, role)
    if role in {'admin', 'supervisor'}:
        return elder
    if elder.get('status', 'active') not in {'active', 'out'} and elder_id in _current_ids(data, user_id):
        # Still deny access, but preserve the care-lifecycle conflict for a
        # currently assigned worker instead of disguising it as missing access.
        raise DomainError('elder_not_in_care')
    if elder_id not in elder_ids(data, user_id, role):
        raise DomainError('elder_not_in_current_work_scope', 403)
    return elder


def worklist(store, user_id, role):
    data = store.read()
    current_staff(data, user_id, role)
    scope = elder_ids(data, user_id, role)
    shifts = _open_shift_ids(data, user_id) if role == 'caregiver' else set()
    elders = {row['id']: row for row in data['elders'] if row['id'] in scope}
    rows = []
    for elder_id in sorted(scope):
        elder = elders.get(elder_id)
        if not elder:
            continue
        tasks = [task_view(row) for row in data['care_tasks'] if row.get('elder_id') == elder_id
                 and row.get('status', 'pending') not in TERMINAL
                 and (role in {'admin', 'supervisor'} or row.get('assigned_to') == user_id or row.get('shift_id') in shifts)]
        assignments = [row for row in _assignments(data, user_id) if row['elder_id'] == elder_id]
        rows.append({
            'elder': {'id': elder['id'], 'name': elder['name'], 'bed_id': elder.get('bed_id'),
                      'status': elder.get('status', 'active')},
            'scope_reasons': sorted({row['kind'] for row in assignments} | {
                'explicit_task_assignment' if task.get('assigned_to') == user_id else 'open_shift_membership'
                for task in tasks
            }) if role == 'caregiver' else ['management_access'],
            'open_tasks': tasks,
            'assignment_ids': [row['id'] for row in assignments],
            'pending_count': sum(task['status'] in {'pending', 'in_progress', 'overdue'} for task in tasks),
            'overdue_count': sum(task['status'] == 'overdue' for task in tasks),
        })
    return {'scope_rule': ('护理员查看有效分配、临时支援、明确分配任务或当前开放班次待办关联的老人；历史记录不授予权限。'
                           if role == 'caregiver' else '管理人员机构范围查看。'),
            'items': rows}


def assign(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            from app.services.facility_service import care_eligible
            care_eligible(data, payload.elder_id)
            active_staff(data, payload.caregiver_id)
            if find(data, 'users', payload.caregiver_id, 'assignee_not_found')['role'] != 'caregiver':
                raise DomainError('care_assignment_requires_caregiver', 422)
            if not payload.start_at < payload.end_at or payload.end_at <= parse_time(now()):
                raise DomainError('care_assignment_time_invalid', 422)
            item = {'id': identifier('SCOPE'), **payload.model_dump(mode='json'), 'status': 'active',
                    'revision': 1, 'created_by': user_id, 'created_at': now()}
            data['care_assignments'].append(item)
            audit(data, 'assign_care_scope', item['id'], user_id, elder_id=item['elder_id'])
            return dict(item)
        return replayable(data, user_id, 'assign_care_scope', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def revoke(store, assignment_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'care_assignments', assignment_id, 'care_assignment_not_found')
            from app.services.facility_service import version
            version(item, payload.expected_revision)
            if item['status'] != 'active':
                raise DomainError('care_assignment_already_revoked')
            item.update(status='revoked', revision=item['revision'] + 1, revoked_at=now(),
                        revoked_by=user_id, revoked_reason=payload.reason)
            audit(data, 'revoke_care_scope', item['id'], user_id, elder_id=item['elder_id'])
            return dict(item)
        return replayable(data, user_id, 'revoke_care_scope', key, {'id': assignment_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
