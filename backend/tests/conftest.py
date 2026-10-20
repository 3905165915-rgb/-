from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.core import config, security
from app import main
from app.services import store_service
from app.services.passwords import hash_password
from app.storage.json_store import JsonStore


@pytest.fixture
def api(tmp_path, monkeypatch):
    settings = replace(config.settings, data_dir=tmp_path / 'data', ai_provider='mock', ai_fallback_mock=False)
    for module in (config, security, main, store_service):
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
