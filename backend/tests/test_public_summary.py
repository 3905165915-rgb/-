from test_facility import post
from test_family import binding, instant, get, publish


def test_only_selected_public_quotes_enter_model_draft_is_not_published(api, monkeypatch):
    state, grant = binding(api)
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '已陪同散步。内部家庭沟通内容不公开。'}, actor='staff')['record']
    from app.services import ai_service
    seen = []
    class Provider:
        name = 'test-model'
        def summarize(self, sources):
            seen.extend(sources)
            return {'points': [{'text': '今日已陪同散步。', 'citations': [{'source_id': 'public-1', 'quote': '已陪同散步'}]}]}
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: Provider())
    body = {'elder_id': 'E1', 'admission_id': state['admission']['id'], 'period_start': instant(-1),
            'period_end': instant(), 'evidence': [{'record_id': record['id'], 'revision': 1, 'quote': '已陪同散步'}],
            'public_quotes_confirmed': True}
    item = post(api, '/family/summaries/suggest', body, key='public-summary')
    assert post(api, '/family/summaries/suggest', body, key='public-summary') == item
    assert seen == [{'source_id': 'public-1', 'text': '已陪同散步'}]
    assert item['status'] == 'draft' and item['generation']['provider'] == 'test-model'
    endpoint = '/family/me/bindings/' + grant['id'] + '/summaries'
    assert get(api, endpoint) == []
    client, _, headers = api
    updated = client.patch('/api/v1/family/summaries/' + item['id'],
                           json={'expected_revision': 1, 'text': '今日已陪同短时散步。', 'reason': '人工核对时长措辞'},
                           headers=headers('manager'))
    assert updated.status_code == 200
    publish(api, updated.json())
    assert get(api, endpoint)[0]['text'] == '今日已陪同短时散步。'
    assert 'generation' not in get(api, endpoint)[0]


def test_public_quote_confirmation_is_required(api):
    state, _ = binding(api)
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '已陪同散步'}, actor='staff')['record']
    body = {'elder_id': 'E1', 'admission_id': state['admission']['id'], 'period_start': instant(-1),
            'period_end': instant(), 'evidence': [{'record_id': record['id'], 'revision': 1, 'quote': '已陪同散步'}],
            'public_quotes_confirmed': False}
    post(api, '/family/summaries/suggest', body, expected=422)


def test_invalid_model_citation_returns_manual_fallback_without_saving_summary(api, monkeypatch):
    from app.services import ai_service
    state, _ = binding(api)
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '已陪同散步'}, actor='staff')['record']
    class Provider:
        name = 'test-model'
        def summarize(self, sources):
            return {'points': [{'text': '虚构内容', 'citations': [{'source_id': 'public-1', 'quote': '不存在的依据'}]}]}
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: Provider())
    body = {'elder_id': 'E1', 'admission_id': state['admission']['id'], 'period_start': instant(-1),
            'period_end': instant(), 'evidence': [{'record_id': record['id'], 'revision': 1, 'quote': '已陪同散步'}],
            'public_quotes_confirmed': True}
    post(api, '/family/summaries/suggest', body, expected=503)
    assert not [r for r in api[1].read()['family_cases'] if r['kind'] == 'summary']
