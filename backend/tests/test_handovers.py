def shifts(api):
    client, _, headers = api
    first = client.post('/api/v1/shifts', json={
        'name': '夜班', 'start_at': '2026-10-18T20:00:00+08:00', 'end_at': '2026-10-19T08:00:00+08:00', 'caregiver_ids': ['staff'],
    }, headers=headers('manager'))
    second = client.post('/api/v1/shifts', json={
        'name': '白班', 'start_at': '2026-10-19T08:00:00+08:00', 'end_at': '2026-10-19T20:00:00+08:00', 'caregiver_ids': ['other'],
    }, headers=headers('manager'))
    assert first.status_code == second.status_code == 201
    return first.json(), second.json()


def prepare(api, manual_payload):
    client, _, headers = api
    source, target = shifts(api)
    record = client.post('/api/v1/records/manual', json={**manual_payload, 'shift_id': source['id']}, headers=headers()).json()
    handover = client.post('/api/v1/handovers', json={'source_shift_id': source['id'], 'target_shift_id': target['id']}, headers=headers()).json()
    return source, target, record, handover


def test_cross_midnight_handover_keeps_same_task_and_timeline(api, manual_payload):
    client, store, headers = api
    source, target, record, handover = prepare(api, manual_payload)
    ho_url = f'/api/v1/handovers/{handover["id"]}'
    task_item = next(item for item in handover['items'] if item['kind'] == 'task')
    receive = ho_url + f'/items/{task_item["id"]}/receive'
    assert client.post(receive, json={'status': 'received'}, headers=headers('other')).status_code == 409
    submitted = client.post(ho_url + '/submit', json={'expected_revision': 1}, headers=headers())
    assert submitted.status_code == 200
    assert client.post(receive, json={'status': 'received'}, headers=headers()).status_code == 403
    assert client.post('/api/v1/records/manual', json={**manual_payload, 'shift_id': source['id']}, headers=headers()).status_code == 409
    for item in handover['items']:
        result = client.post(ho_url + f'/items/{item["id"]}/receive', json={'status': 'received'}, headers=headers('other'))
        assert result.status_code == 200
    assert result.json()['status'] == 'received'
    old_id = record['tasks'][0]['id']
    current = store.read()['care_tasks'][0]
    assert current['id'] == old_id and current['shift_id'] == target['id']
    assert current['continuity_key'] == old_id and current['assigned_to'] == 'other'
    assert len(store.read()['care_tasks']) == 1
    assert client.post(receive, json={'status': 'received'}, headers=headers('other')).status_code == 200
    assert len([row for row in store.read()['audit_logs'] if row['action'] == 'carry_task']) == 1
    assert client.post(f'/api/v1/tasks/{old_id}/complete', json={'result': '完成反馈'}, headers=headers('other')).status_code == 200
    events = client.get(f'/api/v1/items/{old_id}/timeline', headers=headers()).json()
    actions = {event['action'] for event in events}
    assert {'create_manual_record', 'create_task', 'submit_handover', 'carry_task', 'complete_task'} <= actions
    assert client.get(f'/api/v1/items/{old_id}/timeline', headers=headers('family')).status_code == 403


def test_handover_requires_refresh_for_new_or_corrected_records(api, manual_payload):
    client, _, headers = api
    source, _, record, handover = prepare(api, manual_payload)
    url = f'/api/v1/handovers/{handover["id"]}'
    client.post(f'/api/v1/records/{record["record"]["id"]}/corrections', json={
        'observations': ['更正后的观察'], 'reason': '复核', 'expected_revision': 1,
    }, headers=headers())
    assert client.post(url + '/submit', json={'expected_revision': 1}, headers=headers()).status_code == 409
    refreshed = client.post(url + '/refresh', headers=headers()).json()
    assert refreshed['revision'] == 2
    assert client.post(url + '/submit', json={'expected_revision': 2}, headers=headers()).status_code == 200
    assert client.post(url + '/refresh', headers=headers()).status_code == 409


def test_clarification_is_kept_until_receiver_confirms(api, manual_payload):
    client, _, headers = api
    _, _, _, handover = prepare(api, manual_payload)
    url = f'/api/v1/handovers/{handover["id"]}'
    client.post(url + '/submit', json={'expected_revision': 1}, headers=headers())
    item = handover['items'][0]
    item_url = url + f'/items/{item["id"]}'
    assert client.post(item_url + '/receive', json={'status': 'clarifying', 'note': '请补充观察时间'}, headers=headers('other')).status_code == 200
    assert client.post(item_url + '/receive', json={'status': 'received'}, headers=headers('other')).status_code == 409
    assert client.post(item_url + '/clarify', json={'note': '答复'}, headers=headers('other')).status_code == 403
    assert client.post(item_url + '/clarify', json={'note': '实际观察时间为23点'}, headers=headers()).status_code == 200
    response = client.post(item_url + '/receive', json={'status': 'received'}, headers=headers('other'))
    assert response.status_code == 200
    assert len(response.json()['items'][0]['clarifications']) == 2


def test_caregiver_handover_view_filters_shared_elders_and_internal_fields(api, manual_payload):
    client, store, headers = api
    _, _, _, handover = prepare(api, manual_payload)
    first_item = handover['items'][0]
    def seed(data):
        data['elders'].append({'id': 'E2', 'name': '未授权老人', 'status': 'active'})
        data['handover_items'].append({'id': 'HI-E2', 'handover_id': handover['id'], 'kind': 'record',
            'elder_id': 'E2', 'source_id': 'R-E2', 'source_revision': 1,
            'detail': '其他老人的私密记录', 'status': 'pending', 'clarifications': [],
            'submitted_by': 'staff', 'received_by': 'other'})
        data['handovers'][0]['ai_summary'] = {'status': 'pending_review', 'provider': 'mock',
            'created_at': '2026-10-27T00:00:00Z', 'points': [
                {'text': '授权老人事项', 'citations': [{'source_id': first_item['source_id'], 'quote': first_item['detail']}]},
                {'text': '未授权老人事项', 'citations': [{'source_id': 'R-E2', 'quote': '其他老人的私密记录'}]}]}
    store.mutate(seed)
    response = client.get(f'/api/v1/handovers/{handover["id"]}', headers=headers('staff'))
    assert response.status_code == 200
    body = response.json()
    assert all(item['elder_id'] == 'E1' for item in body['items'])
    assert 'clarifications' in body['items'][0]
    assert all('received_by' not in item and 'submitted_by' not in item for item in body['items'])
    assert '未授权老人' not in body['ai_summary']['text']
    manager = client.get(f'/api/v1/handovers/{handover["id"]}', headers=headers('manager')).json()
    assert any(item['elder_id'] == 'E2' for item in manager['items'])


def test_handover_inline_analysis_keeps_existing_task_and_only_suggests_new_task(api, manual_payload):
    client, store, headers = api
    _, _, _, handover = prepare(api, manual_payload)
    existing = {row['id'] for row in store.read()['care_tasks']}
    response = client.post(f'/api/v1/handovers/{handover["id"]}/ai-summary',
        json={'expected_revision': handover['revision'], 'text': '请联系家属反馈情况'}, headers=headers())
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['ai_summary']['status'] == 'pending_review'
    assert result['handover_suggestions'][0]['evidence_text'] == '请联系家属反馈情况'
    assert {row['id'] for row in store.read()['care_tasks']} == existing
    assert {row['source_id'] for row in result['items'] if row['kind'] == 'task'} <= existing
    submitted = client.post(f'/api/v1/handovers/{handover["id"]}/submit',
        json={'expected_revision': result['revision'], 'summary': '人工核对摘要',
              'approve_ai_summary': True, 'accepted_tasks': []}, headers=headers())
    assert submitted.status_code == 200
    assert {row['id'] for row in store.read()['care_tasks']} == existing


def test_shift_conflicts_and_nonmembers_are_rejected(api, manual_payload):
    client, _, headers = api
    source, target = shifts(api)
    overlap = {'name': '重叠班次', 'start_at': '2026-10-19T00:00:00+08:00', 'end_at': '2026-10-19T09:00:00+08:00', 'caregiver_ids': ['staff']}
    assert client.post('/api/v1/shifts', json=overlap, headers=headers('manager')).status_code == 409
    assert client.post('/api/v1/shifts', json=overlap, headers=headers()).status_code == 403
    assert client.post('/api/v1/records/manual', json={**manual_payload, 'shift_id': source['id']}, headers=headers('other')).status_code == 403
    assert client.post('/api/v1/handovers', json={'source_shift_id': source['id'], 'target_shift_id': target['id']}, headers=headers('other')).status_code == 403


def test_utc_suffix_and_offset_timestamps_refer_to_same_shift_window(api):
    client, _, headers = api
    payload = {'name': 'UTC班次', 'start_at': '2026-10-18T12:00:00Z', 'end_at': '2026-10-19T00:00:00Z', 'caregiver_ids': ['staff']}
    assert client.post('/api/v1/shifts', json=payload, headers=headers('manager')).status_code == 201
    overlap = {**payload, 'start_at': '2026-10-18T20:00:00+08:00', 'end_at': '2026-10-19T08:00:00+08:00'}
    assert client.post('/api/v1/shifts', json=overlap, headers=headers('manager')).status_code == 409
