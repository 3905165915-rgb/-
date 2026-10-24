import copy
import json

import pytest

from app.services import impression_service as service
from app.services.ai_service import AIProviderError
from app.storage.json_store import JsonStore, EMPTY_STORE
from scripts.seed_impression_demo import append_demo

PATH = '/api/v1/elders/E1/impressions'


def records(api, count=3):
    client, _, headers = api
    result = []
    for i in range(count):
        res = client.post('/api/v1/records/manual', headers=headers(), json={
            'elder_id': 'E1', 'raw_text': '喜欢午后听吕剧', 'observations': ['喜欢午后听吕剧'],
            'happened_at': f'2026-08-{i % 28 + 1:02}T15:00:00+08:00',
        })
        assert res.status_code == 201, res.text
        result.append(res.json()['record'])
    return result


class Provider:
    name = 'deepseek:test'

    def __init__(self):
        self.calls = []

    def impression(self, sources, candidates=None):
        self.calls.append((copy.deepcopy(sources), candidates))
        return {'points': [{'category': 'preference', 'kind': 'trend', 'expressor': 'elder',
                            'text': '记录显示午后喜欢听吕剧，需询问当次意愿',
                            'citations': [{'source_id': s['source_id'], 'quote': s['text']} for s in sources[:3]]}]}


@pytest.fixture
def provider(monkeypatch):
    instance = Provider()
    monkeypatch.setattr(service, 'get_ai_provider', lambda: instance)
    return instance


def test_full_profile_review_permissions_and_no_automatic_care_changes(api, provider):
    client, store, headers = api
    records(api)
    before = store.read()
    response = client.post(PATH + '/generate', headers=headers())
    assert response.status_code == 200, response.text
    report = response.json()
    point = report['points'][0]
    assert point['status'] == 'candidate' and point['kind'] == 'trend'
    assert point['supporting_days'] == 3
    assert report['coverage']['record_count'] == 3 and report['source_current']
    for collection in ('care_tasks', 'care_memories', 'care_plans', 'care_records'):
        assert store.read()[collection] == before[collection]
    path = PATH + f'/{report["id"]}/points/{point["id"]}/review'
    body = {'expected_revision': 1, 'decision': 'confirmed', 'note': '已与本人核实，仍逐次询问意愿'}
    assert client.post(path, headers=headers(), json=body).status_code == 403
    approved = client.post(path, headers=headers('manager'), json=body)
    assert approved.status_code == 200, approved.text
    assert approved.json()['points'][0]['reviewed_by_name'] == 'manager'
    assert client.post(path, headers=headers('manager'), json=body).json() == approved.json()
    assert client.post(PATH + '/generate', headers=headers()).json()['id'] == report['id']
    assert len(provider.calls) == 1
    assert client.get(PATH, headers=headers('family')).status_code == 403
    assert client.post(PATH + '/generate', headers=headers('family')).status_code == 403


def test_changes_mark_old_profile_and_block_confirmation(api, provider):
    client, store, headers = api
    original = records(api)
    report = client.post(PATH + '/generate', headers=headers()).json()
    store.mutate(lambda d: d['care_records'][0].update(observations=['今天不想听戏'], revision=2, status='corrected'))
    latest = client.get(PATH, headers=headers()).json()['latest']
    assert not latest['source_current'] and latest['needs_review']
    path = PATH + f'/{report["id"]}/points/{report["points"][0]["id"]}/review'
    response = client.post(path, headers=headers('manager'), json={
        'expected_revision': 1, 'decision': 'confirmed', 'note': '确认'})
    assert response.status_code == 409
    updated = client.post(PATH + '/generate', headers=headers()).json()
    assert updated['id'] != report['id']
    assert updated['sources'][0]['text'] == '今天不想听戏'
    assert original[0]['raw_text'] not in updated['sources'][0]['text']
    assert len(client.get(PATH, headers=headers()).json()['history']) == 2


def test_new_records_and_old_history_are_visible(api, provider):
    client, _, headers = api
    records(api, 1)
    report = client.post(PATH + '/generate', headers=headers()).json()
    assert report['points'][0]['kind'] == 'observation'
    records(api, 1)
    old = client.get(PATH + '/' + report['id'], headers=headers()).json()
    assert not old['source_current'] and old['new_record_count'] == 1


@pytest.mark.parametrize('bad', ['quote', 'source', 'shape'])
def test_unverifiable_or_malformed_model_output_never_saved(api, provider, monkeypatch, bad):
    client, store, headers = api
    rows = records(api, 1)
    value = {'points': [{'category': 'preference', 'kind': 'trend', 'expressor': 'elder', 'text': '不可靠总结',
                        'citations': [{'source_id': rows[0]['id'], 'quote': '喜欢午后听吕剧'}]}]}
    if bad == 'quote': value['points'][0]['citations'][0]['quote'] = '原文没有这句话'
    if bad == 'source': value['points'][0]['citations'][0]['source_id'] = 'other-elder-record'
    if bad == 'shape': value['points'][0]['confirmed'] = True
    monkeypatch.setattr(provider, 'impression', lambda *a, **k: value)
    assert client.post(PATH + '/generate', headers=headers()).status_code == 503
    assert not store.read()['elder_impressions']


def test_source_change_during_model_call_or_revoked_actor_is_not_saved(api, provider, monkeypatch):
    client, store, headers = api
    records(api, 1)
    original = provider.impression
    def changed(sources, **kwargs):
        store.mutate(lambda d: d['care_records'][0].update(revision=2))
        return original(sources, **kwargs)
    monkeypatch.setattr(provider, 'impression', changed)
    assert client.post(PATH + '/generate', headers=headers()).status_code == 409
    assert not store.read()['elder_impressions']


def test_all_batches_included_and_no_silent_truncation(api, provider, monkeypatch):
    client, store, headers = api
    records(api, 27)
    result = client.post(PATH + '/generate', headers=headers())
    assert result.status_code == 200, result.text
    assert result.json()['coverage']['batch_count'] == 2
    assert sum(len(s) for s, c in provider.calls if c is None) == 27
    assert provider.calls[-1][1] is not None
    monkeypatch.setattr(service, 'MAX_RECORDS', 26)
    records(api, 1)
    assert client.post(PATH + '/generate', headers=headers()).status_code == 422
    assert len(store.read()['elder_impressions']) == 1


def test_failure_empty_sources_and_other_elder_isolation(api, provider, monkeypatch):
    client, store, headers = api
    assert client.post(PATH + '/generate', headers=headers()).status_code == 422
    records(api, 1)
    store.mutate(lambda d: d['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'active'}))
    assert client.post('/api/v1/elders/E2/impressions/generate', headers=headers()).status_code == 422
    def fail(*a, **k): raise AIProviderError('offline')
    monkeypatch.setattr(provider, 'impression', fail)
    assert client.post(PATH + '/generate', headers=headers()).status_code == 503
    assert not store.read()['elder_impressions']


def test_v4_upgrade_preserves_collections_and_backup(tmp_path):
    data = copy.deepcopy(EMPTY_STORE)
    del data['elder_impressions']
    data['schema_version'] = 4
    data['elders'].append({'id': 'E1', 'name': '张阿姨'})
    store = JsonStore(tmp_path)
    store.path.write_text(json.dumps(data), encoding='utf-8')
    backup = store.migrate()
    assert json.loads(backup.read_text()) == data
    upgraded = store.read()
    assert upgraded['elders'] == data['elders'] and upgraded['elder_impressions'] == []
    assert store.migrate() is None


def test_demo_append_is_repeatable_keeps_records_and_real_recording_time(api):
    _, store, _ = api
    records(api, 1)
    before = store.read()
    result = append_demo(store, 'E1', 'staff', 'caregiver')
    assert result['added'] == 84
    assert append_demo(store, 'E1', 'staff', 'caregiver')['added'] == 0
    data = store.read()
    assert data['users'] == before['users'] and data['care_tasks'] == before['care_tasks']
    assert data['care_records'][0] == before['care_records'][0]
    assert all(r['happened_at'] < r['created_at'] and '模拟' in r['raw_text'] for r in data['care_records'][1:])
