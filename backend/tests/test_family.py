"""Family privacy and human publication across revocation and source changes."""
from datetime import datetime, timedelta, timezone
import copy

import pytest

from app.services import family_service
from app.services.workflow import DomainError
from app.schemas.family import FeedbackCreate
from test_facility import ROOT, legacy, post, action, admit


def instant(days=0):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def binding(api, **changes):
    state = legacy(api)
    body = {'elder_id': 'E1', 'admission_id': state['admission']['id'], 'family_id': 'family',
            'relationship': '已核实亲属关系', 'consent_reference': '演示授权凭证A，主管已核验',
            'scopes': ['summary', 'feedback'], 'expires_at': instant(30)}
    body.update(changes)
    return state, post(api, '/family/bindings', body)


def draft(api, state):
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '午餐进食约一半，已协助饮水。'}, actor='staff')['record']
    item = post(api, '/family/summaries', {'elder_id': 'E1', 'admission_id': state['admission']['id'],
        'period_start': instant(-1), 'period_end': instant(), 'text': '今日已协助进餐、饮水，后续继续观察。',
        'evidence': [{'record_id': record['id'], 'revision': 1, 'quote': '午餐进食约一半'}]})
    return record, item


def publish(api, item, action='publish', expected=200):
    return post(api, f'/family/summaries/{item["id"]}/review', {'expected_revision': item['revision'],
        'action': action, 'reason': '主管核对内容、来源和披露范围'}, expected=expected)


def get(api, path, actor='family', expected=200):
    client, _, headers = api
    response = client.get(ROOT + path, headers=headers(actor))
    assert response.status_code == expected, response.text
    return response.json()


def test_only_reviewed_safe_summary_and_private_feedback(api):
    state, grant = binding(api)
    record, summary = draft(api, state)
    path = f'/family/me/bindings/{grant["id"]}'
    assert get(api, path + '/summaries') == []
    published = publish(api, summary)
    visible = get(api, path + '/summaries')
    assert len(visible) == 1 and visible[0]['id'] == published['id']
    assert set(visible[0]) == {'id', 'elder_id', 'text', 'period_start', 'period_end', 'revision', 'reviewed_at'}
    my = get(api, '/family/me/bindings')[0]
    assert 'consent_reference' not in my and 'family_id' not in my
    note = post(api, '/family/me/feedback', {'binding_id': grant['id'], 'text': '希望晚饭前再提醒饮水。'}, actor='family', key='feedback')
    reply = post(api, f'/family/feedback/{note["id"]}/reply', {'expected_revision': 1,
                 'reply': '已转告当班人员，将先询问老人意愿。', 'reason': '内部核对信息'}, expected=200)
    result = get(api, path + '/feedback')[0]
    assert result['reply'] == reply['reply'] and result['status'] == 'closed'
    assert 'internal_reason' not in result and 'replied_by' not in result
    publish(api, published, 'withdraw')
    assert get(api, path + '/summaries') == []


@pytest.mark.parametrize('path', ['/records', '/elders', '/tasks', '/family/cases?kind=binding', '/staff', '/items/E1/timeline', '/incidents', '/reports/metrics?start=2026-10-01&end=2026-10-20'])
def test_family_cannot_read_staff_domains(api, path):
    get(api, path, expected=403)


@pytest.mark.parametrize('change', ['revoke', 'expire', 'account', 'discharge', 'readmit'])
def test_authorization_rechecked_even_cached_feedback(api, change):
    state, grant = binding(api)
    body = {'binding_id': grant['id'], 'text': '想了解今天进餐情况'}
    post(api, '/family/me/feedback', body, actor='family', key='retry')
    client, store, headers = api
    if change == 'revoke':
        post(api, f'/family/bindings/{grant["id"]}/revoke', {'expected_revision': 1, 'reason': '撤销授权'}, expected=200)
    elif change == 'expire':
        store.mutate(lambda data: next(row for row in data['family_cases'] if row['id'] == grant['id']).update(expires_at=instant(-1)))
    elif change == 'account':
        store.mutate(lambda data: next(row for row in data['users'] if row['id'] == 'family').update(active=False))
        with pytest.raises(DomainError):
            family_service.feedback(store, FeedbackCreate(**body), 'family', 'retry')
        return
    else:
        closed = action(api, state, 'discharge')
        if change == 'readmit':
            admit(api, closed['elder'], closed['bed'])
    post(api, '/family/me/feedback', body, actor='family', key='retry', expected=403)
    assert get(api, '/family/me/bindings') == []
    assert len([r for r in store.read()['family_cases'] if r.get('kind') == 'feedback']) == 1


def test_source_correction_hides_published_and_blocks_draft(api):
    state, grant = binding(api)
    record, summary = draft(api, state)
    publish(api, summary)
    post(api, f'/records/{record["id"]}/corrections', {'expected_revision': 1,
         'observations': ['更正：午餐实际吃了四分之三'], 'reason': '核对后更正'}, actor='staff', expected=200)
    assert get(api, f'/family/me/bindings/{grant["id"]}/summaries') == []
    record2, summary2 = draft(api, state)
    post(api, f'/records/{record2["id"]}/corrections', {'expected_revision': 1,
         'observations': ['更正内容'], 'reason': '核对后更正'}, actor='staff', expected=200)
    publish(api, summary2, expected=409)


def test_binding_scopes_ownership_and_idempotency(api):
    state, grant = binding(api, scopes=['summary'])
    post(api, '/family/me/feedback', {'binding_id': grant['id'], 'text': '询问'}, actor='family', expected=403)
    client, store, headers = api
    def seed(data):
        user = copy.deepcopy(next(u for u in data['users'] if u['id'] == 'family'))
        user.update(id='stranger', username='stranger')
        data['users'].append(user)
    store.mutate(seed)
    get(api, f'/family/me/bindings/{grant["id"]}/summaries', 'stranger', 403)
    assert get(api, '/family/me/bindings', 'stranger') == []
    record, summary = draft(api, state)
    publish(api, summary)
    post(api, f'/family/summaries/{summary["id"]}/review', {'expected_revision': 1, 'action': 'publish', 'reason': '重试'}, expected=409)


def test_accounts_no_secrets_and_old_sessions_die(api):
    client, store, headers = api
    password = 'demo-only-long-password'
    body = {'username': 'relative', 'display_name': '虚构家属', 'password': password}
    created = post(api, '/family/accounts', body)
    assert 'password' not in str(created) and 'token_version' not in created
    post(api, '/family/accounts', body, expected=409)
    invalid = client.post(ROOT + '/family/accounts', json={**body, 'role': 'admin'}, headers=headers('manager'))
    assert invalid.status_code == 422 and password not in invalid.text
    login = client.post(ROOT + '/auth/login', json={'username': 'relative', 'password': password}).json()
    old = {'Authorization': 'Bearer ' + login['access_token']}
    assert client.get(ROOT + '/family/me/bindings', headers=old).status_code == 200
    response = client.patch(ROOT + f'/family/accounts/{created["id"]}', json={'expected_revision': 1, 'active': False, 'reason': '暂停账号'}, headers=headers('manager'))
    assert response.status_code == 200
    assert client.get(ROOT + '/family/me/bindings', headers=old).status_code == 401
    assert password not in str(store.read()['audit_logs']) and password not in str(store.read()['idempotency_keys'])


def test_family_transaction_rolls_back_on_audit_failure(api, monkeypatch):
    state, grant = binding(api)
    _, store, _ = api
    before = store.path.read_bytes()
    def fail(*args, **kwargs):
        raise RuntimeError('synthetic failure')
    monkeypatch.setattr(family_service, 'audit', fail)
    with pytest.raises(RuntimeError):
        family_service.feedback(store, FeedbackCreate(binding_id=grant['id'], text='演示'), 'family', 'rollback')
    assert store.path.read_bytes() == before
