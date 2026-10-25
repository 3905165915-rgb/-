from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pytest

from app.storage import json_store
from app.storage.json_store import JsonStore


def _append_batch(args):
    directory, prefix = args
    store = JsonStore(Path(directory))
    for index in range(12):
        store.mutate(lambda data: data['elders'].append({'id': f'{prefix}-{index}', 'name': '虚构测试'}))
    return prefix


def test_distinct_processes_never_lose_writes(tmp_path):
    store = JsonStore(tmp_path / 'store')
    store.ensure()
    with ProcessPoolExecutor(max_workers=2) as pool:
        assert set(pool.map(_append_batch, [(str(store.data_dir), 'A'), (str(store.data_dir), 'B')])) == {'A', 'B'}
    assert len(store.read()['elders']) == 24
    assert len({row['id'] for row in store.read()['elders']}) == 24


def test_failed_replace_keeps_original_and_releases_lock(tmp_path, monkeypatch):
    store = JsonStore(tmp_path)
    store.ensure()
    original = store.path.read_bytes()
    with monkeypatch.context() as patch:
        def fail_replace(*_):
            raise OSError('simulated filesystem failure')
        patch.setattr(json_store.os, 'replace', fail_replace)
        with pytest.raises(OSError):
            store.mutate(lambda data: data['elders'].append({'id': 'FAILED'}))
    assert store.path.read_bytes() == original
    assert not list(tmp_path.glob('store.*.tmp'))
    store.mutate(lambda data: data['elders'].append({'id': 'SUCCESS'}))
    assert [r['id'] for r in store.read()['elders']] == ['SUCCESS']


@pytest.mark.parametrize('winerror', [5, 32, 33])
def test_transient_windows_replace_failure_retries_without_partial_write(tmp_path, monkeypatch, winerror):
    store = JsonStore(tmp_path)
    store.ensure()
    original = store.path.read_bytes()
    replace = json_store.os.replace
    attempts = []
    def transient(source, destination):
        attempts.append(1)
        if len(attempts) < 3:
            assert store.path.read_bytes() == original
            error = PermissionError('simulated Windows handle contention')
            error.winerror = winerror
            raise error
        return replace(source, destination)
    monkeypatch.setattr(json_store.os, 'replace', transient)
    monkeypatch.setattr(json_store.time, 'sleep', lambda _: None)
    store.mutate(lambda d: d['elders'].append({'id': 'SUCCESS', 'name': '张阿姨'}))
    assert len(attempts) == 3
    assert store.read()['elders'][0]['id'] == 'SUCCESS'
    assert not list(tmp_path.glob('store.*.tmp'))


def test_persistent_windows_replace_failure_is_bounded_and_preserves_live_file(tmp_path, monkeypatch):
    store = JsonStore(tmp_path)
    store.ensure()
    original = store.path.read_bytes()
    attempts = []
    with monkeypatch.context() as patch:
        def fail(*_):
            attempts.append(1)
            error = PermissionError('persistent Windows denial')
            error.winerror = 5
            raise error
        patch.setattr(json_store.os, 'replace', fail)
        patch.setattr(json_store.time, 'sleep', lambda _: None)
        with pytest.raises(PermissionError):
            store.mutate(lambda d: d['elders'].append({'id': 'FAILED'}))
    assert len(attempts) == 6 and store.path.read_bytes() == original
    assert not list(tmp_path.glob('store.*.tmp'))
    store.mutate(lambda d: d['elders'].append({'id': 'RECOVERED'}))
    assert store.read()['elders'][0]['id'] == 'RECOVERED'


@pytest.mark.parametrize('failure', ['invalid_collection', 'serialization', 'callback'])
def test_invalid_callback_output_cannot_corrupt_store(tmp_path, failure):
    store = JsonStore(tmp_path)
    store.ensure()
    original = store.path.read_bytes()
    def mutate(data):
        if failure == 'invalid_collection':
            data['care_records'] = {}
        elif failure == 'serialization':
            data['elders'].append({'id': object()})
        else:
            data['elders'].append({'id': 'ROLLBACK'})
            raise ValueError('abort operation')
    with pytest.raises((RuntimeError, TypeError, ValueError)):
        store.mutate(mutate)
    assert store.path.read_bytes() == original
    assert not list(tmp_path.glob('store.*.tmp'))
    assert store.read()['elders'] == []


def test_corrupt_live_data_is_never_reset_silently(tmp_path):
    store = JsonStore(tmp_path)
    store.ensure()
    original_backup = store.backup()
    store.path.write_text('{truncated', encoding='utf-8')
    damaged = store.path.read_bytes()
    with pytest.raises(ValueError):
        store.read()
    with pytest.raises(ValueError):
        store.mutate(lambda data: data['elders'].clear())
    assert store.path.read_bytes() == damaged
    assert original_backup.read_text(encoding='utf-8').startswith('{')


def test_explicit_restore_works_when_live_data_is_corrupt(tmp_path):
    store = JsonStore(tmp_path)
    store.ensure()
    store.mutate(lambda data: data['elders'].append({'id': 'BACKUP-ELDER', 'name': '备份测试老人'}))
    source = store.backup()
    store.path.write_text('{truncated', encoding='utf-8')

    pre_restore_backup = store.restore(source)

    restored = store.read()
    assert [row['id'] for row in restored['elders']] == ['BACKUP-ELDER']
    assert restored['users'] == []
    assert pre_restore_backup.exists()
