from concurrent.futures import ThreadPoolExecutor
import copy
from datetime import datetime, timedelta, timezone
import json

import pytest

from app.schemas.task_memory import TaskMemoryAdoptRequest
from app.services import assistant_service, memory_service, task_memory_service
from app.services.ai_service import MockAIProvider
from app.services.workflow import DomainError
from test_assistant import create_memory
from test_handovers import shifts


def create_task(api, shift_id=None):
    client, _, headers = api
    response = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': 'E1', 'shift_id': shift_id, 'raw_text': '请在活动前与本人确认安排。',
        'task_candidates': [{'title': '活动前确认本人意愿', 'assigned_to': 'staff'}],
    })
    assert response.status_code == 201, response.text
    return response.json()['tasks'][0]


@pytest.fixture
def linked(api):
    memory, record = create_memory(api)
    return memory, record, create_task(api)


def adopt(api, memory, task, expected=201, key=None, actor='staff', **changes):
    client, _, headers = api
    auth = headers(actor)
    if key:
        auth['Idempotency-Key'] = key
    body = {'expected_task_revision': task['revision'], 'memory_id': memory['id'],
            'expected_memory_revision': memory['revision'], 'scene': 'activity', 'reason': '活动前参考本人已确认习惯', **changes}
    response = client.post(f'/api/v1/tasks/{task["id"]}/memory-references', headers=auth, json=body)
    assert response.status_code == expected, response.text
    return response.json()


def references(api, task_id):
    client, _, headers = api
    response = client.get(f'/api/v1/tasks/{task_id}/memory-references', headers=headers())
    assert response.status_code == 200, response.text
    return response.json()


def withdraw(api, task_id, ref_id, revision, expected=200, key=None, actor='staff'):
    client, _, headers = api
    auth = headers(actor)
    if key:
        auth['Idempotency-Key'] = key
    response = client.post(f'/api/v1/tasks/{task_id}/memory-references/{ref_id}/withdraw', headers=auth,
                           json={'expected_task_revision': revision, 'reason': '重新核对后撤回旧版本采用关系'})
    assert response.status_code == expected, response.text
    return response.json()


def test_explicit_adoption_records_snapshot_actor_and_source_without_executing(api, linked):
    client, store, headers = api
    memory, source, task = linked
    assert task['memory_references'] == []
    result = adopt(api, memory, task)
    assert result['task_revision'] == 2 and not result['needs_review']
    ref = result['references'][0]
    assert ref['memory_revision'] == memory['revision'] and ref['adopted_by'] == 'staff'
    assert ref['snapshot']['content'] == memory['content']
    assert ref['snapshot']['source']['record_id'] == source['id']
    assert ref['snapshot']['source']['quote'] == memory['source']['quote']
    assert ref['status'] == 'active' and ref['current']['effective']
    assert store.read()['care_tasks'][0]['status'] == 'pending'
    detail = client.get(f'/api/v1/tasks/{task["id"]}', headers=headers()).json()
    assert detail['memory_references'][0]['snapshot'] == ref['snapshot']
    listing = client.get('/api/v1/tasks', headers=headers()).json()
    assert listing[0]['memory_references'][0]['id'] == ref['id']
    timeline = client.get(f'/api/v1/items/{task["id"]}/timeline', headers=headers()).json()
    adopted = next(row for row in timeline if row['action'] == 'adopt_task_memory')
    assert adopted['reference']['snapshot'] == ref['snapshot']
    memory_events = client.get(f'/api/v1/items/{memory["id"]}/timeline', headers=headers()).json()
    assert 'adopt_task_memory' in {row['action'] for row in memory_events}


@pytest.mark.parametrize('case,status,code', [
    ('candidate', 409, 'task_memory_not_effective'),
    ('expired', 409, 'task_memory_not_effective'),
    ('source_changed', 409, 'task_memory_not_effective'),
    ('observation', 409, 'task_memory_not_effective'),
    ('future', 409, 'task_memory_not_effective'),
    ('wrong_scene', 422, 'task_memory_scene_mismatch'),
    ('wrong_elder', 422, 'task_memory_elder_mismatch'),
    ('old_memory_revision', 409, 'task_memory_revision_changed'),
    ('old_task_revision', 409, 'stale_revision'),
    ('missing', 404, 'memory_not_found'),
])
def test_invalid_adoption_is_atomic(api, linked, case, status, code):
    _, store, _ = api
    memory, source, task = linked
    changes = {}
    def mutate(data):
        item = data['care_memories'][0]
        if case == 'candidate':
            item['status'] = 'candidate'
        elif case == 'expired':
            item['expires_at'] = '2000-01-01T00:00:00Z'
        elif case == 'source_changed':
            data['care_records'][0]['revision'] += 1
        elif case == 'observation':
            item['category'] = 'observation'
        elif case == 'future':
            item['valid_from'] = '2099-01-01T00:00:00Z'
        elif case == 'wrong_elder':
            item['elder_id'] = 'E2'
            data['elders'].append({'id': 'E2', 'name': '另一位虚构老人', 'status': 'active'})
        elif case == 'old_memory_revision':
            item['revision'] += 1
        elif case == 'old_task_revision':
            data['care_tasks'][0]['revision'] += 1
    store.mutate(mutate)
    if case == 'wrong_scene':
        changes['scene'] = 'dining'
    if case == 'missing':
        changes['memory_id'] = 'missing'
    before = store.path.read_bytes()
    assert adopt(api, memory, task, expected=status, **changes)['detail'] == code
    assert store.path.read_bytes() == before


def test_permissions_and_untrusted_snapshot_are_rejected(api, linked):
    client, store, headers = api
    memory, _, task = linked
    assert adopt(api, memory, task, actor='other', expected=403)['detail'] == 'task_assigned_to_another_caregiver'
    adopt(api, memory, task, actor='family', expected=403)
    adopt(api, memory, task, snapshot={'content': '客户端伪造的依据'}, expected=422)
    assert client.get(f'/api/v1/tasks/{task["id"]}/memory-references', headers=headers('family')).status_code == 403
    assert not store.read()['care_tasks'][0]['memory_references']
    assert adopt(api, memory, task, actor='manager')['references'][0]['adopted_by'] == 'manager'


def test_original_task_creation_cannot_implicitly_adopt_a_memory(api, linked):
    client, store, headers = api
    memory, _, _ = linked
    body = {'elder_id': 'E1', 'raw_text': '活动安排', 'task_candidates': [
        {'title': '活动安排', 'memory_references': [{'memory_id': memory['id']}]}]}
    before = store.path.read_bytes()
    assert client.post('/api/v1/records/manual', headers=headers(), json=body).status_code == 422
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('change', ['revision', 'source', 'expiry', 'missing'])
def test_current_check_preserves_evidence_and_does_not_write_or_change_task_state(api, linked, change):
    client, store, headers = api
    memory, source, task = linked
    adopted = adopt(api, memory, task)
    snapshot = copy.deepcopy(adopted['references'][0]['snapshot'])
    if change == 'source':
        response = client.post(f'/api/v1/records/{source["id"]}/corrections', headers=headers(), json={
            'expected_revision': 1, 'reason': '本人说明原记录不准确', 'observations': ['本人目前更愿意下午活动'],
        })
        assert response.status_code == 200
    else:
        def mutate(data):
            if change == 'revision':
                data['care_memories'][0]['revision'] += 1
            elif change == 'expiry':
                data['care_memories'][0]['expires_at'] = '2000-01-01T00:00:00Z'
            else:
                data['care_memories'].clear()
        store.mutate(mutate)
    before = store.path.read_bytes()
    checked = references(api, task['id'])
    assert checked['needs_review'] and checked['references'][0]['current']['outdated']
    assert checked['references'][0]['snapshot'] == snapshot
    assert checked['task_revision'] == 2 and checked['task_status'] == 'pending'
    assert store.path.read_bytes() == before


def test_natural_expiry_and_review_reminder_have_different_meanings(api, linked, monkeypatch):
    _, store, _ = api
    memory, _, task = linked
    base = datetime.now(timezone.utc) + timedelta(seconds=5)
    clock = {'value': base}
    for module in (task_memory_service, memory_service):
        monkeypatch.setattr(module, 'now', lambda: clock['value'].isoformat())
    store.mutate(lambda data: data['care_memories'][0].update(
        expires_at=(base + timedelta(hours=2)).isoformat(), review_due_at=(base + timedelta(hours=1)).isoformat()))
    adopt(api, memory, task)
    clock['value'] = base + timedelta(hours=1)
    due = references(api, task['id'])
    assert due['references'][0]['current']['review_due'] and not due['needs_review']
    clock['value'] = base + timedelta(hours=2)
    expired = references(api, task['id'])
    assert expired['needs_review'] and 'memory_expired' in expired['references'][0]['current']['reasons']


def test_expiry_is_checked_at_the_recorded_adoption_instant(api, linked, monkeypatch):
    _, store, _ = api
    memory, _, task = linked
    base = datetime.now(timezone.utc) + timedelta(seconds=5)
    store.mutate(lambda data: data['care_memories'][0].update(expires_at=(base + timedelta(seconds=1)).isoformat()))
    # The memory was valid when the selection was shown, but expires by the adoption action.
    monkeypatch.setattr(memory_service, 'now', lambda: base.isoformat())
    monkeypatch.setattr(task_memory_service, 'now', lambda: (base + timedelta(seconds=2)).isoformat())
    assert adopt(api, memory, task, expected=409)['detail'] == 'task_memory_not_effective'
    assert store.read()['care_tasks'][0]['memory_references'] == []


def test_retry_and_duplicate_adoption_are_distinct_and_concurrent_writes_do_not_overwrite(api, linked):
    _, store, _ = api
    memory, _, task = linked
    first = adopt(api, memory, task, key='adoption-one')
    assert adopt(api, memory, task, key='adoption-one') == first
    assert adopt(api, memory, task, key='adoption-one', reason='不同理由', expected=409)['detail'] == 'idempotency_key_payload_mismatch'
    current = {**task, 'revision': first['task_revision']}
    assert adopt(api, memory, current, expected=409)['detail'] == 'task_memory_already_active'
    assert len(store.read()['care_tasks'][0]['memory_references']) == 1
    assert len([row for row in store.read()['audit_logs'] if row['action'] == 'adopt_task_memory']) == 1


def test_concurrent_adoption_commits_one_reference_and_one_audit(api, linked):
    _, store, _ = api
    memory, _, task = linked
    payload = TaskMemoryAdoptRequest(expected_task_revision=1, memory_id=memory['id'],
                                    expected_memory_revision=memory['revision'], scene='activity', reason='活动前核对')
    def run(_):
        try:
            return task_memory_service.adopt(store, task['id'], payload, 'staff', 'caregiver')['task_revision']
        except DomainError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(run, range(5)))
    assert results.count(2) == 1 and results.count('stale_revision') == 4
    assert len(store.read()['care_tasks'][0]['memory_references']) == 1


def test_withdraw_and_readopt_new_version_retains_both_versions(api, linked):
    client, store, headers = api
    memory, _, task = linked
    first = adopt(api, memory, task)
    ref = first['references'][0]
    for action, revision in [('request_review', 2), ('confirm', 3)]:
        response = client.post(f'/api/v1/memories/{memory["id"]}/review', headers=headers('manager'), json={
            'action': action, 'expected_revision': revision, 'reason': '再次核实本人意愿',
        })
        assert response.status_code == 200
    current_memory = response.json()
    assert references(api, task['id'])['needs_review']
    assert adopt(api, current_memory, {**task, 'revision': 2}, expected=409)['detail'] == 'task_memory_already_active'
    removed = withdraw(api, task['id'], ref['id'], 2, key='withdraw-one')
    assert withdraw(api, task['id'], ref['id'], 2, key='withdraw-one') == removed
    assert removed['references'][0]['status'] == 'withdrawn' and not removed['needs_review']
    assert removed['references'][0]['snapshot'] == ref['snapshot']
    assert withdraw(api, task['id'], ref['id'], 3, expected=409)['detail'] == 'task_memory_reference_already_withdrawn'
    adopted = adopt(api, current_memory, {**task, 'revision': 3})
    assert adopted['task_revision'] == 4 and len(adopted['references']) == 2
    assert [row['memory_revision'] for row in adopted['references']] == [2, 4]
    assert adopted['references'][0]['snapshot'] == ref['snapshot']
    assert not adopted['needs_review']
    assert len([row for row in store.read()['audit_logs'] if row['action'] == 'withdraw_task_memory']) == 1


@pytest.mark.parametrize('terminal', ['completed', 'cancelled'])
def test_terminal_tasks_keep_historical_evidence_without_reopening(api, linked, terminal):
    client, store, headers = api
    memory, _, task = linked
    first = adopt(api, memory, task)
    if terminal == 'completed':
        response = client.post(f'/api/v1/tasks/{task["id"]}/complete', headers=headers(), json={'result': '已与本人确认活动安排'})
    else:
        response = client.post(f'/api/v1/tasks/{task["id"]}/transition', headers=headers('manager'), json={
            'action': 'cancel', 'expected_revision': 2, 'note': '本次活动取消',
        })
    assert response.status_code == 200
    store.mutate(lambda data: data['care_memories'][0].update(status='retired'))
    checked = references(api, task['id'])
    assert checked['historical_only'] and not checked['needs_review']
    assert checked['references'][0]['current']['outdated']
    assert checked['references'][0]['snapshot'] == first['references'][0]['snapshot']
    assert withdraw(api, task['id'], first['references'][0]['id'], checked['task_revision'], expected=409)['detail'] == 'task_is_terminal'
    assert adopt(api, memory, {**task, 'revision': checked['task_revision']}, expected=409)['detail'] == 'task_is_terminal'
    assert store.read()['care_tasks'][0]['status'] == terminal


def test_handover_snapshots_and_cross_shift_transfer_keep_the_reference(api):
    client, store, headers = api
    source, target = shifts(api)
    memory, _ = create_memory(api)
    task = create_task(api, source['id'])
    handover = client.post('/api/v1/handovers', headers=headers(), json={
        'source_shift_id': source['id'], 'target_shift_id': target['id'],
    }).json()
    adopted = adopt(api, memory, task)
    url = f'/api/v1/handovers/{handover["id"]}'
    assert client.post(url + '/submit', headers=headers(), json={'expected_revision': 1}).status_code == 409
    refreshed = client.post(url + '/refresh', headers=headers()).json()
    task_item = next(row for row in refreshed['items'] if row['kind'] == 'task')
    assert task_item['memory_references'][0]['snapshot'] == adopted['references'][0]['snapshot']
    assert client.post(url + '/submit', headers=headers(), json={'expected_revision': refreshed['revision']}).status_code == 200
    assert withdraw(api, task['id'], adopted['references'][0]['id'], 2, expected=409)['detail'] == 'shift_closed'
    for item in refreshed['items']:
        response = client.post(url + f'/items/{item["id"]}/receive', headers=headers('other'), json={'status': 'received'})
        assert response.status_code == 200
    current = client.get(f'/api/v1/tasks/{task["id"]}', headers=headers('other')).json()
    assert current['shift_id'] == target['id'] and current['id'] == task['id']
    assert current['memory_references'][0]['snapshot'] == adopted['references'][0]['snapshot']
    assert withdraw(api, task['id'], adopted['references'][0]['id'], current['revision'], expected=403)['detail'] == 'task_assigned_to_another_caregiver'
    withdrawn = withdraw(api, task['id'], adopted['references'][0]['id'], current['revision'], actor='other')
    assert withdrawn['references'][0]['withdrawn_by'] == 'other'
    # Submitted handover remains a snapshot, even after the next shift changes the task.
    old = client.get(url, headers=headers('other')).json()
    historical = next(row for row in old['items'] if row['kind'] == 'task')['memory_references'][0]
    assert historical['status'] == 'active'


def test_assistant_sees_reference_health_without_reusing_obsolete_content(api, linked, monkeypatch):
    client, store, headers = api
    memory, _, task = linked
    adopt(api, memory, task)
    store.mutate(lambda data: data['care_memories'][0].update(status='retired'))
    monkeypatch.setattr(assistant_service, 'get_ai_provider', lambda: MockAIProvider())
    response = client.post('/api/v1/records/context-extract', headers=headers(), json={
        'elder_id': 'E1', 'scene': 'dining', 'text': '老人表示目前不饿。',
    })
    assert response.status_code == 200, response.text
    sources = response.json()['context_snapshot']['sources']
    assert len(sources) == 1 and sources[0]['kind'] == 'task'
    encoded = json.loads(sources[0]['text'])
    check = encoded['memory_reference_checks'][0]
    assert check['memory_id'] == memory['id'] and check['used_revision'] == 2 and check['needs_review']
    assert memory['content'] not in sources[0]['text']


def test_legacy_task_without_references_is_readable_and_no_fake_links_are_added(api, linked):
    _, store, _ = api
    _, _, task = linked
    store.mutate(lambda data: data['care_tasks'][0].pop('memory_references'))
    before = store.path.read_bytes()
    checked = references(api, task['id'])
    assert checked['references'] == [] and not checked['needs_review']
    assert store.path.read_bytes() == before
