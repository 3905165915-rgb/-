import copy

import pytest

from test_handovers import prepare


def preview(api, record_id, body, expected=200):
    client, _, headers = api
    result = client.post(f'/api/v1/records/{record_id}/corrections/preview', json=body, headers=headers('manager'))
    assert result.status_code == expected, result.text
    return result.json()


def test_preview_is_read_only_and_lists_explicit_dependencies(api, manual_payload):
    _, store, _ = api
    _, _, created, handover = prepare(api, manual_payload)
    record = created['record']
    # Synthetic published evidence for dependency inspection; no family authorization is fabricated.
    store.mutate(lambda d: d['family_cases'].append({'id': 'S1', 'kind': 'summary',
        'elder_id': 'E1', 'status': 'published', 'revision': 1,
        'evidence': [{'record_id': record['id'], 'revision': 1, 'quote': '午餐进食约一半'}]}))
    before = store.path.read_bytes()
    result = preview(api, record['id'], {'observations': ['午餐实际进食六成'], 'reason': '人工复核', 'expected_revision': 1})
    refs = result['explicit_references']
    assert {r['kind'] for r in refs} == {'task', 'handover_item', 'family_summary'}
    assert len([r for r in refs if r['kind'] == 'handover_item']) == len(handover['items'])
    assert result['possible_related'] == [] and len(result['fingerprint']) == 64
    assert store.path.read_bytes() == before


def test_preview_keeps_task_reference_when_memory_source_was_corrected(api, manual_payload):
    _, store, _ = api
    _, _, created, _ = prepare(api, manual_payload)
    record = created['record']
    task_id = created['tasks'][0]['id']

    def seed_old_snapshot(data):
        task = next(row for row in data['care_tasks'] if row['id'] == task_id)
        task['source_record_id'] = None
        task['source_revision'] = None
        task['memory_references'] = [{
            'memory_id': 'MEM-OLD',
            'snapshot': {'source': {'record_id': record['id'], 'revision': 1, 'quote': '旧依据'}},
        }]
        data['care_memories'].append({
            'id': 'MEM-OLD', 'elder_id': record['elder_id'], 'content': '午后活动',
            'source': {'record_id': 'OTHER-RECORD', 'revision': 1, 'quote': '更正后的依据'},
            'history': [], 'status': 'confirmed', 'revision': 1,
        })

    store.mutate(seed_old_snapshot)
    result = preview(api, record['id'], {
        'observations': ['午餐实际进食六成'], 'reason': '人工复核', 'expected_revision': 1,
    })
    task_refs = [row for row in result['explicit_references'] if row['kind'] == 'task']
    assert [row['id'] for row in task_refs] == [task_id]


@pytest.mark.parametrize('race', ['task_started', 'handover_received', 'new_reference', 'changed_proposal'])
def test_any_changed_dependency_or_proposal_requires_repreview(api, manual_payload, race):
    client, store, headers = api
    _, _, created, handover = prepare(api, manual_payload)
    record = created['record']
    body = {'observations': ['午餐实际进食六成'], 'reason': '人工复核', 'expected_revision': 1}
    if race == 'handover_received':
        assert client.post(f'/api/v1/handovers/{handover["id"]}/submit', headers=headers(),
                           json={'expected_revision': 1}).status_code == 200
    snapshot = preview(api, record['id'], body)
    if race == 'task_started':
        response = client.post(f'/api/v1/tasks/{created["tasks"][0]["id"]}/transition', headers=headers(),
                               json={'action': 'start', 'expected_revision': 1})
        assert response.status_code == 200, response.text
    elif race == 'handover_received':
        response = client.post(f'/api/v1/handovers/{handover["id"]}/items/{handover["items"][0]["id"]}/receive',
                               headers=headers('other'), json={'status': 'received'})
        assert response.status_code == 200, response.text
    elif race == 'new_reference':
        store.mutate(lambda d: d['care_tasks'].append({**copy.deepcopy(d['care_tasks'][0]), 'id': 'NEW-TASK'}))
    else:
        body['observations'] = ['不同的更正内容']
    before = store.path.read_bytes()
    response = client.post(f'/api/v1/records/{record["id"]}/corrections/apply', headers=headers('manager'),
                           json={**body, 'expected_impact_fingerprint': snapshot['fingerprint']})
    assert response.status_code == 409 and response.json()['detail'] == 'record_impact_changed_refresh'
    assert store.path.read_bytes() == before


def test_apply_is_atomic_idempotent_and_keeps_downstream_history(api, manual_payload):
    client, store, headers = api
    _, _, created, _ = prepare(api, manual_payload)
    record = created['record']
    body = {'observations': ['午餐实际进食六成'], 'reason': '人工复核', 'expected_revision': 1}
    snapshot = preview(api, record['id'], body)
    before = store.read()
    auth = {**headers('manager'), 'Idempotency-Key': 'verified-correction'}
    payload = {**body, 'expected_impact_fingerprint': snapshot['fingerprint']}
    url = f'/api/v1/records/{record["id"]}/corrections/apply'
    result = client.post(url, headers=auth, json=payload)
    assert result.status_code == 200, result.text
    assert client.post(url, headers=auth, json=payload).json() == result.json()
    current = result.json()
    assert current['revision'] == 2 and current['raw_text'] == record['raw_text']
    assert len(current['corrections']) == 1
    after = store.read()
    assert after['care_records'][0]['corrections'][0]['impact_review']['preview_checked']
    assert 'impact_review' not in current['corrections'][0]
    for collection in ('care_tasks', 'handovers', 'handover_items', 'family_cases'):
        assert before[collection] == after[collection]
    checks = client.get(f'/api/v1/records/{record["id"]}/impact-reviews', headers=headers('manager')).json()
    assert len(checks) == 1 and checks[0]['status'] == 'pending'


def test_checklist_review_is_idempotent_and_reopens_when_task_changes(api, manual_payload):
    client, store, headers = api
    _, _, created, _ = prepare(api, manual_payload)
    record = created['record']
    body = {'observations': ['午餐实际进食六成'], 'reason': '人工复核', 'expected_revision': 1}
    snapshot = preview(api, record['id'], body)
    response = client.post(f'/api/v1/records/{record["id"]}/corrections/apply', headers=headers('manager'),
                           json={**body, 'expected_impact_fingerprint': snapshot['fingerprint']})
    correction = response.json()['corrections'][0]
    list_url = f'/api/v1/records/{record["id"]}/impact-reviews'
    checklist = client.get(list_url, headers=headers('manager')).json()[0]
    review_url = f'/api/v1/records/{record["id"]}/corrections/{correction["id"]}/review'
    payload = {'expected_fingerprint': checklist['fingerprint'], 'decision': 'verified', 'note': '逐项核对，保留原任务待人工跟进'}
    auth = {**headers('manager'), 'Idempotency-Key': 'review-once'}
    result = client.post(review_url, headers=auth, json=payload)
    assert result.status_code == 200 and result.json()['status'] == 'verified'
    assert client.post(review_url, headers=auth, json=payload).json() == result.json()
    assert len([r for r in store.read()['audit_logs'] if r['action'] == 'review_record_impact']) == 1
    changed = client.post(f'/api/v1/tasks/{created["tasks"][0]["id"]}/transition', headers=headers(),
                          json={'action': 'start', 'expected_revision': 1})
    assert changed.status_code == 200, changed.text
    assert client.get(list_url, headers=headers('manager')).json()[0]['status'] == 'pending'
    assert client.post(review_url, headers=headers('manager'), json=payload).status_code == 409


@pytest.mark.parametrize('actor', ['staff', 'other', 'family'])
def test_only_management_can_view_or_apply_full_impact(api, manual_payload, actor):
    client, store, headers = api
    _, _, created, _ = prepare(api, manual_payload)
    record = created['record']
    body = {'observations': ['修正'], 'reason': '人工复核', 'expected_revision': 1}
    before = store.path.read_bytes()
    assert client.post(f'/api/v1/records/{record["id"]}/corrections/preview', headers=headers(actor), json=body).status_code == 403
    assert client.get(f'/api/v1/records/{record["id"]}/impact-reviews', headers=headers(actor)).status_code == 403
    assert store.path.read_bytes() == before


def test_caregiver_timeline_hides_management_impact_details(api, manual_payload):
    client, _, headers = api
    _, _, created, _ = prepare(api, manual_payload)
    record = created['record']
    body = {'observations': ['午餐实际进食六成'], 'reason': '人工复核', 'expected_revision': 1}
    snapshot = preview(api, record['id'], body)
    response = client.post(f'/api/v1/records/{record["id"]}/corrections/apply', headers=headers('manager'),
                           json={**body, 'expected_impact_fingerprint': snapshot['fingerprint']})
    assert response.status_code == 200, response.text
    caregiver = client.get(f'/api/v1/items/{record["id"]}/timeline', headers=headers('staff'))
    manager = client.get(f'/api/v1/items/{record["id"]}/timeline', headers=headers('manager'))
    assert caregiver.status_code == manager.status_code == 200
    caregiver_event = next(row for row in caregiver.json() if row['action'] == 'correct_record')
    manager_event = next(row for row in manager.json() if row['action'] == 'correct_record')
    assert 'impact_review' not in caregiver_event['correction']
    assert 'impact_review' in manager_event['correction']
