def task(api, manual_payload):
    client, _, headers = api
    return client.post('/api/v1/records/manual', json=manual_payload, headers=headers()).json()['tasks'][0]


def test_repeat_completion_is_immutable_and_audited_once(api, manual_payload):
    client, store, headers = api
    item = task(api, manual_payload)
    auth = {**headers(), 'Idempotency-Key': 'finish-1'}
    url = f'/api/v1/tasks/{item["id"]}/complete'
    first = client.post(url, json={'result': '已联系'}, headers=auth)
    assert first.status_code == 200
    assert client.post(url, json={'result': '已联系'}, headers=auth).json() == first.json()
    assert client.post(url, json={'result': '已联系'}, headers=headers()).json() == first.json()
    assert client.post(url, json={'result': '不同结果'}, headers=auth).status_code == 409
    assert client.post(url, json={'result': '不同结果'}, headers=headers()).status_code == 409
    assert len([event for event in store.read()['audit_logs'] if event['action'] == 'complete_task']) == 1


def test_assignment_deadline_and_authorization(api, manual_payload):
    client, _, headers = api
    item = task(api, manual_payload)
    url = f'/api/v1/tasks/{item["id"]}'
    payload = {'expected_revision': 1, 'assigned_to': 'other', 'due_at': '2026-01-01T08:00:00+08:00'}
    assert client.patch(url, json=payload, headers=headers()).status_code == 403
    updated = client.patch(url, json=payload, headers=headers('manager'))
    assert updated.status_code == 200 and updated.json()['status'] == 'overdue'
    assert client.post(url + '/complete', json={'result': '完成'}, headers=headers()).status_code == 403
    assert client.post(url + '/complete', json={'result': '完成'}, headers=headers('other')).status_code == 200


def test_reason_codes_reopen_and_optimistic_concurrency(api, manual_payload):
    client, _, headers = api
    item = task(api, manual_payload)
    url = f'/api/v1/tasks/{item["id"]}/transition'
    missing = {'action': 'not_done', 'expected_revision': 1, 'note': '老人外出'}
    assert client.post(url, json=missing, headers=headers()).status_code == 422
    stopped = client.post(url, json={**missing, 'reason_code': 'out'}, headers=headers())
    assert stopped.status_code == 200 and stopped.json()['status'] == 'not_done'
    assert client.post(url, json={**missing, 'reason_code': 'out'}, headers=headers()).status_code == 409
    reopened = client.post(url, json={'action': 'reopen', 'expected_revision': 2, 'note': '已返回'}, headers=headers())
    assert reopened.status_code == 200 and reopened.json()['status'] == 'pending'
    assert client.post(url, json={'action': 'cancel', 'expected_revision': 3, 'note': '计划取消'}, headers=headers()).status_code == 403
    assert client.post(url, json={'action': 'cancel', 'expected_revision': 3, 'note': '计划取消'}, headers=headers('manager')).json()['status'] == 'cancelled'
def test_staff_lookup_excludes_credentials_and_family(api):
    client, _, headers = api
    result = client.get('/api/v1/staff', headers=headers('manager'))
    assert result.status_code == 200
    assert {row['id'] for row in result.json()} == {'staff', 'other', 'manager'}
    assert all(set(row) == {'id', 'display_name', 'role'} for row in result.json())
    assert client.get('/api/v1/staff', headers=headers()).status_code == 403
    assert client.get('/api/v1/staff', headers=headers('family')).status_code == 403
