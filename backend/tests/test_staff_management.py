import copy
import json

import pytest

from app.schemas.facility import StaffUpdate
from app.services import staff_service
from app.services.workflow import DomainError
from test_facility import ROOT, patch, post

PASSWORD = 'synthetic-test-password-only'


@pytest.fixture
def admin(api):
    _, store, _ = api
    def seed(data):
        row = copy.deepcopy(data['users'][2])
        row.update(id='admin', username='admin', role='admin', display_name='测试管理员')
        data['users'].append(row)
    store.mutate(seed)
    return 'admin'


def account(api, username='new-caregiver', role='caregiver', actor='manager', expected=201):
    return post(api, '/staff', {'username': username, 'display_name': '虚构员工', 'role': role, 'password': PASSWORD}, actor, expected)


def login(api, username, password=PASSWORD, expected=200):
    client, _, _ = api
    result = client.post(ROOT + '/auth/login', json={'username': username, 'password': password})
    assert result.status_code == expected, result.text
    return result.json()


def test_staff_create_login_safe_directory_and_legacy_lookup(api):
    client, store, headers = api
    user = account(api)
    assert user['role'] == 'caregiver' and user['revision'] == 1
    assert not {'password', 'password_hash', 'token_version'} & user.keys()
    signed = login(api, user['username'])
    assert client.get(ROOT + '/elders', headers={'Authorization': 'Bearer ' + signed['access_token']}).status_code == 200
    directory = client.get(ROOT + '/staff/directory', headers=headers('manager')).json()
    assert user in directory and not any(row['role'] == 'family' for row in directory)
    lookup = client.get(ROOT + '/staff', headers=headers('manager')).json()
    assert all(set(row) == {'id', 'display_name', 'role'} for row in lookup)
    raw = store.read()
    stored = next(row for row in raw['users'] if row['id'] == user['id'])
    assert stored['password_hash'].startswith('pbkdf2$') and stored['password_hash'] != PASSWORD
    del raw['users']
    assert PASSWORD not in json.dumps(raw) and 'password_hash' not in json.dumps(raw)
    # Credential endpoints do not cache bodies/responses in idempotency storage.
    assert not raw['idempotency_keys']


@pytest.mark.parametrize('role', ['supervisor', 'admin'])
def test_supervisor_cannot_provision_or_promote_management(api, role):
    account(api, role=role, expected=403)
    patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '提升账号权限', 'role': role}, expected=403)


def test_admin_can_manage_management_accounts_but_not_family(api, admin):
    user = account(api, username='new-supervisor', role='supervisor', actor=admin)
    changed = patch(api, '/staff/' + user['id'], {'expected_revision': 1, 'reason': '调整角色', 'role': 'caregiver'}, actor=admin)
    assert changed['role'] == 'caregiver'
    patch(api, '/staff/family', {'expected_revision': 1, 'reason': '尝试改造家属账号', 'role': 'caregiver'}, actor=admin, expected=404)


@pytest.mark.parametrize('changes', [{'active': False}, {'role': 'caregiver'}])
def test_admin_cannot_disable_or_demote_self(api, admin, changes):
    patch(api, '/staff/admin', {'expected_revision': 1, 'reason': '修改本人', **changes}, actor=admin, expected=403)


def test_supervisor_cannot_modify_or_reset_admin(api, admin):
    patch(api, '/staff/admin', {'expected_revision': 1, 'reason': '修改管理员', 'display_name': '改名'}, expected=403)
    post(api, '/staff/admin/reset-password', {'expected_revision': 1, 'reason': '重置管理员', 'password': PASSWORD}, expected=403)
    changed = patch(api, '/staff/manager', {'expected_revision': 1, 'reason': '修改本人显示名', 'display_name': '测试主管新名'})
    assert changed['display_name'] == '测试主管新名'


def test_disable_and_reenable_never_revive_old_jwt(api):
    client, _, headers = api
    old = headers('staff')
    disabled = patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '测试停用', 'active': False})
    assert not disabled['active']
    assert client.get(ROOT + '/elders', headers=old).status_code == 401
    login(api, 'staff', 'test-password', expected=401)
    assert all(row['id'] != 'staff' for row in client.get(ROOT + '/staff', headers=headers('manager')).json())
    assert client.get(ROOT + '/staff/directory?active=false', headers=headers('manager')).json() == [disabled]
    enabled = patch(api, '/staff/staff', {'expected_revision': 2, 'reason': '恢复账号', 'active': True})
    assert enabled['active']
    assert client.get(ROOT + '/elders', headers=old).status_code == 401
    signed = login(api, 'staff', 'test-password')
    assert client.get(ROOT + '/elders', headers={'Authorization': 'Bearer ' + signed['access_token']}).status_code == 200


def test_role_change_then_restore_does_not_revive_old_jwt(api, admin):
    client, _, headers = api
    old = headers('staff')
    patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '调整职责', 'role': 'supervisor'}, actor=admin)
    patch(api, '/staff/staff', {'expected_revision': 2, 'reason': '恢复职责', 'role': 'caregiver'}, actor=admin)
    assert client.get(ROOT + '/elders', headers=old).status_code == 401


def test_password_reset_revokes_tokens_and_never_leaks_secret(api):
    client, store, headers = api
    old = headers('staff')
    changed = post(api, '/staff/staff/reset-password', {'expected_revision': 1, 'reason': '人工核实后重置密码',
                   'password': PASSWORD}, expected=200)
    assert changed['revision'] == 2 and 'password_hash' not in changed
    assert client.get(ROOT + '/elders', headers=old).status_code == 401
    login(api, 'staff', 'test-password', expected=401)
    signed = login(api, 'staff')
    assert client.get(ROOT + '/elders', headers={'Authorization': 'Bearer ' + signed['access_token']}).status_code == 200
    assert PASSWORD not in store.path.read_text(encoding='utf-8')
    before = store.path.read_bytes()
    post(api, '/staff/staff/reset-password', {'expected_revision': 1, 'reason': '旧版本重试', 'password': PASSWORD}, expected=409)
    assert store.path.read_bytes() == before


def test_inactive_username_not_reusable_and_legacy_casefold_checked(api):
    _, store, _ = api
    user = account(api)
    patch(api, '/staff/' + user['id'], {'expected_revision': 1, 'reason': '离职停用', 'active': False})
    assert account(api, expected=409)['detail'] == 'username_taken'
    store.mutate(lambda data: data['users'].append({**data['users'][0], 'id': 'mixed-case', 'username': 'Old-USER'}))
    account(api, username='old-user', expected=409)


@pytest.mark.parametrize('payload', [
    {'username': 'short-pass', 'display_name': '新员工', 'password': 'short'},
    {'username': 'valid-name', 'password': PASSWORD},
    {'username': 'valid-name', 'display_name': '新员工', 'password': PASSWORD, 'role': 'family'},
    {'username': 'valid-name', 'display_name': '新员工', 'password': PASSWORD, 'password_hash': 'injection'},
])
def test_invalid_staff_body_does_not_echo_plaintext_credentials(api, payload):
    client, store, headers = api
    before = store.path.read_bytes()
    result = client.post(ROOT + '/staff', headers=headers('manager'), json=payload)
    assert result.status_code == 422
    assert payload['password'] not in result.text
    assert all('input' not in row for row in result.json()['detail'])
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('obligation', ['task', 'condition', 'review'])
def test_disable_requires_reassignment_of_current_responsibilities(api, manual_payload, obligation):
    client, store, headers = api
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    def seed(data):
        if obligation == 'task':
            data['care_tasks'][0]['assigned_to'] = 'staff'
        elif obligation == 'condition':
            data['care_tasks'][0]['condition_verification'] = {'checker_id': 'staff'}
        else:
            data['change_reviews'].append({'id': 'test-review', 'assigned_to': 'staff', 'status': 'assigned'})
    store.mutate(seed)
    work = client.get(ROOT + '/staff/staff/workload', headers=headers('manager')).json()
    field = {'task': 'task_ids', 'condition': 'condition_task_ids', 'review': 'review_ids'}[obligation]
    assert work[field]
    before = store.path.read_bytes()
    result = patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '停用前检查责任', 'active': False}, expected=409)
    assert result['detail'] == 'reassign_staff_work_before_disabling' and store.path.read_bytes() == before
    def reassign(data):
        if obligation == 'task':
            data['care_tasks'][0]['assigned_to'] = 'other'
        elif obligation == 'condition':
            data['care_tasks'][0]['condition_verification']['checker_id'] = 'other'
        else:
            data['change_reviews'][0]['assigned_to'] = 'other'
    store.mutate(reassign)
    assert not patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '责任已交接后停用', 'active': False})['active']


def test_terminal_tasks_do_not_block_disable_and_history_retained(api, manual_payload):
    _, store, _ = api
    task = post(api, '/records/manual', {**manual_payload, 'task_candidates': [{'title': '联系家属', 'assigned_to': 'staff'}]}, actor='staff')['tasks'][0]
    post(api, f'/tasks/{task["id"]}/complete', {'result': '已联系'}, actor='staff', expected=200)
    original = copy.deepcopy(store.read()['care_tasks'][0])
    patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '已交接全部工作', 'active': False})
    assert store.read()['care_tasks'][0] == original


def test_staff_update_optimistic_version_and_unknown_fields(api):
    patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '更正显示名', 'display_name': '护理员新名'})
    patch(api, '/staff/staff', {'expected_revision': 1, 'reason': '旧请求', 'active': False}, expected=409)
    for changes in ({'active': None}, {'display_name': None}, {'username': 'rename'}, {'password': PASSWORD}):
        patch(api, '/staff/staff', {'expected_revision': 2, 'reason': '非法字段', **changes}, expected=422)


def test_staff_write_rechecks_current_actor_under_lock(api):
    _, store, _ = api
    store.mutate(lambda data: data['users'][2].update(role='caregiver'))
    before = store.path.read_bytes()
    with pytest.raises(DomainError) as exc:
        staff_service.update(store, 'staff', StaffUpdate(expected_revision=1, display_name='改名', reason='旧权限'), 'manager', 'supervisor')
    assert exc.value.status_code == 403 and store.path.read_bytes() == before
