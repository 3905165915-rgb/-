from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app import main
from app.services import family_service
from app.schemas.family import FeedbackCreate
from app.services.workflow import DomainError
from test_family import binding, get
from test_facility import ROOT, post


def test_restore_does_not_resurrect_revoked_family_grant_or_session(api):
    _, grant = binding(api)
    client, store, headers = api
    token = headers('family')
    feedback = {'binding_id': grant['id'], 'text': '备份前反馈'}
    post(api, '/family/me/feedback', feedback, actor='family', key='old-cache')
    old = store.backup()
    post(api, f'/family/bindings/{grant["id"]}/revoke', {'expected_revision': 1, 'reason': '明确撤销'}, expected=200)
    store.restore(old)
    data = store.read()
    assert data['idempotency_keys'] == []
    assert next(r for r in data['family_cases'] if r['id'] == grant['id'])['status'] == 'revoked'
    assert client.get(ROOT + '/family/me/bindings', headers=token).status_code == 401
    with pytest.raises(DomainError):
        family_service.feedback(store, FeedbackCreate(**feedback), 'family', 'old-cache')
    # Passwords remain current; a fresh login is possible but old authorization isn't.
    result = client.post(ROOT + '/auth/login', json={'username': 'family', 'password': 'test-password'})
    assert result.status_code == 200
    fresh = {'Authorization': 'Bearer ' + result.json()['access_token']}
    assert client.get(ROOT + '/family/me/bindings', headers=fresh).json() == []


@pytest.mark.parametrize('changes,error', [
    ({'app_env': 'production', 'secret_key': 'short'}, 'SECRET_KEY'),
    ({'app_env': 'production', 'secret_key': 'x' * 40, 'ai_provider': 'mock'}, 'Mock'),
    ({'app_env': 'production', 'secret_key': 'x' * 40, 'ai_provider': 'deepseek', 'ai_fallback_mock': True}, 'Mock'),
    ({'ai_provider': 'typo-vendor'}, 'AI_PROVIDER'),
])
def test_invalid_production_config_fails_startup(api, monkeypatch, changes, error):
    monkeypatch.setattr(main, 'settings', replace(main.settings, **changes))
    with pytest.raises(RuntimeError, match=error):
        with TestClient(main.app):
            pass


def test_all_sensitive_and_denied_responses_are_not_cacheable(api):
    client, _, headers = api
    for path, auth in [('/health', {}), ('/records', headers()), ('/records', headers('family')), ('/elders', {})]:
        response = client.get(ROOT + path, headers=auth)
        assert response.headers['Cache-Control'] == 'no-store'
        assert response.headers['X-Content-Type-Options'] == 'nosniff'


def test_family_source_must_belong_to_current_admission(api):
    state, _ = binding(api)
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '演示进食情况'}, actor='staff')['record']
    _, store, _ = api
    store.mutate(lambda data: next(r for r in data['care_records'] if r['id'] == record['id']).update(admission_id=None))
    from test_family import instant
    post(api, '/family/summaries', {'elder_id': 'E1', 'admission_id': state['admission']['id'],
         'period_start': instant(-1), 'period_end': instant(), 'text': '未明确归属旧数据不能披露',
         'evidence': [{'record_id': record['id'], 'revision': 1, 'quote': '演示进食情况'}]}, expected=422)
