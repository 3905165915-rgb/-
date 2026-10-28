import copy

import pytest

from app.schemas.incident import IncidentCreate, IncidentPrepare
from app.services import incident_service
from app.services.workflow import DomainError
from test_facility import legacy, post
from test_family import get, instant
from test_incidents import report, triage, submit, review
from test_staff_management import account, login


def accounts(api):
    def seed(data):
        for name, role in [('nurse', 'nurse'), ('admin', 'admin')]:
            data['users'].append({**data['users'][0], 'id': name, 'username': name, 'role': role})
        data['care_assignments'].append({**data['care_assignments'][0], 'id': 'NURSE-SCOPE', 'caregiver_id': 'nurse'})
    api[1].mutate(seed)


@pytest.mark.parametrize('actor', ['staff', 'nurse'])
def test_frontline_reports_without_record_or_ai_and_manager_opens_details(api, actor):
    accounts(api)
    state = legacy(api)
    body = {'elder_id': 'E1', 'admission_id': state['admission']['id'], 'occurred_at': instant(),
            'description': '发现地面湿滑，已通知现场人员', 'immediate_action': '已扶老人离开湿滑区域'}
    item = post(api, '/incidents', body, actor=actor)
    assert item['status'] == 'reported' and item['evidence'] == []
    assert api[1].read()['care_records'] == []
    for manager in ['manager', 'admin']:
        assert get(api, f'/incidents/{item["id"]}', manager)['id'] == item['id']
        page = get(api, '/notifications?pending=true', manager)
        assert page['urgent_total'] == 1
        assert page['items'][0]['object_id'] == item['id']
        assert page['items'][0]['priority'] == 'urgent'
    get(api, f'/incidents/{item["id"]}', 'other', 403)
    client, _, headers = api
    assert client.post('/api/v1/incidents/' + item['id'] + '/triage', json={}, headers=headers(actor)).status_code == 403


@pytest.mark.parametrize('actor', ['manager', 'admin', 'family'])
def test_only_frontline_can_create_or_prepare_even_at_service_boundary(api, actor):
    accounts(api)
    state = legacy(api)
    body = {'elder_id': 'E1', 'admission_id': state['admission']['id'], 'occurred_at': instant(),
            'description': '发现地面湿滑', 'immediate_action': '已扶老人离开'}
    post(api, '/incidents', body, actor=actor, expected=403)
    draft = {'elder_id': 'E1', 'description': '发现地面湿滑'}
    post(api, '/incidents/prepare', draft, actor=actor, expected=403)
    role = {'manager': 'supervisor', 'admin': 'admin', 'family': 'family'}[actor]
    with pytest.raises(DomainError):
        incident_service.create(api[1], IncidentCreate(**body), actor, role)
    with pytest.raises(DomainError):
        incident_service.prepare(api[1], IncidentPrepare(**draft), actor, role)
    assert api[1].read()['incidents'] == []


def test_nurse_login_scope_and_management_isolation(api):
    accounts(api)
    state = legacy(api)
    client, store, headers = api
    login = client.post('/api/v1/auth/login', json={'username': 'nurse', 'password': 'test-password'})
    assert login.status_code == 200 and login.json()['role'] == 'nurse'
    assert get(api, '/elders', 'nurse')[0]['id'] == 'E1'
    store.mutate(lambda data: data['care_assignments'].clear())
    assert get(api, '/elders', 'nurse') == []
    post(api, '/incidents', {'elder_id': 'E1', 'admission_id': state['admission']['id'],
         'occurred_at': instant(), 'description': '发现异常', 'immediate_action': '通知现场人员'}, actor='nurse', expected=403)
    assert client.get('/api/v1/staff/nurse/workload', headers=headers('nurse')).status_code == 403


def test_urgent_sort_before_pagination_read_receipt_and_closure(api):
    _, _, body, item = report(api)
    client, store, headers = api
    first = get(api, '/notifications?pending=true', 'manager')['items'][0]
    def ordinary(data):
        data['care_tasks'].append({'id': 'TASK-ORDINARY', 'assigned_to': 'manager', 'status': 'pending', 'elder_id': 'E1'})
        notice = copy.deepcopy(data['notifications'][0])
        notice.update(id='NOTICE-ORDINARY', object_type='care_tasks', object_id='TASK-ORDINARY', stage='task', title='普通任务')
        data['notifications'].append(notice)
    store.mutate(ordinary)
    page = get(api, '/notifications?pending=true&limit=1', 'manager')
    assert page['items'][0]['id'] == first['id'] and page['urgent_total'] == 1
    post(api, '/notifications/' + first['id'] + '/actions', {'expected_revision': first['revision'], 'action': 'read'}, expected=200)
    assert get(api, '/notifications?unread=true', 'manager')['urgent_total'] == 1
    assert get(api, '/notifications?pending=true&limit=1', 'manager')['items'][0]['priority'] == 'urgent'
    assigned = triage(api, item, body['evidence'])
    assert get(api, '/notifications?pending=true', 'staff')['urgent_total'] == 1
    final = review(api, submit(api, assigned, body['evidence']))
    assert final['status'] == 'closed'
    for actor in ['manager', 'staff', 'other']:
        assert get(api, '/notifications?pending=true', actor)['urgent_total'] == 0


def test_legacy_notification_receives_urgent_metadata(api):
    api[1].mutate(lambda data: data['incidents'].append({'id': 'OLD-PENDING', 'elder_id': 'E1',
        'status': 'reported', 'created_by': 'staff'}))
    page = get(api, '/notifications?pending=true', 'manager')
    assert page['urgent_total'] == 1 and page['items'][0]['priority'] == 'urgent'
    assert get(api, '/notifications?pending=true', 'other')['urgent_total'] == 0


def test_supervisor_provisions_nurse_with_scoped_access(api):
    nurse = account(api, username='new-nurse', role='nurse')
    signed = login(api, nurse['username'])
    assert signed['role'] == 'nurse'
    assert any(row['id'] == nurse['id'] for row in get(api, '/staff/directory', 'manager'))
    assert get(api, '/elders', nurse['id']) == []
