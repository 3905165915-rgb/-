"""Safe staff directory and provisioning; credentials never enter public/audit views."""
from app.services.facility_service import TERMINAL_TASKS, version
from app.services.passwords import hash_password
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now

STAFF_ROLES = {'admin', 'supervisor', 'caregiver'}


def staff_view(row):
    return {field: row.get(field, default) for field, default in (
        ('id', None), ('username', None), ('display_name', None), ('role', None),
        ('active', True), ('revision', 1), ('created_at', None), ('updated_at', None))}


def directory(store, active=None, limit=100, offset=0):
    rows = [staff_view(row) for row in store.read()['users']
            if row['role'] in STAFF_ROLES and (active is None or row.get('active', True) == active)]
    return rows[offset:offset + limit]


def workload_from_data(data, user_id):
    active_tasks = [row for row in data['care_tasks'] if row['status'] not in TERMINAL_TASKS]
    return {'task_ids': [row['id'] for row in active_tasks if row.get('assigned_to') == user_id],
            'condition_task_ids': [row['id'] for row in active_tasks if (row.get('condition_verification') or {}).get('checker_id') == user_id],
            'review_ids': [row['id'] for row in data['change_reviews'] if row.get('assigned_to') == user_id and row['status'] != 'closed'],
            'rectification_ids': [row['id'] for row in data['rectifications'] if row.get('assigned_to') == user_id and row['status'] != 'closed'],
            'open_shift_ids': [row['id'] for row in data['shifts'] if row.get('status') != 'closed' and user_id in row['caregiver_ids']]}


def workload(store, user_id):
    data = store.read()
    target = find(data, 'users', user_id, 'staff_not_found')
    if target['role'] not in STAFF_ROLES:
        raise DomainError('staff_not_found', 404)
    return {'staff': staff_view(target), **workload_from_data(data, user_id)}


def _allowed(actor, target_role):
    if actor['role'] != 'admin' and target_role != 'caregiver':
        raise DomainError('admin_required_to_manage_management_staff', 403)


def create(store, payload, user_id, role):
    # Salted password hashing is intentionally outside the file lock. No idempotency
    # cache for credentials: a retry gets username_taken, never a stored secret.
    encoded = hash_password(payload.password.get_secret_value())
    def mutate(data):
        actor = current_staff(data, user_id, role, management=True)
        _allowed(actor, payload.role)
        if any(row['username'].casefold() == payload.username.casefold() for row in data['users']):
            raise DomainError('username_taken')
        at = now()
        item = {'id': identifier('USER'), 'username': payload.username, 'display_name': payload.display_name,
                'role': payload.role, 'password_hash': encoded, 'active': True, 'revision': 1,
                'token_version': 0, 'created_at': at, 'updated_at': at}
        data['users'].append(item)
        public = staff_view(item)
        audit(data, 'create_staff', item['id'], user_id, detail='建立员工账号', after=public)
        return public
    return store.mutate(mutate)


def update(store, target_id, payload, user_id, role):
    def mutate(data):
        actor = current_staff(data, user_id, role, management=True)
        target = find(data, 'users', target_id, 'staff_not_found')
        if target['role'] not in STAFF_ROLES:
            raise DomainError('staff_not_found', 404)
        version(target, payload.expected_revision)
        changes = payload.model_dump(exclude_unset=True, exclude={'expected_revision', 'reason'})
        if not changes:
            raise DomainError('no_staff_changes', 422)
        auth_changed = any(field in changes and changes[field] != target.get(field, True) for field in ('role', 'active'))
        if target_id == user_id:
            if auth_changed:
                raise DomainError('cannot_change_own_role_or_active_state', 403)
        else:
            _allowed(actor, target['role'])
        if 'role' in changes:
            _allowed(actor, changes['role'])
        if changes.get('active') is False:
            work = workload_from_data(data, target_id)
            if any(work[field] for field in ('task_ids', 'condition_task_ids', 'review_ids', 'rectification_ids')):
                raise DomainError('reassign_staff_work_before_disabling')
        if target['role'] == 'admin' and (changes.get('active') is False or changes.get('role', 'admin') != 'admin'):
            if not any(row['id'] != target_id and row['role'] == 'admin' and row.get('active', True) for row in data['users']):
                raise DomainError('last_active_admin_required')
        before = staff_view(target)
        if auth_changed:
            target['token_version'] = target.get('token_version', 0) + 1
        target.update(changes, revision=target.get('revision', 1) + 1, updated_at=now())
        after = staff_view(target)
        audit(data, 'update_staff', target_id, user_id, detail=payload.reason, before=before, after=after)
        return after
    return store.mutate(mutate)


def reset_password(store, target_id, payload, user_id, role):
    encoded = hash_password(payload.password.get_secret_value())
    def mutate(data):
        actor = current_staff(data, user_id, role, management=True)
        target = find(data, 'users', target_id, 'staff_not_found')
        if target['role'] not in STAFF_ROLES:
            raise DomainError('staff_not_found', 404)
        if target_id != user_id:
            _allowed(actor, target['role'])
        version(target, payload.expected_revision)
        target.update(password_hash=encoded, token_version=target.get('token_version', 0) + 1,
                      revision=target.get('revision', 1) + 1, updated_at=now())
        audit(data, 'reset_staff_password', target_id, user_id, detail=payload.reason)
        return staff_view(target)
    return store.mutate(mutate)
