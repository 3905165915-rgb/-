from datetime import datetime, timedelta, timezone
import json
import pytest

from app.storage.json_store import JsonStore, EMPTY_STORE


@pytest.fixture(autouse=True)
def unassigned_fixture(api):
    api[1].mutate(lambda data: data.update(care_assignments=[]))


def test_caregiver_worklist_uses_current_assignments_and_open_shift_only(api):
    client, store, headers = api

    def seed(data):
        data['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'active'})
        data['shifts'] = [
            {'id': 'S-OPEN', 'name': '白班', 'status': 'open', 'caregiver_ids': ['staff']},
            {'id': 'S-OTHER', 'name': '夜班', 'status': 'open', 'caregiver_ids': ['other']},
            {'id': 'S-CLOSED', 'name': '旧班', 'status': 'closed', 'caregiver_ids': ['staff']},
        ]
        data['care_tasks'] = [
            {'id': 'T1', 'elder_id': 'E1', 'title': '明确分配', 'status': 'pending', 'assigned_to': 'staff'},
            {'id': 'T2', 'elder_id': 'E2', 'title': '本班待办', 'status': 'pending', 'shift_id': 'S-OPEN'},
            {'id': 'T3', 'elder_id': 'E2', 'title': '他人班次', 'status': 'pending', 'shift_id': 'S-OTHER'},
            {'id': 'T4', 'elder_id': 'E2', 'title': '旧班待办', 'status': 'pending', 'shift_id': 'S-CLOSED'},
            {'id': 'T5', 'elder_id': 'E2', 'title': '已完成不进入范围', 'status': 'completed', 'assigned_to': 'staff'},
        ]
        for task in data['care_tasks']:
            task['updated_at'] = '2026-10-25T09:00:00+08:00'
    store.mutate(seed)

    response = client.get('/api/v1/elders/worklist/me', headers=headers('staff'))
    assert response.status_code == 200
    items = {item['elder']['id']: item for item in response.json()['items']}
    assert set(items) == {'E1', 'E2'}
    assert items['E1']['scope_reasons'] == ['explicit_task_assignment']
    assert items['E2']['scope_reasons'] == ['open_shift_membership']
    assert {task['id'] for task in items['E2']['open_tasks']} == {'T2'}

    manager = client.get('/api/v1/elders/worklist/me', headers=headers('manager'))
    assert manager.status_code == 200
    assert {item['elder']['id'] for item in manager.json()['items']} == {'E1', 'E2'}


def test_worklist_never_turns_a_past_record_into_access(api):
    client, store, headers = api
    store.mutate(lambda data: data['care_records'].append({
        'id': 'R-PAST', 'elder_id': 'E1', 'raw_text': '历史记录', 'observations': ['历史记录'],
        'created_by': 'staff', 'status': 'confirmed', 'created_at': '2026-10-01T09:00:00+08:00', 'revision': 1,
    }))
    result = client.get('/api/v1/elders/worklist/me', headers=headers('staff'))
    assert result.status_code == 200
    assert result.json()['items'] == []


def test_elder_timeline_is_filtered_by_current_scope_and_event_type(api):
    client, store, headers = api
    def seed(data):
        data['shifts'] = [{'id': 'S1', 'name': '白班', 'status': 'open', 'caregiver_ids': ['staff']}]
        data['care_tasks'] = [{'id': 'T1', 'elder_id': 'E1', 'title': '当班任务', 'status': 'pending',
                               'shift_id': 'S1', 'updated_at': '2026-10-25T09:00:00+08:00'}]
        data['audit_logs'] = [
            {'id': 'A1', 'action': 'create_manual_record', 'object_id': 'E1', 'user_id': 'staff',
             'elder_id': 'E1', 'detail': '观察记录', 'created_at': '2026-10-25T09:00:00+08:00'},
            {'id': 'A2', 'action': 'create_task', 'object_id': 'T1', 'user_id': 'staff',
             'elder_id': 'E1', 'detail': '任务', 'created_at': '2026-10-25T10:00:00+08:00'},
        ]
    store.mutate(seed)
    result = client.get('/api/v1/elders/E1/timeline?event_type=task&start=2026-10-25T00:00:00%2B08:00&end=2026-10-26T00:00:00%2B08:00', headers=headers('staff'))
    assert result.status_code == 200
    payload = result.json()
    assert [event['id'] for event in payload['events']] == ['A2']
    assert payload['events'][0]['event_type'] == 'task'

    denied = client.get('/api/v1/elders/E1/timeline', headers=headers('other'))
    assert denied.status_code == 403


def test_temporary_support_expires_and_can_be_revoked(api):
    client, store, headers = api
    instant = datetime.now(timezone.utc)
    body = {'elder_id': 'E1', 'caregiver_id': 'staff', 'kind': 'temporary_support',
            'start_at': (instant - timedelta(minutes=1)).isoformat(),
            'end_at': (instant + timedelta(hours=1)).isoformat(), 'reason': '短时支援'}
    endpoint = '/api/v1/elders/work-assignments'
    denied = client.post(endpoint, json=body, headers=headers('staff'))
    assert denied.status_code == 403
    h = {**headers('manager'), 'Idempotency-Key': 'support'}
    created = client.post(endpoint, json=body, headers=h)
    assert created.status_code == 201, created.text
    assert client.post(endpoint, json=body, headers=h).json() == created.json()
    assert len(store.read()['care_assignments']) == 1
    listing = client.get('/api/v1/elders/worklist/me', headers=headers()).json()['items']
    assert len(listing) == 1 and listing[0]['open_tasks'] == []
    assert listing[0]['scope_reasons'] == ['temporary_support']
    assert client.get('/api/v1/elders/E1/timeline', headers=headers()).status_code == 200
    response = client.post(endpoint + '/' + created.json()['id'] + '/revoke',
                           json={'expected_revision': 1, 'reason': '支援结束'}, headers=headers('manager'))
    assert response.status_code == 200
    assert client.get('/api/v1/elders/E1/timeline', headers=headers()).status_code == 403
    assert client.get('/api/v1/elders/worklist/me', headers=headers()).json()['items'] == []


def test_future_shift_does_not_grant_current_scope(api):
    client, store, headers = api
    instant = datetime.now(timezone.utc)
    def seed(data):
        data['shifts'] = [{'id': 'FUTURE', 'status': 'open', 'caregiver_ids': ['staff'],
                          'start_at': (instant + timedelta(days=1)).isoformat(),
                          'end_at': (instant + timedelta(days=1, hours=8)).isoformat()}]
        data['care_tasks'] = [{'id': 'T', 'elder_id': 'E1', 'title': '未来班次', 'status': 'pending',
                               'shift_id': 'FUTURE', 'updated_at': instant.isoformat()}]
    store.mutate(seed)
    assert client.get('/api/v1/elders/worklist/me', headers=headers()).json()['items'] == []


def test_scope_is_enforced_on_old_list_detail_and_record_submission_routes(api):
    client, store, headers = api
    instant = datetime.now(timezone.utc)
    store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'active'}))
    for elder, actor in [('E1', 'staff'), ('E2', 'other')]:
        response = client.post('/api/v1/elders/work-assignments', json={
            'elder_id': elder, 'caregiver_id': actor, 'kind': 'explicit_assignment',
            'start_at': (instant - timedelta(minutes=1)).isoformat(),
            'end_at': (instant + timedelta(hours=1)).isoformat(), 'reason': '各自照护分配'}, headers=headers('manager'))
        assert response.status_code == 201
    response = client.post('/api/v1/records/manual', json={'elder_id': 'E2', 'raw_text': '李爷爷今天已散步'}, headers=headers('other'))
    assert response.status_code == 201
    record_id = response.json()['record']['id']
    assert [r['id'] for r in client.get('/api/v1/elders', headers=headers()).json()] == ['E1']
    assert [r['id'] for r in client.get('/api/v1/elders', headers=headers('other')).json()] == ['E2']
    assert client.get('/api/v1/records', headers=headers()).json() == []
    assert client.get('/api/v1/records/' + record_id, headers=headers()).status_code == 403
    assert client.get('/api/v1/items/E2/timeline', headers=headers()).status_code == 403
    denied = client.post('/api/v1/records/manual', json={'elder_id': 'E2', 'raw_text': '不属于我的老人'}, headers=headers())
    assert denied.status_code == 403


def test_timeline_rejects_naive_dates_and_reports_pagination(api):
    client, store, headers = api
    store.mutate(lambda data: data['audit_logs'].extend([
        {'id': str(i), 'object_id': 'E1', 'user_id': 'manager', 'action': 'create_elder',
         'created_at': f'2026-10-25T0{i}:00:00+08:00'} for i in range(3)]))
    endpoint = '/api/v1/elders/E1/timeline'
    assert client.get(endpoint, params={'start': '2026-10-01T00:00:00'}, headers=headers('manager')).status_code == 422
    result = client.get(endpoint, params={'limit': 1, 'offset': 1}, headers=headers('manager')).json()
    assert result['total'] == 3 and result['has_more'] is True
    assert [event['id'] for event in result['events']] == ['1']


def test_timeline_orders_and_pages_by_server_recorded_at(api):
    client, store, headers = api
    store.mutate(lambda data: data['audit_logs'].extend([
        {'id': 'NEW-REG', 'object_id': 'E1', 'user_id': 'manager', 'action': 'create_elder',
         'created_at': '2099-10-27T09:00:00Z'},
        {'id': 'OLD-REG', 'object_id': 'E1', 'user_id': 'manager', 'action': 'create_elder',
         'created_at': '1999-10-27T09:00:00Z'},
    ]))
    endpoint = '/api/v1/elders/E1/timeline'
    page1 = client.get(endpoint, params={'event_type': 'other', 'limit': 1, 'offset': 0}, headers=headers('manager')).json()
    page2 = client.get(endpoint, params={'event_type': 'other', 'limit': 1, 'offset': 1}, headers=headers('manager')).json()
    assert page1['events'][0]['id'] == 'NEW-REG'
    assert page2['events'][0]['id'] == 'OLD-REG'
    assert page1['events'][0]['recorded_at'] == '2099-10-27T09:00:00Z'
    assert page1['events'][0]['happened_at'] is None


def test_schema_five_migration_is_explicit_backed_up_and_preserves_old_data(tmp_path):
    import copy
    store = JsonStore(tmp_path)
    old = copy.deepcopy(EMPTY_STORE)
    old['schema_version'] = 5
    for name in ('notifications', 'care_assignments', 'attachments', 'image_analyses', 'ai_evaluations'):
        old.pop(name)
    old['elders'] = [{'id': 'E1', 'name': '张阿姨'}]
    store.path.write_text(json.dumps(old), encoding='utf-8')
    with pytest.raises(RuntimeError):
        store.read()
    backup = store.migrate()
    assert json.loads(backup.read_text(encoding='utf-8')) == old
    assert store.read()['elders'] == old['elders']
    assert store.read()['notifications'] == []
    assert store.migrate() is None
    old.pop('elder_impressions')
    store.path.write_text(json.dumps(old), encoding='utf-8')
    with pytest.raises(RuntimeError, match='elder_impressions'):
        store.migrate()


def test_past_task_receipt_does_not_grant_live_memory_or_condition_context(api):
    client, store, headers = api
    from app.models.entities import CareTask
    task = CareTask(id='MY-PAST', elder_id='E1', title='已完成事项', assigned_to='staff', status='completed',
                    created_by='staff', created_at='2026-01-01T00:00:00Z', updated_at='2026-01-01T00:00:00Z')
    store.mutate(lambda data: data['care_tasks'].append(task.model_dump()))
    assert client.get('/api/v1/tasks/MY-PAST', headers=headers()).status_code == 200
    for suffix in ('memory-references', 'condition'):
        assert client.get('/api/v1/tasks/MY-PAST/' + suffix, headers=headers()).status_code == 403
    assert client.get('/api/v1/elders/E1', headers=headers()).status_code == 403


def test_shared_handover_does_not_leak_other_elders_summary_into_elder_timeline(api):
    client, store, headers = api
    def seed(data):
        data['handovers'].append({'id': 'H-SHARED'})
        data['handover_items'].append({'id': 'HI', 'elder_id': 'E1', 'handover_id': 'H-SHARED', 'source_id': 'R'})
        data['audit_logs'].append({'id': 'AUDIT-H', 'action': 'submit_handover', 'object_id': 'H-SHARED',
            'user_id': 'manager', 'created_at': '2026-10-25T00:00:00Z',
            'detail': '另一位老人的私密摘要', 'before': {'summary': '其他老人'}, 'after': {'summary': '其他老人'}})
    store.mutate(seed)
    response = client.get('/api/v1/elders/E1/timeline', headers=headers('manager'))
    assert response.status_code == 200
    event = response.json()['events'][0]
    assert event['source_id'] == 'H-SHARED' and event['event_type'] == 'handover'
    assert '私密' not in event['detail'] and 'before' not in event and 'after' not in event


def test_failed_ai_draft_save_rechecks_revoked_scope_inside_transaction(api):
    from app.services.record_service import save_failed_draft
    from app.services.workflow import DomainError
    with pytest.raises(DomainError, match='elder_not_in_current_work_scope'):
        save_failed_draft(api[1], 'E1', None, '原文', 'staff', 'caregiver')
    assert api[1].read()['ai_drafts'] == []
