import json

from app.storage.json_store import JsonStore
from test_photos import scope, upload


def test_backup_and_offline_restore_preserve_photo_files_and_do_not_revive_scope(api, tmp_path):
    scope(api)
    photo = upload(api)
    store = api[1]
    backup = store.backup()
    copied = backup.with_suffix('.attachments') / (photo['id'] + '.jpg')
    assert copied.is_file()
    original = copied.read_bytes()
    target = JsonStore(tmp_path / 'fresh-server')
    target.ensure()
    target.restore(backup)
    assert (target.data_dir / 'attachments' / copied.name).read_bytes() == original
    assert target.read()['attachments'][0]['sha256'] == photo['sha256']
    assert target.read()['notifications'] == []
    assert all(a['status'] == 'revoked' for a in target.read()['care_assignments'])


def test_missing_photo_backup_fails_before_replacing_business_json(api, tmp_path):
    import pytest
    scope(api)
    photo = upload(api)
    backup = api[1].backup()
    (backup.with_suffix('.attachments') / (photo['id'] + '.jpg')).unlink()
    target = JsonStore(tmp_path / 'target')
    target.ensure()
    before = target.path.read_bytes()
    with pytest.raises(RuntimeError, match='matching attachment'):
        target.restore(backup)
    assert target.path.read_bytes() == before
