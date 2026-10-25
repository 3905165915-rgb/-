import io
from datetime import datetime, timedelta, timezone

from PIL import Image

from test_facility import post


def scope(api, actor='staff'):
    api[1].mutate(lambda data: data.update(care_assignments=[r for r in data['care_assignments'] if r['caregiver_id'] != actor]))
    instant = datetime.now(timezone.utc)
    return post(api, '/elders/work-assignments', {
        'elder_id': 'E1', 'caregiver_id': actor, 'kind': 'explicit_assignment',
        'start_at': (instant - timedelta(hours=1)).isoformat(),
        'end_at': (instant + timedelta(hours=1)).isoformat(), 'reason': '测试照护分配'})


def png():
    data = io.BytesIO()
    Image.new('RGB', (80, 80), '#d0dfed').save(data, format='PNG')
    return data.getvalue()


def upload(api, actor='staff', content=None, mime='image/png', key=None, expected=201):
    client, _, headers = api
    h = {**headers(actor), 'Content-Type': mime}
    if key:
        h['Idempotency-Key'] = key
    response = client.post('/api/v1/attachments', params={'elder_id': 'E1', 'caption': '日常观察',
                           'occurred_at': '2026-01-01T08:00:00+08:00'},
                           content=png() if content is None else content, headers=h)
    assert response.status_code == expected, response.text
    return response.json()


def test_private_upload_review_scope_and_file_limits(api):
    client, store, headers = api
    scope(api)
    image = upload(api, key='photo')
    assert 'storage_key' not in image and image['mime'] == 'image/jpeg'
    assert upload(api, key='photo') == image
    assert len(list((store.data_dir / 'attachments').glob('*.jpg'))) == 1
    endpoint = '/api/v1/attachments/' + image['id']
    assert client.get(endpoint + '/content', headers=headers('family')).status_code == 403
    assert client.get(endpoint + '/content', headers=headers('other')).status_code == 403
    scope(api, 'other')
    assert client.get(endpoint, headers=headers('other')).status_code == 403
    response = client.get(endpoint + '/content', headers=headers())
    assert response.status_code == 200 and response.headers['content-type'] == 'image/jpeg'
    assert response.headers['cache-control'] == 'no-store'
    reviewed = post(api, '/attachments/' + image['id'] + '/review',
                    {'expected_revision': 1, 'decision': 'approve', 'note': '核对照片适用范围'}, expected=200)
    assert reviewed['status'] == 'approved' and reviewed['reviews'][0]['by'] == 'manager'
    assert client.get(endpoint, headers=headers('other')).status_code == 200
    assignment = next(a for a in store.read()['care_assignments'] if a['caregiver_id'] == 'other')
    post(api, '/elders/work-assignments/' + assignment['id'] + '/revoke',
         {'expected_revision': 1, 'reason': '结束照护'}, expected=200)
    assert client.get(endpoint, headers=headers('other')).status_code == 403
    upload(api, content=b'fake png', expected=422)
    upload(api, mime='image/jpeg', expected=415)
    upload(api, content=b'x' * (4 * 1024 * 1024 + 1), expected=413)
    assert len(store.read()['attachments']) == 1


def test_upload_rollback_and_retry_conflict_do_not_leave_files(api, monkeypatch):
    scope(api)
    image = upload(api, key='same')
    client, store, headers = api
    changed = Image.new('RGB', (20, 20), 'green')
    buf = io.BytesIO()
    changed.save(buf, format='PNG')
    upload(api, content=buf.getvalue(), key='same', expected=409)
    assert len(list((store.data_dir / 'attachments').glob('*.jpg'))) == 1
    original = store._atomic_write
    monkeypatch.setattr(store, '_atomic_write', lambda _: (_ for _ in ()).throw(OSError('disk full')))
    from app.services.attachment_service import upload as service_upload
    import pytest
    with pytest.raises(OSError):
        service_upload(store, 'E1', datetime(2026, 1, 1, tzinfo=timezone.utc), '', png(), 'image/png', 'staff', 'caregiver')
    monkeypatch.setattr(store, '_atomic_write', original)
    assert len(list((store.data_dir / 'attachments').glob('*.jpg'))) == 1
    assert len(store.read()['attachments']) == 1


def test_link_requires_same_elder_and_preserves_provenance(api):
    scope(api)
    photo = upload(api)
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '整理照片，等待核实'}, actor='staff')['record']
    linked = post(api, '/attachments/' + photo['id'] + '/links',
                  {'target_type': 'record', 'target_id': record['id']}, actor='staff', expected=200)
    assert linked['links'][0]['target_id'] == record['id']
    assert linked['links'][0]['by'] == 'staff'
    api[1].mutate(lambda d: d['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'active'}))
    other_record = post(api, '/records/manual', {'elder_id': 'E2', 'raw_text': '另一位老人'}, actor='manager')['record']
    post(api, '/attachments/' + photo['id'] + '/links', {'target_type': 'record', 'target_id': other_record['id']}, expected=422)
