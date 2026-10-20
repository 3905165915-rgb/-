import json
import pytest
from app.storage.json_store import JsonStore


def test_restore_preserves_current_accounts_and_backs_up_newer_state(tmp_path):
    store = JsonStore(tmp_path)
    store.ensure()
    store.mutate(lambda data: data['users'].append({'id': 'U1', 'password_hash': 'old-test-hash'}))
    store.mutate(lambda data: data['elders'].append({'id': 'E1', 'name': '虚构老人'}))
    snapshot = store.backup()
    original_bytes = snapshot.read_bytes()
    def change(data):
        data['users'][0]['password_hash'] = 'new-test-hash'
        data['elders'].clear()
    store.mutate(change)
    before_restore = store.path.read_bytes()
    backup = store.restore(snapshot)
    assert backup.read_bytes() == before_restore
    assert snapshot.read_bytes() == original_bytes
    assert store.read()['users'][0]['password_hash'] == 'new-test-hash'
    assert store.read()['elders'][0]['id'] == 'E1'


def test_invalid_restore_does_not_modify_live_file(tmp_path):
    store = JsonStore(tmp_path / 'data')
    store.ensure()
    before = store.path.read_bytes()
    bad = tmp_path / 'bad.json'
    bad.write_text(json.dumps({'schema_version': 999}), encoding='utf-8')
    with pytest.raises(RuntimeError):
        store.restore(bad)
    assert store.path.read_bytes() == before
