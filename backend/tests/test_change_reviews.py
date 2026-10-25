from concurrent.futures import ThreadPoolExecutor
import copy
from datetime import datetime, timedelta, timezone
import json

import pytest

from app.schemas.change_review import ChangeAssignRequest
from app.services import change_review_service as service
from app.services.workflow import DomainError
from app.storage.json_store import EMPTY_STORE, JsonStore
from test_assistant import create_memory
from test_handovers import shifts
from test_task_memories import adopt, create_task, withdraw


ROOT = '/api/v1/change-reviews'
CORRECTION = '本人表示改为下午活动，旧的上午安排不再适用。'


def correct(api, source, text=CORRECTION):
    client, _, headers = api
    result = client.post(f'/api/v1/records/{source["id"]}/corrections', headers=headers(), json={
        'expected_revision': source.get('revision', 1), 'reason': '再次核实本人当前意愿', 'observations': [text],
    })
    assert result.status_code == 200, result.text
    return result.json()


def detail(api, case_id, actor='manager'):
    client, _, headers = api
    result = client.get(ROOT + '/' + case_id, headers=headers(actor))
    assert result.status_code == 200, result.text
    return result.json()


def version(case):
    return {'expected_revision': case['revision'], 'expected_fingerprint': case['fingerprint']}


def action(api, case, suffix, body, actor='manager', expected=200, key=None):
    client, _, headers = api
    auth = headers(actor)
    if key:
        auth['Idempotency-Key'] = key
    result = client.post(ROOT + '/' + case['id'] + '/' + suffix, headers=auth, json={**version(case), **body})
    assert result.status_code == expected, result.text
    return result.json()


def assign(api, case, assigned_to='staff', **kwargs):
    return action(api, case, 'assign', {'assigned_to': assigned_to, 'reason': '请核对本次服务依据'}, **kwargs)


def submit_body(source, disposition='reference_withdrawn'):
    return {'disposition': disposition, 'note': '已核对本人新意愿并撤回旧依据，保留原始记录。',
            'evidence': [{'record_id': source['id'], 'revision': source['revision'],
                          'field': 'observations', 'quote': source['observations'][0]}]}


@pytest.fixture
def affected(api):
    client, store, headers = api
    memory, source = create_memory(api)
    task = create_task(api)
    adopted = adopt(api, memory, task)
    source = correct(api, source)
    cases = client.get(ROOT, headers=headers('manager')).json()
    assert len(cases) == 1
    return {'memory': memory, 'source': source, 'task': task, 'adopted': adopted, 'case': cases[0]}


def ready(api, affected, assignee='staff'):
    case = assign(api, affected['case'], assignee)
    withdraw(api, affected['task']['id'], affected['adopted']['references'][0]['id'], 2)
    return detail(api, case['id'])


def test_source_correction_creates_one_case_atomically_without_mutating_task(api, affected):
    client, store, headers = api
    case = affected['case']
    assert case['status'] == 'pending' and case['revision'] == 1 and case['current']['needs_review']
    ref = affected['adopted']['references'][0]
    assert case['initial_snapshot']['reference']['snapshot'] == ref['snapshot']
    task = store.read()['care_tasks'][0]
    assert task['revision'] == 2 and task['status'] == 'pending'
    assert task['memory_references'][0]['snapshot'] == ref['snapshot']
    assert store.read()['care_memories'][0]['status'] == 'review_required'
    before = store.path.read_bytes()
    assert detail(api, case['id']) == case
    assert client.get(ROOT, headers=headers('manager')).status_code == 200
    assert store.path.read_bytes() == before  # reads do not scan/write


def test_scan_deduplicates_and_source_changes_append_history(api, affected):
    client, store, headers = api
    first = affected['case']
    for _ in range(2):
        result = client.post(ROOT + '/scan', headers=headers('manager'), json={})
        assert result.status_code == 200 and result.json()['created_ids'] == result.json()['updated_ids'] == []
    original = copy.deepcopy(first['initial_snapshot'])
    correct(api, affected['source'], '再次核实：下午活动前还要询问本人。')
    current = detail(api, first['id'])
    assert current['revision'] == 2 and len(current['observations']) == 2
    assert current['initial_snapshot'] == original and len(store.read()['change_reviews']) == 1


def test_full_assign_handle_independent_review_close_and_audit(api, affected):
    client, store, headers = api
    case = ready(api, affected)
    submitted = action(api, case, 'submit', submit_body(affected['source']), actor='staff', key='submit-once')
    assert submitted['status'] == 'awaiting_review' and submitted['revision'] == 3
    assert action(api, case, 'submit', submit_body(affected['source']), actor='staff', key='submit-once') == submitted
    closed = action(api, submitted, 'review', {'decision': 'accept', 'note': '已复查引用和处理记录，可关闭。'}, key='review-once')
    assert closed['status'] == 'closed' and closed['closed_by'] == 'manager'
    assert closed['submissions'][0]['evidence'][0]['snapshot_text'] == CORRECTION
    assert action(api, submitted, 'review', {'decision': 'accept', 'note': '已复查引用和处理记录，可关闭。'}, key='review-once') == closed
    assert not closed['overdue']
    assert store.read()['care_tasks'][0]['status'] == 'pending'  # closing case never executes task
    events = client.get(f'/api/v1/items/{closed["id"]}/timeline', headers=headers('manager')).json()
    actions = {row['action'] for row in events}
    assert {'create_change_review', 'assign_change_review', 'submit_change_review', 'review_change_review'} <= actions
    task_events = client.get(f'/api/v1/items/{closed["task_id"]}/timeline', headers=headers('manager')).json()
    assert 'review_change_review' in {row['action'] for row in task_events}
    scanned = client.post(ROOT + '/scan', headers=headers('manager'), json={}).json()
    assert not scanned['created_ids'] and len(store.read()['change_reviews']) == 1


def test_permissions_filter_cases_and_timeline_and_recheck_current_actor(api, affected):
    client, store, headers = api
    case = affected['case']
    for actor in ('staff', 'other'):
        assert client.get(ROOT, headers=headers(actor)).json() == []
        assert client.get(ROOT + '/' + case['id'], headers=headers(actor)).status_code == 403
        assert client.get(f'/api/v1/items/{case["id"]}/timeline', headers=headers(actor)).status_code == 403
    for method, path, body in [('get', ROOT, None), ('post', ROOT + '/scan', {})]:
        kwargs = {'headers': headers('family')}
        if body is not None:
            kwargs['json'] = body
        assert getattr(client, method)(path, **kwargs).status_code == 403
    assert client.post(ROOT + '/scan', headers=headers(), json={}).status_code == 403
    assign(api, case, actor='staff', expected=403)
    assigned = assign(api, case)
    assert len(client.get(ROOT, headers=headers()).json()) == 1
    assert client.get(ROOT, headers=headers('other')).json() == []
    events = client.get('/api/v1/items/E1/timeline', headers=headers('other')).json()
    assert not any(row['source_id'] == case['id'] for row in events)
    action(api, assigned, 'submit', submit_body(affected['source']), actor='other', expected=403)
    # A stale signed role does not grant service-level rights inside the transaction.
    payload = ChangeAssignRequest(**version(assigned), assigned_to='staff', reason='核验')
    store.mutate(lambda data: data['users'][2].update(active=False))
    with pytest.raises(DomainError) as denied:
        service.assign(store, case['id'], payload, 'manager', 'supervisor')
    assert denied.value.status_code == 403


@pytest.mark.parametrize('bad', ['family', 'missing', 'inactive'])
def test_assignment_requires_active_staff_and_failed_write_is_atomic(api, affected, bad):
    _, store, _ = api
    target = bad
    if bad == 'inactive':
        target = 'other'
        store.mutate(lambda data: data['users'][1].update(active=False))
    before = store.path.read_bytes()
    assign(api, affected['case'], target, expected=404 if bad == 'missing' else 422)
    assert store.path.read_bytes() == before


def test_assignment_deadline_and_queue_filters(api, affected, monkeypatch):
    client, store, headers = api
    case = affected['case']
    action(api, case, 'assign', {'assigned_to': 'staff', 'reason': '安排复核', 'due_at': '2000-01-01T00:00:00Z'}, expected=422)
    due = datetime.now(timezone.utc) + timedelta(hours=1)
    assigned = action(api, case, 'assign', {'assigned_to': 'staff', 'reason': '安排复核', 'due_at': due.isoformat()})
    assert not assigned['overdue']
    monkeypatch.setattr(service, 'now', lambda: (due + timedelta(seconds=1)).isoformat())
    assert detail(api, case['id'])['overdue']
    assert len(client.get(ROOT + '?status=assigned&assigned_to=staff&elder_id=E1&task_id=' + case['task_id'], headers=headers('manager')).json()) == 1
    assert client.get(ROOT + '?status=closed', headers=headers('manager')).json() == []
    assert client.get(ROOT + '?status=made_up', headers=headers('manager')).status_code == 422


def test_stale_revision_fingerprint_and_unresolved_result_cannot_close_case(api, affected):
    _, store, _ = api
    case = assign(api, affected['case'])
    before = store.path.read_bytes()
    result = action(api, case, 'submit', submit_body(affected['source']), actor='staff', expected=409)
    assert result['detail'] == 'change_review_resolution_not_satisfied'
    assert store.path.read_bytes() == before
    assign(api, affected['case'], expected=409)
    withdraw(api, affected['task']['id'], affected['adopted']['references'][0]['id'], 2)
    assert action(api, case, 'submit', submit_body(affected['source']), actor='staff', expected=409)['detail'] == 'change_review_context_changed'


@pytest.mark.parametrize('bad', ['quote', 'revision', 'other_elder', 'old_raw', 'missing', 'forged_snapshot', 'empty'])
def test_evidence_must_be_current_same_elder_and_server_snapshot(api, affected, bad):
    client, store, headers = api
    case = ready(api, affected)
    body = submit_body(affected['source'])
    evidence = body['evidence'][0]
    expected = 422
    if bad == 'quote':
        evidence['quote'] = '来源不存在的句子'
    elif bad == 'revision':
        evidence['revision'] = 1
        expected = 409
    elif bad == 'other_elder':
        store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '另一位虚构老人', 'status': 'active'}))
        from scope_fixtures import grant
        grant(api, 'E2')
        other = client.post('/api/v1/records/manual', headers=headers(), json={
            'elder_id': 'E2', 'raw_text': '其他老人的记录', 'observations': ['其他老人的记录']}).json()['record']
        evidence.update(record_id=other['id'], revision=1, quote='其他老人的记录')
    elif bad == 'old_raw':
        evidence.update(field='raw_text', quote=affected['memory']['content'])
    elif bad == 'missing':
        evidence['record_id'] = 'missing'
        expected = 404
    elif bad == 'forged_snapshot':
        evidence['snapshot_text'] = '伪造'
    else:
        body['evidence'] = []
    before = store.path.read_bytes()
    action(api, case, 'submit', body, actor='staff', expected=expected)
    assert store.path.read_bytes() == before


def test_return_preserves_attempt_and_requires_resubmission(api, affected):
    case = ready(api, affected)
    submitted = action(api, case, 'submit', submit_body(affected['source']), actor='staff')
    returned = action(api, submitted, 'review', {'decision': 'return', 'note': '请补充本次核验说明。'})
    assert returned['status'] == 'assigned' and len(returned['submissions']) == len(returned['reviews']) == 1
    assert action(api, returned, 'review', {'decision': 'accept', 'note': '试图跳过重提'}, expected=409)['detail'] == 'change_review_not_awaiting_review'
    resubmitted = action(api, returned, 'submit', {**submit_body(affected['source']), 'note': '补充核验说明后重提。'}, actor='staff')
    closed = action(api, resubmitted, 'review', {'decision': 'accept', 'note': '复查通过。'})
    assert len(closed['submissions']) == len(closed['reviews']) == 2


def test_self_approval_is_rejected_and_another_manager_can_review(api, affected):
    _, store, _ = api
    case = ready(api, affected, assignee='manager')
    submitted = action(api, case, 'submit', submit_body(affected['source']), actor='manager')
    assert action(api, submitted, 'review', {'decision': 'accept', 'note': '自己审核'}, expected=403)['detail'] == 'change_review_requires_another_reviewer'
    # Reuse a fictional test identity with a new role; credentials never enter business objects.
    store.mutate(lambda data: data['users'][1].update(role='supervisor'))
    closed = action(api, submitted, 'review', {'decision': 'accept', 'note': '另一位主管复查'}, actor='other')
    assert closed['closed_by'] == 'other'


def test_evidence_corrected_after_submission_blocks_acceptance_and_retains_snapshot(api, affected):
    case = ready(api, affected)
    submitted = action(api, case, 'submit', submit_body(affected['source']), actor='staff')
    # Use a separate supporting record, so changing it does not change adopted memory context.
    client, _, headers = api
    extra = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': 'E1', 'raw_text': '已核对本次意愿', 'observations': ['已核对本次意愿']}).json()['record']
    returned = action(api, submitted, 'review', {'decision': 'return', 'note': '补充现场记录'})
    submitted = action(api, returned, 'submit', submit_body(extra), actor='staff')
    correct(api, extra, '原核验记录不完整，需重新核对。')
    current = detail(api, case['id'])
    assert action(api, current, 'review', {'decision': 'accept', 'note': '复查'}, expected=409)['detail'] == 'change_evidence_not_current'
    assert current['submissions'][-1]['evidence'][0]['snapshot_text'] == '已核对本次意愿'


def test_context_changed_after_submission_cannot_be_closed_without_resubmission(api, affected):
    client, _, headers = api
    case = ready(api, affected)
    submitted = action(api, case, 'submit', submit_body(affected['source']), actor='staff')
    response = client.patch(f'/api/v1/tasks/{case["task_id"]}', headers=headers('manager'), json={
        'expected_revision': 3, 'assigned_to': 'other'})
    assert response.status_code == 200
    assert action(api, submitted, 'review', {'decision': 'accept', 'note': '复查'}, expected=409)['detail'] == 'change_review_context_changed'
    current = detail(api, case['id'])
    assert action(api, current, 'review', {'decision': 'accept', 'note': '复查'}, expected=409)['detail'] == 'change_review_submission_outdated'
    returned = action(api, current, 'review', {'decision': 'return', 'note': '任务已转交，请重新核对。'})
    assert returned['status'] == 'assigned'


def test_memory_change_after_task_completion_keeps_historical_case_and_blocks_stale_acceptance(api, affected):
    client, store, headers = api
    case = assign(api, affected['case'])
    assert client.post(f'/api/v1/tasks/{case["task_id"]}/complete', headers=headers(), json={'result': '本次服务已结束'}).status_code == 200
    case = detail(api, case['id'])
    action(api, case, 'submit', submit_body(affected['source'], 'task_terminal'), actor='staff')
    # A terminated task is historical: later memory changes never reopen it or auto-reset this case.
    correct(api, affected['source'], '又一次更正当前意愿。')
    current = detail(api, case['id'])
    assert current['status'] == 'awaiting_review' and len(current['submissions']) == 1
    assert action(api, current, 'review', {'decision': 'accept', 'note': '复查'}, expected=409)['detail'] == 'change_review_submission_outdated'
    assert store.read()['care_tasks'][0]['status'] == 'completed'


@pytest.mark.parametrize('change', ['request_review', 'retire', 'revise'])
def test_memory_lifecycle_changes_also_create_cases(api, change):
    client, store, headers = api
    memory, source = create_memory(api)
    task = create_task(api)
    adopt(api, memory, task)
    if change == 'revise':
        body = {'expected_revision': memory['revision'], 'reason': '补充本人习惯', 'content': memory['content'],
                'category': memory['category'], 'scenes': memory['scenes'], 'attributed_to': 'elder',
                'source_record_id': source['id'], 'source_revision': 1, 'source_field': 'observations',
                'source_quote': source['observations'][0]}
        result = client.post(f'/api/v1/memories/{memory["id"]}/revisions', headers=headers(), json=body)
    else:
        result = client.post(f'/api/v1/memories/{memory["id"]}/review', headers=headers('manager'), json={
            'expected_revision': memory['revision'], 'reason': '需要重新核验', 'action': change})
    assert result.status_code == 200, result.text
    cases = store.read()['change_reviews']
    assert len(cases) == 1 and cases[0]['task_id'] == task['id']
    assert cases[0]['initial_snapshot']['reference']['snapshot']['content'] == memory['content']


def test_one_memory_change_fans_out_to_each_affected_task_only_once(api):
    client, store, headers = api
    memory, source = create_memory(api)
    tasks = [create_task(api), create_task(api)]
    for task in tasks:
        adopt(api, memory, task)
    correct(api, source)
    assert {row['task_id'] for row in store.read()['change_reviews']} == {row['id'] for row in tasks}
    assert client.post(ROOT + '/scan', headers=headers('manager'), json={}).json()['created_ids'] == []


def test_impact_creation_and_source_correction_commit_together_or_not_at_all(api, monkeypatch):
    client, store, headers = api
    memory, source = create_memory(api)
    adopt(api, memory, create_task(api))
    before = store.path.read_bytes()
    def failure(*args, **kwargs):
        raise DomainError('simulated_impact_failure')
    monkeypatch.setattr(service, 'reconcile', failure)
    response = client.post(f'/api/v1/records/{source["id"]}/corrections', headers=headers(), json={
        'expected_revision': 1, 'reason': '验证事务回滚', 'observations': [CORRECTION]})
    assert response.status_code == 409
    assert store.path.read_bytes() == before


def test_replacement_requires_a_valid_new_explicit_reference(api, affected):
    client, _, headers = api
    case = ready(api, affected)
    body = submit_body(affected['source'], 'reference_replaced')
    assert action(api, case, 'submit', body, actor='staff', expected=409)['detail'] == 'change_review_resolution_not_satisfied'
    new_memory, _ = create_memory(api, content='目前愿意参加下午活动')
    adopt(api, new_memory, {**affected['task'], 'revision': 3})
    current = detail(api, case['id'])
    assert len(current['current']['replacements']) == 1
    submitted = action(api, current, 'submit', body, actor='staff')
    # Replacement becoming invalid before review also invalidates the submitted conclusion.
    result = client.post(f'/api/v1/memories/{new_memory["id"]}/review', headers=headers('manager'), json={
        'expected_revision': new_memory['revision'], 'action': 'retire', 'reason': '新依据也需停用'})
    assert result.status_code == 200
    current = detail(api, case['id'])
    assert current['current']['replacements'] == []
    assert action(api, current, 'review', {'decision': 'accept', 'note': '复查'}, expected=409)['detail'] == 'change_review_submission_outdated'


def test_draft_handover_created_before_adoption_is_located_and_refresh_invalidates_view(api):
    client, _, headers = api
    source_shift, target_shift = shifts(api)
    memory, source = create_memory(api)
    task = create_task(api, source_shift['id'])
    handover = client.post('/api/v1/handovers', headers=headers(), json={
        'source_shift_id': source_shift['id'], 'target_shift_id': target_shift['id']}).json()
    adopted = adopt(api, memory, task)
    correct(api, source)
    case = client.get(ROOT, headers=headers('manager')).json()[0]
    linkage = case['current']['handovers'][0]
    assert not linkage['historical_only'] and not linkage['snapshot_contains_reference']
    case = assign(api, case)
    withdraw(api, task['id'], adopted['references'][0]['id'], 2)
    case = detail(api, case['id'])
    assert client.post(f'/api/v1/handovers/{handover["id"]}/refresh', headers=headers()).status_code == 200
    assert action(api, case, 'submit', submit_body({**source, 'revision': 2, 'observations': [CORRECTION]}),
                  actor='staff', expected=409)['detail'] == 'change_review_context_changed'
    current = detail(api, case['id'])
    assert current['current']['handovers'][0]['snapshot_contains_reference']


def test_reassignment_revokes_old_assignee_and_idempotency_does_not_bypass_access(api, affected):
    client, _, headers = api
    case = ready(api, affected)
    body = submit_body(affected['source'])
    submitted = action(api, case, 'submit', body, actor='staff', key='old-assignee-submit')
    reassigned = assign(api, submitted, 'other')
    assert reassigned['status'] == 'assigned' and len(reassigned['submissions']) == 1
    assert client.get(ROOT + '/' + case['id'], headers=headers()).status_code == 403
    action(api, case, 'submit', body, actor='staff', key='old-assignee-submit', expected=403)


@pytest.mark.parametrize('missing', ['task', 'reference', 'handover'])
def test_missing_linked_data_blocks_closure_instead_of_silently_ignoring_it(api, affected, missing):
    _, store, _ = api
    case = ready(api, affected)
    def mutate(data):
        if missing == 'task':
            data['care_tasks'].clear()
        elif missing == 'reference':
            data['care_tasks'][0]['memory_references'].clear()
        else:
            data['handover_items'].append({'id': 'ORPHAN', 'kind': 'task', 'source_id': case['task_id'],
                                          'handover_id': 'missing', 'status': 'pending', 'memory_references': []})
    store.mutate(mutate)
    current = detail(api, case['id'])
    assert current['current']['integrity_error']
    assert action(api, current, 'submit', submit_body(affected['source']), actor='staff', expected=409)['detail'] == 'change_review_integrity_error'


def test_natural_expiry_requires_scan_get_is_read_only_and_review_due_is_not_expiry(api, monkeypatch):
    client, store, headers = api
    memory, _ = create_memory(api)
    task = create_task(api)
    base = datetime.now(timezone.utc) + timedelta(hours=1)
    store.mutate(lambda data: data['care_memories'][0].update(expires_at=(base + timedelta(hours=2)).isoformat(),
                                                           review_due_at=base.isoformat()))
    adopt(api, memory, task)
    monkeypatch.setattr(service, 'now', lambda: base.isoformat())
    assert client.post(ROOT + '/scan', headers=headers('manager'), json={}).json()['created_ids'] == []
    monkeypatch.setattr(service, 'now', lambda: (base + timedelta(hours=2)).isoformat())
    before = store.path.read_bytes()
    assert client.get(ROOT, headers=headers('manager')).json() == []
    assert store.path.read_bytes() == before
    auth = {**headers('manager'), 'Idempotency-Key': 'expiry-scan'}
    first = client.post(ROOT + '/scan', headers=auth, json={'elder_id': 'E1'}).json()
    assert len(first['created_ids']) == 1
    assert client.post(ROOT + '/scan', headers=auth, json={'elder_id': 'E1'}).json() == first
    assert client.post(ROOT + '/scan', headers=auth, json={}).status_code == 409
    case = detail(api, first['created_ids'][0])
    assert 'memory_expired' in case['initial_snapshot']['reference']['current']['reasons']


def test_closed_or_withdrawn_references_do_not_generate_new_cases(api):
    client, store, headers = api
    memory, source = create_memory(api)
    first, second = create_task(api), create_task(api)
    a = adopt(api, memory, first)
    adopt(api, memory, second)
    withdraw(api, first['id'], a['references'][0]['id'], 2)
    client.post(f'/api/v1/tasks/{second["id"]}/complete', headers=headers(), json={'result': '本次服务已结束'})
    correct(api, source)
    assert store.read()['change_reviews'] == []
    assert client.post(ROOT + '/scan', headers=headers('manager'), json={}).json()['created_ids'] == []


def test_concurrent_assignment_has_one_winner_and_one_audit(api, affected):
    _, store, _ = api
    case = affected['case']
    payload = ChangeAssignRequest(**version(case), assigned_to='staff', reason='并发指派核验')
    def run(_):
        try:
            return service.assign(store, case['id'], payload, 'manager', 'supervisor')['revision']
        except DomainError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(run, range(5)))
    assert results.count(2) == 1 and results.count('stale_revision') == 4
    assert len([row for row in store.read()['audit_logs'] if row['action'] == 'assign_change_review']) == 1


def test_cross_shift_case_locates_historical_handover_and_requires_acknowledgment(api):
    client, store, headers = api
    source_shift, target_shift = shifts(api)
    memory, source = create_memory(api)
    task = create_task(api, source_shift['id'])
    adopted = adopt(api, memory, task)
    handover = client.post('/api/v1/handovers', headers=headers(), json={
        'source_shift_id': source_shift['id'], 'target_shift_id': target_shift['id']}).json()
    url = '/api/v1/handovers/' + handover['id']
    assert client.post(url + '/submit', headers=headers(), json={'expected_revision': handover['revision']}).status_code == 200
    for item in handover['items']:
        assert client.post(url + f'/items/{item["id"]}/receive', headers=headers('other'), json={'status': 'received'}).status_code == 200
    source = correct(api, source)
    case = client.get(ROOT, headers=headers('manager')).json()[0]
    assert case['task_id'] == task['id'] and case['current']['task']['shift_id'] == target_shift['id']
    linked = case['current']['handovers']
    assert len(linked) == 1 and linked[0]['handover_id'] == handover['id'] and linked[0]['historical_only']
    assert linked[0]['snapshot_memory_revision'] == memory['revision']
    case = assign(api, case, 'other')
    withdraw(api, task['id'], adopted['references'][0]['id'], 3, actor='other')
    case = detail(api, case['id'])
    body = submit_body(source)
    assert action(api, case, 'submit', body, actor='other', expected=422)['detail'] == 'change_review_handover_acknowledgment_required'
    submitted = action(api, case, 'submit', {**body, 'acknowledged_handover_ids': [handover['id']]}, actor='other')
    closed = action(api, submitted, 'review', {'decision': 'accept', 'note': '已核对接班信息和旧快照。'})
    assert closed['status'] == 'closed'
    old = client.get(url, headers=headers('manager')).json()
    old_ref = next(row for row in old['items'] if row['kind'] == 'task')['memory_references'][0]
    assert old_ref['status'] == 'active' and old_ref['snapshot'] == adopted['references'][0]['snapshot']
    assert len(store.read()['care_tasks']) == 1


@pytest.mark.parametrize('version_number', [1, 2, 3])
def test_schema_four_migration_preserves_data_and_backups(tmp_path, version_number):
    data = copy.deepcopy(EMPTY_STORE)
    data.pop('change_reviews')
    if version_number < 3:
        data.pop('care_memories')
    if version_number < 2:
        data.pop('quality_checks')
        data.pop('idempotency_keys')
    data.update(schema_version=version_number, custom_metadata={'preserved': True})
    data['users'] = [{'id': 'staff', 'password_hash': 'test-only-placeholder'}]
    data['care_tasks'] = [{'id': 'T1', 'memory_references': [{'id': 'R1', 'snapshot': {'content': '历史内容'}}]}]
    original = json.dumps(data, ensure_ascii=False).encode()
    store = JsonStore(tmp_path)
    store.path.write_bytes(original)
    with pytest.raises(RuntimeError):
        store.read()
    backup = store.migrate()
    assert backup.read_bytes() == original
    upgraded = store.read()
    from app.storage.json_store import CURRENT_SCHEMA_VERSION
    assert upgraded['schema_version'] == CURRENT_SCHEMA_VERSION and upgraded['change_reviews'] == []
    for key, value in data.items():
        if key != 'schema_version':
            assert upgraded[key] == value
    assert store.migrate() is None


@pytest.mark.parametrize('field', ['change_reviews', 'care_memories', 'care_tasks'])
def test_v3_corrupt_migration_is_rejected_without_writes(tmp_path, field):
    data = copy.deepcopy(EMPTY_STORE)
    data['schema_version'] = 3
    data[field] = {}
    original = json.dumps(data).encode()
    store = JsonStore(tmp_path)
    store.path.write_bytes(original)
    with pytest.raises(RuntimeError):
        store.migrate()
    assert store.path.read_bytes() == original and not (tmp_path / 'backups').exists()
