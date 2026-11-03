from app.storage.json_store import JsonStore
from scripts.storage_manifest import manifest


def test_offline_manifest_preserves_data_and_covers_audit_and_idempotency(tmp_path):
    store = JsonStore(tmp_path / 'snapshot')
    store.ensure()
    store.mutate(lambda data: data['elders'].append({'id': 'SYNTHETIC-E1', 'name': '虚构验收老人'}))
    before = store.path.read_bytes()
    result = manifest(store.path)
    assert result['collections']['elders']['count'] == 1
    assert {'audit_logs', 'idempotency_keys', 'attachments'} <= result['collections'].keys()
    assert store.path.read_bytes() == before
    assert '虚构验收老人' not in str(result)


def test_manifest_never_initializes_a_missing_store(tmp_path):
    import pytest
    with pytest.raises(FileNotFoundError):
        manifest(tmp_path / 'not-created' / 'store.json')
    assert not (tmp_path / 'not-created').exists()
