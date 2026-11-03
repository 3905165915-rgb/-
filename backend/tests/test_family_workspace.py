from datetime import datetime, timedelta, timezone

from test_facility import legacy, post
from test_family import binding, instant, get, publish


def selection(api, with_family=True):
    if with_family:
        state, grant = binding(api)
    else:
        state, grant = legacy(api), None
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '已陪同散步，已征询本人的活动意愿。'}, actor='staff')['record']
    body = {'elder_id': 'E1', 'period_start': instant(-1), 'period_end': instant(),
            'selections': [{'record_id': record['id'], 'public_quote': '已陪同散步'}],
            'text': '今天已陪同散步。', 'public_quotes_confirmed': True}
    return state, grant, record, body


def test_select_preview_save_publish_and_withdraw_same_family_text(api):
    _, grant, record, body = selection(api)
    client, store, headers = api
    before = store.path.read_bytes()
    workspace = client.get('/api/v1/family/summaries/workspace', params={'elder_id': 'E1',
        'period_start': body['period_start'], 'period_end': body['period_end']}, headers=headers('manager')).json()
    assert workspace['items'][0]['record_id'] == record['id']
    assert workspace['recipient_count'] == 1 and workspace['can_publish']
    preview = post(api, '/family/summaries/preview-selection', body, expected=200)
    assert preview['family_preview']['text'] == body['text']
    assert set(preview['family_preview']) == {'elder_id', 'period_start', 'period_end', 'text'}
    assert store.path.read_bytes() == before
    request = {**body, 'expected_context_token': preview['context_token']}
    draft = post(api, '/family/summaries/from-selection', request, key='selected-summary')
    assert post(api, '/family/summaries/from-selection', request, key='selected-summary') == draft
    assert len([s for s in store.read()['family_cases'] if s['kind'] == 'summary']) == 1
    assert draft['admission_id'] == workspace['current_admission_id'] and draft['status'] == 'draft'
    published = publish(api, draft)
    endpoint = '/family/me/bindings/' + grant['id'] + '/summaries'
    assert get(api, endpoint)[0]['text'] == preview['family_preview']['text']
    publish(api, published, action='withdraw')
    assert get(api, endpoint) == []


def test_no_recipient_keeps_saved_draft(api):
    _, _, _, body = selection(api, with_family=False)
    preview = post(api, '/family/summaries/preview-selection', body, expected=200)
    assert preview['recipient_count'] == 0 and not preview['can_publish']
    draft = post(api, '/family/summaries/from-selection', {**body, 'expected_context_token': preview['context_token']})
    error = publish(api, draft, expected=409)
    assert error['error_code'] == 'summary_no_authorized_recipients'
    assert next(s for s in api[1].read()['family_cases'] if s['id'] == draft['id'])['status'] == 'draft'


def test_selection_rechecks_source_version_before_creating(api):
    _, _, record, body = selection(api)
    preview = post(api, '/family/summaries/preview-selection', body, expected=200)
    post(api, '/records/' + record['id'] + '/corrections', {'expected_revision': 1,
        'observations': ['已陪同散步，补充登记活动时间。'], 'reason': '补充活动事实'}, expected=200)
    error = post(api, '/family/summaries/from-selection',
                 {**body, 'expected_context_token': preview['context_token']}, expected=409)
    assert error['error_code'] == 'summary_selection_changed'
    assert not [s for s in api[1].read()['family_cases'] if s['kind'] == 'summary']


def test_saved_public_text_must_match_latest_preview(api):
    _, _, _, body = selection(api)
    preview = post(api, '/family/summaries/preview-selection', body, expected=200)
    changed = {**body, 'text': '人工修改后的公开正文，需要重新预览。', 'expected_context_token': preview['context_token']}
    assert post(api, '/family/summaries/from-selection', changed, expected=409)['error_code'] == 'summary_selection_changed'


def test_workspace_period_error_points_to_query_fields(api):
    _, _, _, body = selection(api)
    client, _, headers = api
    response = client.get('/api/v1/family/summaries/workspace', params={
        'elder_id': 'E1', 'period_start': body['period_end'], 'period_end': body['period_start']}, headers=headers('manager'))
    assert response.status_code == 422
    assert response.json()['field_paths'] == ['query.period_start', 'query.period_end']
