"""Family life feed: no internal facts, publication and access checked on every read."""
import copy
import pytest

from app.services import ai_service
from test_family import binding, draft, get, publish
from test_facility import ROOT, action, post
from test_photos import upload


def journey(api, shared=True):
    state, grant = binding(api)
    record, summary = draft(api, state)
    photo = upload(api)
    photo = post(api, f'/attachments/{photo["id"]}/links', {
        'target_type': 'record', 'target_id': record['id']}, actor='staff', expected=200)
    post(api, f'/attachments/{photo["id"]}/review', {
        'expected_revision': photo['revision'], 'decision': 'approve',
        'note': '核对图像与家属分享范围', 'share_with_family': shared}, expected=200)
    summary = publish(api, summary)
    return state, grant, record, summary, photo


def test_family_feed_and_protected_photo(api):
    _, grant, record, summary, photo = journey(api)
    path = f'/family/me/bindings/{grant["id"]}'
    page = get(api, path + '/timeline')
    assert page['total'] == 1 and page['elder_id'] == 'E1'
    event = page['items'][0]
    assert event['id'] == summary['id'] and event['text'] == summary['text']
    assert event['published_at'] == summary['reviewed_at']
    assert 'evidence' not in event and record['id'] not in str(event)
    assert event['photos'][0]['id'] == photo['id']
    client, _, headers = api
    response = client.get(ROOT + event['photos'][0]['content_path'], headers=headers('family'))
    assert response.status_code == 200 and response.headers['content-type'] == 'image/jpeg'
    assert response.headers['cache-control'] == 'no-store'
    assert client.get(ROOT + '/attachments/' + photo['id'] + '/content', headers=headers('family')).status_code == 403
    result = post(api, path + '/insights', {}, actor='family', expected=200)
    assert result['model_status'] == 'demo'
    assert result['points'][0]['citations'][0]['source_id'] == summary['id']


def test_sharing_can_be_enabled_and_withdrawn_and_is_versioned(api):
    _, grant, _, _, photo = journey(api, shared=False)
    path = f'/family/me/bindings/{grant["id"]}'
    client, _, headers = api
    endpoint = f'/attachments/{photo["id"]}/family-sharing'
    payload = {'expected_revision': photo['revision'] + 1, 'share_with_family': True, 'note': '核对后展示'}
    assert client.post(ROOT + endpoint, json=payload, headers=headers('staff')).status_code == 403
    shared = post(api, endpoint, payload, key='share-photo', expected=200)
    assert post(api, endpoint, payload, key='share-photo', expected=200) == shared
    assert len(get(api, path + '/timeline')['items'][0]['photos']) == 1
    post(api, endpoint, {**payload, 'expected_revision': 1}, expected=409)
    post(api, endpoint, {'expected_revision': shared['revision'], 'share_with_family': False,
                         'note': '停止展示'}, expected=200)
    assert get(api, path + '/timeline')['items'][0]['photos'] == []
    get(api, path + f'/photos/{photo["id"]}/content', expected=404)


def test_cannot_share_unreviewed_or_unlinked_photo(api):
    photo = upload(api)
    endpoint = f'/attachments/{photo["id"]}'
    post(api, endpoint + '/family-sharing', {'expected_revision': 1, 'share_with_family': True,
                                           'note': '测试'}, expected=422)
    row = post(api, endpoint + '/review', {'expected_revision': 1, 'decision': 'approve', 'note': '核对'}, expected=200)
    post(api, endpoint + '/family-sharing', {'expected_revision': row['revision'], 'share_with_family': True,
                                            'note': '尚未关联'}, expected=422)
    post(api, endpoint + '/family-sharing', {'expected_revision': row['revision'], 'share_with_family': 'true',
                                            'note': '不接受字符串'}, expected=422)


@pytest.mark.parametrize('change', ['withdraw', 'correct', 'revoke', 'expire', 'discharge'])
def test_dynamic_restrictions_hide_photos_and_summary(api, change):
    state, grant, record, summary, photo = journey(api)
    path = f'/family/me/bindings/{grant["id"]}'
    if change == 'withdraw':
        publish(api, summary, 'withdraw')
    elif change == 'correct':
        post(api, f'/records/{record["id"]}/corrections', {'expected_revision': 1,
             'observations': ['已核对更正'], 'reason': '更正来源'}, actor='staff', expected=200)
    elif change == 'revoke':
        post(api, f'/family/bindings/{grant["id"]}/revoke', {'expected_revision': 1, 'reason': '结束分享'}, expected=200)
    elif change == 'expire':
        api[1].mutate(lambda data: next(r for r in data['family_cases'] if r['id'] == grant['id']).update(expires_at='2020-01-01T00:00:00Z'))
    else:
        action(api, state, 'discharge')
    if change in {'withdraw', 'correct'}:
        assert get(api, path + '/timeline')['items'] == []
        get(api, path + f'/photos/{photo["id"]}/content', expected=404)
    else:
        get(api, path + '/timeline', expected=403)
        get(api, path + f'/photos/{photo["id"]}/content', expected=403)
        post(api, path + '/insights', {}, actor='family', expected=403)


def test_approved_does_not_mean_shared_and_other_family_cannot_read(api):
    _, grant, _, _, photo = journey(api, shared=False)
    path = f'/family/me/bindings/{grant["id"]}'
    assert get(api, path + '/timeline')['items'][0]['photos'] == []
    get(api, path + f'/photos/{photo["id"]}/content', expected=404)
    def stranger(data):
        user = copy.deepcopy(next(r for r in data['users'] if r['id'] == 'family'))
        user.update(id='stranger', username='stranger')
        data['users'].append(user)
    api[1].mutate(stranger)
    get(api, path + '/timeline', actor='stranger', expected=403)
    post(api, path + '/insights', {}, actor='stranger', expected=403)


def test_insight_rechecks_sources_and_access_after_model(api, monkeypatch):
    _, grant, record, _, _ = journey(api)
    class ChangingProvider:
        name = 'synthetic-provider'
        def family_insight(self, sources):
            api[1].mutate(lambda data: next(r for r in data['family_cases'] if r['id'] == grant['id']).update(status='revoked'))
            return {'points': [{'text': sources[0]['text'], 'citations': [{'source_id': sources[0]['source_id'], 'quote': sources[0]['text']}]}]}
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: ChangingProvider())
    post(api, f'/family/me/bindings/{grant["id"]}/insights', {}, actor='family', expected=403)


def test_bad_model_quotes_and_outage_do_not_break_feed(api, monkeypatch):
    _, grant, _, _, _ = journey(api)
    class BrokenProvider:
        name = 'synthetic-provider'
        def family_insight(self, sources):
            return {'points': [{'text': '未经支持的文字', 'citations': [{'source_id': sources[0]['source_id'], 'quote': '编造的原文'}]}]}
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: BrokenProvider())
    path = f'/family/me/bindings/{grant["id"]}'
    post(api, path + '/insights', {}, actor='family', expected=503)
    assert get(api, path + '/timeline')['total'] == 1
    class UnavailableProvider:
        name = 'synthetic-provider'
        def family_insight(self, sources):
            raise ai_service.AIProviderError('synthetic-outage')
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: UnavailableProvider())
    post(api, path + '/insights', {}, actor='family', expected=503)
    assert get(api, path + '/timeline')['total'] == 1


def test_publication_changed_during_model_does_not_return_outdated_summary(api, monkeypatch):
    _, grant, _, summary, _ = journey(api)
    class ChangingProvider:
        name = 'synthetic-provider'
        def family_insight(self, sources):
            api[1].mutate(lambda data: next(r for r in data['family_cases'] if r['id'] == summary['id']).update(status='withdrawn'))
            return {'points': [{'text': sources[0]['text'], 'citations': [{'source_id': sources[0]['source_id'], 'quote': sources[0]['text']}]}]}
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: ChangingProvider())
    post(api, f'/family/me/bindings/{grant["id"]}/insights', {}, actor='family', expected=409)


def test_no_published_updates_does_not_call_model(api, monkeypatch):
    _, grant = binding(api)
    def unexpected():
        raise AssertionError('没有已发布动态时不应调用模型')
    monkeypatch.setattr(ai_service, 'get_ai_provider', unexpected)
    result = post(api, f'/family/me/bindings/{grant["id"]}/insights', {}, actor='family', expected=200)
    assert result['model_status'] == 'no_public_updates' and result['points'] == []
