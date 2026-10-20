from concurrent.futures import ThreadPoolExecutor
import json

import pytest

from app.services import record_service, store_service
from app.services.ai_service import AIProviderError
from app.storage.json_store import JsonStore, EMPTY_STORE


def test_manual_retry_and_key_conflict_are_atomic(api, manual_payload):
    client, store, headers = api
    auth = {**headers(), 'Idempotency-Key': 'manual-one'}
    first = client.post('/api/v1/records/manual', json=manual_payload, headers=auth)
    assert first.status_code == 201
    again = client.post('/api/v1/records/manual', json=manual_payload, headers=auth)
    assert first.json() == again.json()
    changed = client.post('/api/v1/records/manual', json={**manual_payload, 'raw_text': '不同内容'}, headers=auth)
    assert changed.status_code == 409
    assert len(store.read()['care_records']) == len(store.read()['care_tasks']) == 1


def test_correction_preserves_original_and_prevents_lost_update(api, manual_payload):
    client, store, headers = api
    record = client.post('/api/v1/records/manual', json=manual_payload, headers=headers()).json()['record']
    request = {'observations': ['午餐进食约六成'], 'reason': '复核后修正', 'expected_revision': 1}
    response = client.post(f'/api/v1/records/{record["id"]}/corrections', json=request, headers=headers())
    assert response.status_code == 200
    assert response.json()['raw_text'] == manual_payload['raw_text']
    assert response.json()['revision'] == 2
    history = client.get(f'/api/v1/records/{record["id"]}/history', headers=headers()).json()
    assert history[0]['previous_observations'] == ['午餐进食约一半']
    stale = client.post(f'/api/v1/records/{record["id"]}/corrections', json=request, headers=headers())
    assert stale.status_code == 409
    assert len(store.read()['care_records'][0]['corrections']) == 1
    # Corrections do not silently change a previously confirmed task.
    assert store.read()['care_tasks'][0]['title'] == '联系家属反馈情况'


def test_draft_can_be_recovered_rejected_and_never_confirmed_after_rejection(api):
    client, store, headers = api
    draft = client.post('/api/v1/records/extract', json={'elder_id': 'E1', 'text': '联系家属反馈情况'}, headers=headers()).json()
    assert draft['created_by'] == 'staff'
    recovered = client.get('/api/v1/records/drafts?status=pending_review', headers=headers()).json()
    assert recovered[0]['id'] == draft['id']
    assert client.get(f'/api/v1/records/drafts/{draft["id"]}', headers=headers('other')).status_code == 403
    assert client.get(f'/api/v1/items/{draft["id"]}/timeline', headers=headers('other')).status_code == 403
    response = client.post(f'/api/v1/records/drafts/{draft["id"]}/reject', json={'reason': '原文录错'}, headers=headers())
    assert response.status_code == 200
    assert response.json()['raw_text'] == '联系家属反馈情况'
    assert client.post(f'/api/v1/records/{draft["id"]}/confirm', json={}, headers=headers()).status_code == 409
    assert not store.read()['care_records'] and not store.read()['care_tasks']


def test_family_and_other_authors_cannot_modify_records_and_disabled_token_stops_working(api, manual_payload):
    client, store, headers = api
    record = client.post('/api/v1/records/manual', json=manual_payload, headers=headers()).json()['record']
    payload = {'observations': ['修正内容'], 'reason': '复核', 'expected_revision': 1}
    assert client.get('/api/v1/records', headers=headers('family')).status_code == 403
    assert client.post(f'/api/v1/records/{record["id"]}/corrections', json=payload, headers=headers('other')).status_code == 403
    assert client.post(f'/api/v1/records/{record["id"]}/corrections', json=payload, headers=headers('manager')).status_code == 200
    auth = headers()
    store.mutate(lambda data: data['users'][0].update(active=False))
    assert client.get('/api/v1/records', headers=auth).status_code == 401


def test_failed_ai_still_allows_manual_entry(api, manual_payload, monkeypatch):
    client, store, headers = api
    class BrokenProvider:
        def extract(self, *args):
            raise AIProviderError('unavailable')
    monkeypatch.setattr(store_service, 'get_ai_provider', lambda: BrokenProvider())
    failed = client.post('/api/v1/records/extract', json={'elder_id': 'E1', 'text': '观察'}, headers=headers())
    assert failed.status_code == 503
    assert not store.read()['ai_drafts']
    assert client.post('/api/v1/records/manual', json=manual_payload, headers=headers()).status_code == 201


@pytest.mark.parametrize('change', [
    {'raw_text': '  '}, {'elder_id': 'missing'},
    {'task_candidates': [{'title': '联系家属', 'assigned_to': 'family'}]},
    {'task_candidates': [{'title': '联系家属', 'due_at': '2026-10-19T08:00:00'}]},
])
def test_invalid_record_inputs_never_leave_partial_records(api, manual_payload, change):
    client, store, headers = api
    response = client.post('/api/v1/records/manual', json={**manual_payload, **change}, headers=headers())
    assert response.status_code in {404, 422}
    assert not store.read()['care_records'] and not store.read()['care_tasks']


def test_concurrent_confirmation_creates_one_record_and_task(api):
    client, store, headers = api
    draft = client.post('/api/v1/records/extract', json={'elder_id': 'E1', 'text': '联系家属反馈情况'}, headers=headers()).json()
    def confirm(_):
        return record_service.confirm(store, draft['id'], 'staff', None, None, 'caregiver')[0].id
    with ThreadPoolExecutor(max_workers=6) as pool:
        ids = list(pool.map(confirm, range(6)))
    assert len(set(ids)) == 1
    assert len(store.read()['care_records']) == len(store.read()['care_tasks']) == 1


def test_version_one_upgrade_preserves_data_and_original_backup(tmp_path):
    data = {key: value for key, value in EMPTY_STORE.items() if key not in {'quality_checks', 'idempotency_keys', 'care_memories', 'change_reviews'}}
    data['schema_version'] = 1
    data['elders'] = [{'id': 'E1', 'name': '虚构老人'}]
    original = json.dumps(data, ensure_ascii=False).encode()
    store = JsonStore(tmp_path)
    store.path.write_bytes(original)
    with pytest.raises(RuntimeError):
        store.read()
    backup = store.migrate()
    assert backup.read_bytes() == original
    assert store.read()['elders'] == data['elders']
    assert store.migrate() is None
