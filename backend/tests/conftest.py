from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.core import config, security
from app import main
from app.services import ai_service, speech_service, store_service
from app.services.passwords import hash_password
from app.storage.json_store import JsonStore


@pytest.fixture
def api(tmp_path, monkeypatch):
    settings = replace(config.settings, data_dir=tmp_path / 'data', ai_provider='mock', ai_fallback_mock=False,
                       deepseek_api_key='', siliconflow_api_key='',
                       vision_api_key='', vision_base_url='', vision_model='')
    for module in (config, security, main, store_service, ai_service, speech_service):
        monkeypatch.setattr(module, 'settings', settings)
    store = JsonStore(settings.data_dir)
    store.ensure()
    def seed(data):
        data['users'] = [
            {'id': name, 'username': name, 'display_name': name, 'role': role,
             'password_hash': hash_password('test-password'), 'active': True}
            for name, role in [('staff', 'caregiver'), ('other', 'caregiver'), ('manager', 'supervisor'), ('family', 'family')]
        ]
        data['elders'] = [{'id': 'E1', 'name': '虚构老人', 'status': 'active'}]
        # General business fixtures explicitly authorize E1. Scope-specific tests
        # clear these grants and exercise isolation/revocation separately.
        data['care_assignments'] = [
            {'id': 'FIXTURE-' + who, 'elder_id': 'E1', 'caregiver_id': who,
             'kind': 'explicit_assignment', 'status': 'active', 'revision': 1,
             'start_at': '2020-01-01T00:00:00+00:00', 'end_at': '2099-01-01T00:00:00+00:00'}
            for who in ('staff', 'other')]
    store.mutate(seed)
    def headers(name='staff'):
        role = next(item['role'] for item in store.read()['users'] if item['id'] == name)
        return {'Authorization': 'Bearer ' + security.create_access_token(name, role)}
    with TestClient(main.app) as client:
        yield client, store, headers


@pytest.fixture
def manual_payload():
    return {'elder_id': 'E1', 'raw_text': '午餐吃了一半，请联系家属反馈情况。',
            'observations': ['午餐进食约一半'], 'task_candidates': [{'title': '联系家属反馈情况'}]}
