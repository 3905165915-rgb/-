from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import copy
import json

import pytest

from app.schemas.memory import MemoryReviewRequest
from app.services import memory_service
from app.services.workflow import DomainError
from app.storage.json_store import EMPTY_STORE, JsonStore


@pytest.fixture
def memory_payload(api):
    client, _, headers = api
    record = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': 'E1', 'raw_text': '老人本人说喜欢下午洗澡，先解释再开始。',
        'observations': ['老人本人说喜欢下午洗澡', '沟通时先解释再开始'],
    }).json()['record']
    return {
        'elder_id': 'E1', 'content': '喜欢下午洗澡', 'category': 'stable_preference',
        'scenes': ['bathing'], 'attributed_to': 'elder',
        'source_record_id': record['id'], 'source_revision': record['revision'],
        'source_quote': '老人本人说喜欢下午洗澡',
    }


def propose(api, payload, key=None):
    client, _, headers = api
    auth = headers()
    if key:
        auth['Idempotency-Key'] = key
    response = client.post('/api/v1/memories', json=payload, headers=auth)
    assert response.status_code == 201, response.text
    return response.json()


def review(api, item, action='confirm', expected=200, key=None):
    client, _, headers = api
    auth = headers('manager')
    if key:
        auth['Idempotency-Key'] = key
    response = client.post(f'/api/v1/memories/{item["id"]}/review', headers=auth, json={
        'action': action, 'expected_revision': item['revision'], 'reason': '主管核对来源和适用范围',
    })
    assert response.status_code == expected, response.text
    return response.json()


def context(api, elder='E1', scene='bathing'):
    client, _, headers = api
    response = client.get('/api/v1/memories/context', params={'elder_id': elder, 'scene': scene}, headers=headers())
    assert response.status_code == 200, response.text
    return response.json()['memories']


def test_candidate_needs_management_confirmation_before_scene_use(api, memory_payload):
    client, store, headers = api
    item = propose(api, memory_payload)
    assert item['status'] == 'candidate' and not item['effective']
    assert context(api) == []
    for name in ('staff', 'other', 'family'):
        response = client.post(f'/api/v1/memories/{item["id"]}/review', headers=headers(name), json={
            'action': 'confirm', 'expected_revision': 1, 'reason': '核实',
        })
        assert response.status_code == 403
    confirmed = review(api, item)
    assert confirmed['confirmed_by'] == 'manager'
    assert confirmed['status'] == 'confirmed' and confirmed['revision'] == 2
    assert [row['id'] for row in context(api)] == [item['id']]
    assert not context(api, scene='dining')
    assert not store.read()['care_tasks']  # Confirmation does not create a care task.
    assert client.get('/api/v1/memories?elder_id=E1', headers=headers('family')).status_code == 403
    assert client.get(f'/api/v1/memories/{item["id"]}/history', headers=headers('family')).status_code == 403


@pytest.mark.parametrize('change,code', [
    ({'source_quote': '老人从来都不喜欢活动'}, 422),
    ({'source_revision': 2}, 409),
    ({'source_record_id': 'missing'}, 404),
    ({'elder_id': 'E2'}, 422),
    ({'confirmed_by': 'manager', 'status': 'confirmed'}, 422),
    ({'scenes': ['bathing', 'bathing']}, 422),
    ({'category': 'temporary_wish'}, 422),
    ({'valid_from': '2026-10-19T08:00:00'}, 422),
    ({'expires_at': '2026-10-19T08:00:00'}, 422),
])
def test_invalid_evidence_scope_or_client_confirmation_cannot_be_saved(api, memory_payload, change, code):
    client, store, headers = api
    store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '另一位虚构老人', 'status': 'active'}))
    from scope_fixtures import grant
    grant(api, 'E2')  # Still reject evidence from the wrong elder after authorization.
    before = store.path.read_bytes()
    response = client.post('/api/v1/memories', json={**memory_payload, **change}, headers=headers())
    assert response.status_code == code, response.text
    assert store.path.read_bytes() == before


def test_unknown_or_unconfirmed_sources_and_inactive_elder_are_rejected(api, memory_payload):
    client, store, headers = api
    def unconfirm(data):
        data['care_records'][0]['status'] = 'draft'
    store.mutate(unconfirm)
    assert client.post('/api/v1/memories', json=memory_payload, headers=headers()).status_code == 422
    def discharge(data):
        data['care_records'][0]['status'] = 'confirmed'
        data['elders'][0]['status'] = 'discharged'
    store.mutate(discharge)
    assert client.post('/api/v1/memories', json=memory_payload, headers=headers()).status_code == 409
    assert not store.read()['care_memories']


def test_temporary_wish_expires_without_rewriting_stable_preferences(api, memory_payload, monkeypatch):
    base = datetime(2026, 10, 19, 4, tzinfo=timezone.utc)
    monkeypatch.setattr(memory_service, 'now', lambda: base.isoformat())
    stable = review(api, propose(api, memory_payload))
    temporary = review(api, propose(api, {**memory_payload, 'category': 'temporary_wish',
                                        'content': '今天下午再洗澡', 'expires_at': (base + timedelta(hours=2)).isoformat()}))
    assert len(context(api)) == 2
    monkeypatch.setattr(memory_service, 'now', lambda: (base + timedelta(hours=2)).isoformat())
    assert [row['id'] for row in context(api)] == [stable['id']]
    client, store, headers = api
    expired = client.get(f'/api/v1/memories/{temporary["id"]}', headers=headers()).json()
    assert expired['status'] == 'confirmed' and 'expired' in expired['blocked_reasons']
    assert store.read()['care_memories'][0]['category'] == 'stable_preference'


def test_future_start_review_due_and_observation_are_distinct(api, memory_payload, monkeypatch):
    base = datetime(2026, 10, 19, 4, tzinfo=timezone.utc)
    monkeypatch.setattr(memory_service, 'now', lambda: base.isoformat())
    future = review(api, propose(api, {**memory_payload, 'valid_from': (base + timedelta(hours=2)).isoformat()}))
    due = review(api, propose(api, {**memory_payload, 'review_due_at': (base + timedelta(hours=1)).isoformat()}))
    observation = review(api, propose(api, {**memory_payload, 'category': 'observation'}))
    assert [row['id'] for row in context(api)] == [due['id']]
    monkeypatch.setattr(memory_service, 'now', lambda: (base + timedelta(hours=3)).isoformat())
    rows = {row['id']: row for row in context(api)}
    assert set(rows) == {future['id'], due['id']}
    assert rows[due['id']]['review_due'] is True  # A review reminder does not automatically expire a stable preference.
    assert observation['effective'] is False and 'observation_only' in observation['blocked_reasons']


def test_source_correction_marks_memory_for_review_and_keeps_old_evidence(api, memory_payload):
    client, store, headers = api
    confirmed = review(api, propose(api, memory_payload))
    source = copy.deepcopy(confirmed['source'])
    correction = {'observations': ['老人表示目前更喜欢上午洗澡'], 'reason': '本人重新说明，复核原记录', 'expected_revision': 1}
    response = client.post(f'/api/v1/records/{memory_payload["source_record_id"]}/corrections', json=correction, headers=headers())
    assert response.status_code == 200
    assert not context(api)
    changed = client.get(f'/api/v1/memories/{confirmed["id"]}', headers=headers()).json()
    assert changed['status'] == 'review_required' and changed['revision'] == 3
    assert changed['source'] == source and not changed['source_current']
    assert review(api, changed, expected=409)['detail'] == 'memory_source_revision_changed'
    # Even explicit re-approval cannot turn an obsolete immutable raw quote into a current fact.
    invalid = {**memory_payload, 'source_revision': 2, 'source_field': 'raw_text'}
    assert client.post('/api/v1/memories', json=invalid, headers=headers()).status_code == 422
    new_payload = {key: value for key, value in memory_payload.items() if key != 'elder_id'}
    new_payload.update(content='更喜欢上午洗澡', source_revision=2, source_quote='老人表示目前更喜欢上午洗澡',
                       expected_revision=changed['revision'], reason='重新核实本人当前意愿')
    revised = client.post(f'/api/v1/memories/{confirmed["id"]}/revisions', json=new_payload, headers=headers())
    assert revised.status_code == 200, revised.text
    assert revised.json()['status'] == 'candidate' and not context(api)
    accepted = review(api, revised.json())
    assert context(api)[0]['content'] == '更喜欢上午洗澡'
    history = client.get(f'/api/v1/memories/{confirmed["id"]}/history', headers=headers()).json()
    assert [row['action'] for row in history] == ['memory_confirm', 'memory_source_changed', 'revise_memory', 'memory_confirm']
    assert history[1]['before']['source'] == source and history[1]['after']['source'] == source
    assert history[2]['before']['content'] == '喜欢下午洗澡'
    assert history[2]['after']['source']['revision'] == 2
    timeline = client.get(f'/api/v1/items/{accepted["id"]}/timeline', headers=headers()).json()
    assert {'correct_record', 'memory_source_changed', 'revise_memory'} <= {row['action'] for row in timeline}
    assert len(store.read()['care_records']) == 1


def test_source_recheck_excludes_invalidated_data_even_without_status_update(api, memory_payload):
    _, store, _ = api
    item = review(api, propose(api, memory_payload))
    # Simulate an external import/badly edited file bypassing the supported correction route.
    store.mutate(lambda data: data['care_records'][0].update(revision=2))
    assert store.read()['care_memories'][0]['status'] == 'confirmed'
    assert not context(api)
    pending = review(api, item, 'request_review')
    assert review(api, pending, expected=409)['detail'] == 'memory_source_revision_changed'


def test_retries_and_stale_updates_do_not_duplicate_or_overwrite(api, memory_payload):
    client, store, headers = api
    item = propose(api, memory_payload, 'create-one')
    assert propose(api, memory_payload, 'create-one') == item
    changed = client.post('/api/v1/memories', json={**memory_payload, 'content': '不同内容'},
                          headers={**headers(), 'Idempotency-Key': 'create-one'})
    assert changed.status_code == 409
    confirmed = review(api, item, key='confirm-one')
    assert review(api, item, key='confirm-one') == confirmed
    assert review(api, item, expected=409)['detail'] == 'stale_revision'
    payload = {key: value for key, value in memory_payload.items() if key != 'elder_id'}
    payload.update(content='喜欢下午洗澡，沟通时先解释', expected_revision=confirmed['revision'], reason='补充沟通场景')
    assert client.post(f'/api/v1/memories/{item["id"]}/revisions', json=payload, headers=headers('other')).status_code == 403
    auth = {**headers(), 'Idempotency-Key': 'revision-one'}
    first = client.post(f'/api/v1/memories/{item["id"]}/revisions', json=payload, headers=auth)
    second = client.post(f'/api/v1/memories/{item["id"]}/revisions', json=payload, headers=auth)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert not context(api)  # Editing previously confirmed content always requires confirmation again.
    assert client.post(f'/api/v1/memories/{item["id"]}/revisions', json=payload, headers=headers()).status_code == 409
    data = store.read()
    assert len(data['care_memories']) == 1 and len(data['care_memories'][0]['history']) == 2


def test_review_retirement_and_rejection_keep_history_and_do_not_resurrect(api, memory_payload):
    client, _, headers = api
    item = review(api, propose(api, memory_payload))
    pending = review(api, item, 'request_review')
    assert pending['status'] == 'review_required' and not context(api)
    confirmed = review(api, pending)
    retired = review(api, confirmed, 'retire')
    assert retired['status'] == 'retired' and not context(api)
    assert review(api, retired, expected=409)['detail'] == 'invalid_memory_transition'
    rejected = review(api, propose(api, memory_payload), 'reject')
    assert rejected['status'] == 'rejected'
    assert review(api, rejected, expected=409)['detail'] == 'invalid_memory_transition'
    rows = client.get('/api/v1/memories?elder_id=E1&status=retired&scene=bathing', headers=headers()).json()
    assert len(rows) == 1 and rows[0]['id'] == retired['id']


def test_concurrent_confirmation_commits_only_one_revision(api, memory_payload):
    _, store, _ = api
    item = propose(api, memory_payload)
    payload = MemoryReviewRequest(action='confirm', expected_revision=1, reason='并发提交演示')
    def confirm(_):
        try:
            return memory_service.review(store, item['id'], payload, 'manager', 'supervisor')['revision']
        except DomainError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(confirm, range(5)))
    assert results.count(2) == 1 and results.count('stale_revision') == 4
    assert len(store.read()['care_memories'][0]['history']) == 1


def test_version_two_migration_preserves_all_collections_and_backups(tmp_path):
    original = copy.deepcopy(EMPTY_STORE)
    original.pop('care_memories')
    original.pop('change_reviews')
    original.update(schema_version=2, vendor_metadata={'keep': True})
    original['users'] = [{'id': 'U1', 'password_hash': 'test-only-placeholder'}]
    original['care_tasks'] = [{'id': 'T1', 'continuity_key': 'T1'}]
    original['idempotency_keys'] = [{'key': 'keep-retry-response'}]
    store = JsonStore(tmp_path)
    before = json.dumps(original, ensure_ascii=False).encode()
    store.path.write_bytes(before)
    with pytest.raises(RuntimeError):
        store.read()
    backup = store.migrate()
    assert backup.read_bytes() == before
    upgraded = store.read()
    from app.storage.json_store import CURRENT_SCHEMA_VERSION
    assert upgraded['schema_version'] == CURRENT_SCHEMA_VERSION and upgraded['care_memories'] == [] and upgraded['change_reviews'] == []
    for key, value in original.items():
        if key != 'schema_version':
            assert upgraded[key] == value
    assert store.migrate() is None


@pytest.mark.parametrize('version,bad_field', [(2, 'quality_checks'), (2, 'care_memories'), (1, 'idempotency_keys')])
def test_migration_rejects_corrupt_collections_without_overwriting(tmp_path, version, bad_field):
    data = copy.deepcopy(EMPTY_STORE)
    data.update(schema_version=version)
    data[bad_field] = {}
    store = JsonStore(tmp_path)
    before = json.dumps(data).encode()
    store.path.write_bytes(before)
    with pytest.raises(RuntimeError):
        store.migrate()
    assert store.path.read_bytes() == before
