import pytest

from test_impressions import PATH, records, provider  # noqa: F401


def prepared(api):
    client, store, headers = api
    rows = records(api)
    report = client.post(PATH + '/generate', headers=headers()).json()
    point = report['points'][0]
    root = PATH + f'/{report["id"]}/points/{point["id"]}'
    client.post(root + '/review', headers=headers('manager'), json={
        'expected_revision': 1, 'decision': 'confirmed', 'note': '虚构验收：与本人核实午后活动偏好'})
    body = {'expected_revision': 2, 'reason': '虚构验收：已核实目前仍适用，本人当次意愿优先',
        'content': '午后活动前询问是否愿意听吕剧', 'category': 'stable_preference', 'scenes': ['activity'],
        'attributed_to': 'elder', 'source_record_id': rows[0]['id'], 'source_revision': 1,
        'source_field': 'observations', 'source_quote': '喜欢午后听吕剧'}
    return root + '/activate-memory', body, rows, report


def test_human_activation_reaches_scene_context_without_task_creation(api, provider):
    client, store, headers = api
    path, body, _, _ = prepared(api)
    before = store.read()
    for name in ['staff', 'family']:
        assert client.post(path, headers=headers(name), json=body).status_code == 403
    response = client.post(path, headers={**headers('manager'), 'Idempotency-Key': 'activate-one'}, json=body)
    assert response.status_code == 200, response.text
    memory = response.json()
    assert memory['status'] == 'confirmed' and memory['effective']
    assert memory['confirmed_by'] == 'manager'
    scene = client.get('/api/v1/memories/context?elder_id=E1&scene=activity', headers=headers()).json()
    assert [m['id'] for m in scene['memories']] == [memory['id']]
    assert client.get('/api/v1/memories/context?elder_id=E1&scene=dining', headers=headers()).json()['memories'] == []
    assert client.post(path, headers=headers('manager'), json=body).json()['id'] == memory['id']
    assert client.post(path, headers=headers('manager'), json={**body, 'content': '不同内容'}).status_code == 409
    assert len(store.read()['care_memories']) == 1
    assert store.read()['care_tasks'] == before['care_tasks']
    assert len(provider.calls) == 1  # activation and context never call a model


@pytest.mark.parametrize('change,code', [
    ({'expected_revision': 1}, 409), ({'source_quote': '原文没有的句子'}, 422),
    ({'source_revision': 5}, 422), ({'category': 'observation'}, 422),
    ({'source_record_id': 'another'}, 422), ({'source_field': 'raw_text'}, 422),
])
def test_activation_rejects_stale_or_fabricated_evidence(api, provider, change, code):
    client, store, headers = api
    path, body, _, _ = prepared(api)
    response = client.post(path, headers=headers('manager'), json={**body, **change})
    assert response.status_code == code, response.text
    assert store.read()['care_memories'] == []


@pytest.mark.parametrize('kind,category,status', [
    ('temporary', 'preference', 'confirmed'), ('conflict', 'preference', 'confirmed'),
    ('observation', 'habit', 'confirmed'), ('trend', 'attention', 'confirmed'),
    ('trend', 'preference', 'candidate'),
])
def test_unsupported_points_cannot_become_long_term_care(api, provider, kind, category, status):
    client, store, headers = api
    path, body, _, _ = prepared(api)
    store.mutate(lambda d: d['elder_impressions'][0]['points'][0].update(kind=kind, category=category, status=status))
    assert client.post(path, headers=headers('manager'), json=body).status_code == 422
    assert not store.read()['care_memories']


def test_any_cited_record_change_stops_linked_memory_and_ai_context(api, provider):
    client, store, headers = api
    path, body, rows, _ = prepared(api)
    assert client.post(path, headers=headers('manager'), json=body).status_code == 200
    store.mutate(lambda d: next(r for r in d['care_records'] if r['id'] == rows[1]['id']).update(
        observations=['本人表示已经不喜欢听戏'], revision=2, status='corrected'))
    context = client.get('/api/v1/memories/context?elder_id=E1&scene=activity', headers=headers()).json()
    assert context['memories'] == []
    listed = client.get('/api/v1/memories?elder_id=E1', headers=headers()).json()[0]
    assert not listed['source_current'] and listed['review_state'] == 'pending'


def test_changed_sources_or_review_rejection_block_new_activation(api, provider):
    client, store, headers = api
    path, body, _, _ = prepared(api)
    records(api, 1)
    assert client.post(path, headers=headers('manager'), json=body).status_code == 409
    assert not store.read()['care_memories']


def test_human_revision_keeps_point_link_and_prevents_second_activation(api, provider):
    client, store, headers = api
    path, body, _, report = prepared(api)
    memory = client.post(path, headers=headers('manager'), json=body).json()
    revision = {key: value for key, value in body.items() if key != 'expected_revision'}
    revision.update(expected_revision=memory['revision'], content='活动前先询问本人当次意愿', reason='主管修订提示用语')
    response = client.post('/api/v1/memories/' + memory['id'] + '/revisions', headers=headers('manager'), json=revision)
    assert response.status_code == 200, response.text
    refreshed = client.get('/api/v1/elders/E1/impressions/' + report['id'], headers=headers()).json()
    assert refreshed['points'][0]['care_memory']['id'] == memory['id']
    retry = client.post(path, headers=headers('manager'), json=body)
    assert retry.status_code == 200, retry.text
    assert retry.json()['id'] == memory['id']
    assert len(store.read()['care_memories']) == 1
