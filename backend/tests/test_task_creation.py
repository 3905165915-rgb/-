from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import pytest


@pytest.fixture(autouse=True)
def creation_shift(api):
    _, store, _ = api
    store.mutate(lambda data: data['shifts'].append({
        'id': 'SHIFT-OWN', 'name': '日间照护',
        'start_at': '2099-10-21T08:00:00+08:00', 'end_at': '2099-10-21T20:00:00+08:00',
        'caregiver_ids': ['staff'], 'status': 'open', 'created_by': 'manager',
    }))


def create_payload(**changes):
    payload = {
        'elder_id': 'E1',
        'title': '确认午间活动安排',
        'source_type': 'manual',
        'shift_id': 'SHIFT-OWN', 'assigned_to': 'staff',
        'due_at': '2099-10-21T17:00:00+08:00',
        'completion_criteria': '询问本人后记录是否参加及原因',
    }
    payload.update(changes)
    return payload


def test_caregiver_can_create_scoped_manual_task_and_retry_is_idempotent(api):
    client, store, headers = api
    auth = {**headers(), 'Idempotency-Key': 'task-create-1'}
    first = client.post('/api/v1/tasks', json=create_payload(), headers=auth)
    assert first.status_code == 201
    body = first.json()
    assert body['assigned_to'] == 'staff'
    assert body['source_type'] == 'manual' and body['source_id'] is None
    assert client.post('/api/v1/tasks', json=create_payload(), headers=auth).json() == body
    assert len(store.read()['care_tasks']) == 1
    assert len([row for row in store.read()['audit_logs'] if row['action'] == 'create_task']) == 1


def test_caregiver_cannot_assign_other_or_create_for_another_shift(api):
    client, store, headers = api
    assert client.post('/api/v1/tasks', json=create_payload(assigned_to='other'), headers=headers()).status_code == 403
    store.mutate(lambda data: data['shifts'].append({
        'id': 'SHIFT-OTHER', 'name': '其他护理员班次',
        'start_at': '2026-10-21T08:00:00+00:00', 'end_at': '2026-10-21T20:00:00+00:00',
        'caregiver_ids': ['other'], 'status': 'open', 'created_by': 'manager', 'created_at': '2026-10-20T00:00:00+00:00',
    }))
    denied = client.post('/api/v1/tasks', json=create_payload(shift_id='SHIFT-OTHER'), headers=headers())
    assert denied.status_code == 403 and denied.json()['detail'] == 'not_a_shift_member'


def test_manager_can_create_from_current_record_but_stale_source_is_rejected(api):
    client, _, headers = api
    record = client.post('/api/v1/records/manual', json={
        'elder_id': 'E1', 'raw_text': '老人今日愿意参加活动', 'observations': ['老人今日愿意参加活动'],
    }, headers=headers()).json()['record']
    payload = create_payload(source_type='record', source_id=record['id'], source_revision=record['revision'])
    created = client.post('/api/v1/tasks', json=payload, headers=headers('manager'))
    assert created.status_code == 201
    assert created.json()['source_record_id'] == record['id']
    stale = client.post('/api/v1/tasks', json={**payload, 'source_revision': 2}, headers=headers('manager'))
    assert stale.status_code == 409 and stale.json()['detail'] == 'task_source_revision_changed'


def test_task_deadline_must_be_future_and_non_manual_source_is_explicit(api):
    client, _, headers = api
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert client.post('/api/v1/tasks', json=create_payload(due_at=past), headers=headers()).status_code == 422
    missing_source = create_payload(source_type='record')
    assert client.post('/api/v1/tasks', json=missing_source, headers=headers()).status_code == 422


@pytest.mark.parametrize('field', ['shift_id', 'assigned_to', 'due_at', 'completion_criteria'])
def test_missing_formal_fields_are_rejected_atomically(api, field):
    client, store, headers = api
    body = create_payload()
    body.pop(field)
    before = store.path.read_bytes()
    assert client.post('/api/v1/tasks', json=body, headers=headers()).status_code == 422
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('mutation,code', [
    ({'assigned_to': 'family'}, 422), ({'assigned_to': 'missing'}, 404),
    ({'due_at': '2099-01-01T00:00:00'}, 422),
    ({'source_type': 'care_plan', 'source_id': 'P1', 'source_revision': 1}, 422),
    ({'source_type': 'handover', 'source_id': 'HI1', 'source_revision': 1}, 422),
    ({'source_id': 'fake'}, 422), ({'memory_references': []}, 422),
])
def test_invalid_formal_requests_do_not_write(api, mutation, code):
    client, store, headers = api
    before = store.path.read_bytes()
    response = client.post('/api/v1/tasks', json=create_payload(**mutation), headers=headers('manager'))
    assert response.status_code == code, response.text
    assert store.path.read_bytes() == before


def test_management_assignment_and_closed_shift(api):
    client, store, headers = api
    store.mutate(lambda d: d['shifts'][0]['caregiver_ids'].append('other'))
    response = client.post('/api/v1/tasks', json=create_payload(assigned_to='other'), headers=headers('manager'))
    assert response.status_code == 201 and response.json()['assigned_to'] == 'other'
    store.mutate(lambda d: d['shifts'][0].update(status='closed'))
    before = store.path.read_bytes()
    assert client.post('/api/v1/tasks', json=create_payload(), headers=headers()).status_code == 409
    assert store.path.read_bytes() == before
    assert client.post('/api/v1/tasks', json=create_payload(), headers=headers('family')).status_code == 403


def test_new_task_idempotency_conflict_and_concurrent_creation(api):
    client, store, headers = api
    auth = {**headers(), 'Idempotency-Key': 'concurrent-create'}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post('/api/v1/tasks', json=create_payload(), headers=auth), range(2)))
    assert all(r.status_code == 201 for r in responses)
    assert responses[0].json() == responses[1].json()
    assert len(store.read()['care_tasks']) == 1
    assert client.post('/api/v1/tasks', json=create_payload(title='更改内容'), headers=auth).status_code == 409


def test_cross_elder_source_and_old_admission_are_rejected(api):
    client, store, headers = api
    record = client.post('/api/v1/records/manual', json={'elder_id': 'E1', 'raw_text': '本人希望听戏'}, headers=headers()).json()['record']
    store.mutate(lambda d: d['elders'].append({'id': 'E2', 'name': '同名老人', 'status': 'active'}))
    body = create_payload(source_type='record', source_id=record['id'], source_revision=1)
    assert client.post('/api/v1/tasks', json={**body, 'elder_id': 'E2'}, headers=headers('manager')).status_code == 422
    store.mutate(lambda d: d['elders'][0].update(current_admission_id='NEW-ADMISSION'))
    assert client.post('/api/v1/tasks', json=body, headers=headers()).status_code == 409


def test_discharge_and_foreign_source_shift_do_not_create_tasks(api):
    client, store, headers = api
    record = client.post('/api/v1/records/manual', json={'elder_id': 'E1', 'raw_text': '虚构来源'}, headers=headers()).json()['record']
    def change(data):
        data['shifts'].append({**data['shifts'][0], 'id': 'SHIFT-OTHER', 'caregiver_ids': ['other']})
        data['care_records'][0]['shift_id'] = 'SHIFT-OTHER'
    store.mutate(change)
    response = client.post('/api/v1/tasks', json=create_payload(source_type='record', source_id=record['id'], source_revision=1), headers=headers())
    assert response.status_code == 403
    store.mutate(lambda d: d['elders'][0].update(status='discharged'))
    assert client.post('/api/v1/tasks', json=create_payload(), headers=headers()).status_code == 409
