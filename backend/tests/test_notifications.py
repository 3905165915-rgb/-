from test_incidents import report, triage, submit, review


def notices(api, actor='manager', **params):
    client, _, headers = api
    response = client.get('/api/v1/notifications', params=params, headers=headers(actor))
    assert response.status_code == 200, response.text
    return response.json()['items']


def test_incident_notifications_are_transactional_read_is_not_done_and_return_is_business_driven(api):
    client, store, headers = api
    _, _, body, item = report(api)
    pending = notices(api, pending=True)
    assert len(pending) == 1 and pending[0]['stage'] == 'triage'
    assert notices(api, 'other') == []
    notice = pending[0]
    result = client.post('/api/v1/notifications/' + notice['id'] + '/actions',
                         json={'expected_revision': 1, 'action': 'read'}, headers=headers('manager'))
    assert result.status_code == 200 and result.json()['status'] == 'pending'
    assert notices(api, unread=True) == []
    assert len(notices(api, pending=True)) == 1
    assert store.read()['incidents'][0]['status'] == 'reported'
    assigned = triage(api, item, body['evidence'])
    assert notices(api, pending=True) == []
    staff = notices(api, 'staff', pending=True)
    assert len(staff) == 1 and staff[0]['stage'] == 'rectify'
    request = {'expected_revision': staff[0]['revision'], 'action': 'accept'}
    endpoint = '/api/v1/notifications/' + staff[0]['id'] + '/actions'
    denied = client.post(endpoint, json=request, headers=headers('other'))
    assert denied.status_code == 403
    h = {**headers(), 'Idempotency-Key': 'accept'}
    accepted = client.post(endpoint, json=request, headers=h)
    assert accepted.status_code == 200 and accepted.json()['status'] == 'accepted'
    assert client.post(endpoint, json=request, headers=h).json() == accepted.json()
    assert store.read()['incidents'][0]['status'] == 'rectifying'
    submitted = submit(api, assigned, body['evidence'], key='submit')
    before = len(store.read()['notifications'])
    assert submit(api, assigned, body['evidence'], key='submit') == submitted
    assert len(store.read()['notifications']) == before
    assert notices(api, pending=True)[0]['stage'] == 'review'
    returned = review(api, submitted, 'return')
    assert notices(api, 'staff', pending=True)[0]['returned'] is True
    final = review(api, submit(api, returned, body['evidence']))
    assert final['status'] == 'closed'
    assert notices(api, pending=True) == notices(api, 'staff', pending=True) == []


def test_failed_business_write_does_not_send_notice(api):
    client, store, headers = api
    _, _, body, item = report(api)
    before = store.read()['notifications']
    payload = {'expected_revision': 99, 'category': 'fall', 'severity': 'low',
               'classification_basis': '现场核实', 'assigned_to': 'staff', 'due_at': '2099-01-01T00:00:00Z',
               'corrective_plan': '检查环境', 'evidence': body['evidence'], 'reason': '安排整改'}
    assert client.post('/api/v1/incidents/' + item['id'] + '/triage', json=payload, headers=headers('manager')).status_code == 409
    assert store.read()['notifications'] == before


def test_family_cannot_open_internal_notifications(api):
    client, _, headers = api
    assert client.get('/api/v1/notifications', headers=headers('family')).status_code == 403


def test_due_memory_reminder_is_durable_deduplicated_and_does_not_invalidate_memory(api):
    from test_assistant import create_memory
    memory, _ = create_memory(api)
    def due(data):
        item = next(r for r in data['care_memories'] if r['id'] == memory['id'])
        item['valid_from'] = '2020-01-01T00:00:00Z'
        item['review_due_at'] = '2020-01-02T00:00:00Z'
    api[1].mutate(due)
    first = notices(api, pending=True)
    matching = [r for r in first if r['object_id'] == memory['id']]
    assert len(matching) == 1 and matching[0]['stage'] == 'memory_review'
    count = len(api[1].read()['notifications'])
    assert notices(api, pending=True) == first
    assert len(api[1].read()['notifications']) == count
    from app.services.memory_service import detail
    assert detail(api[1], memory['id'])['effective'] is True


def test_existing_pending_work_is_visible_after_migration_without_replaying_business(api):
    _, store, _ = api
    store.mutate(lambda data: data['incidents'].append({'id': 'OLD-PENDING', 'elder_id': 'E1',
        'status': 'reported', 'created_by': 'staff'}))
    first = notices(api, pending=True)
    assert len(first) == 1 and first[0]['object_id'] == 'OLD-PENDING'
    total = len(store.read()['notifications'])
    assert notices(api, pending=True) == first
    assert len(store.read()['notifications']) == total
    assert store.read()['incidents'][0]['status'] == 'reported'
