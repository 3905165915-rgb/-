from concurrent.futures import ThreadPoolExecutor
import copy
from datetime import datetime, timedelta, timezone
import json

import pytest

from app.schemas.task_condition import ConditionCheckRequest
from app.services import ai_service, assistant_service, task_condition_service as service, task_service
from app.services.ai_service import MockAIProvider
from app.services.workflow import DomainError
from test_handovers import shifts


CONDITION = '等家属回复确认后再安排活动'
CRITERION = '核实家属对本次活动安排的回复，并记录原话与时间'
QUOTE = '家属回复：已与老人商量，今天下午可以参加这次活动。'


def create(api, shift_id=None, condition=CONDITION):
    client, _, headers = api
    candidate = {'title': '安排本次活动', 'assigned_to': 'staff'}
    if condition is not None:
        candidate['condition'] = condition
    result = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': 'E1', 'shift_id': shift_id, 'raw_text': '本次活动要先核实安排。', 'task_candidates': [candidate]})
    assert result.status_code == 201, result.text
    return result.json()['tasks'][0]


def proof(api, text=QUOTE, elder_id='E1'):
    client, _, headers = api
    result = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': elder_id, 'raw_text': text, 'observations': [text]})
    assert result.status_code == 201, result.text
    return result.json()['record']


def get(api, task_id):
    client, _, headers = api
    result = client.get(f'/api/v1/tasks/{task_id}/condition', headers=headers())
    assert result.status_code == 200, result.text
    return result.json()


def action(api, task_id, suffix, body, actor='staff', expected=200, key=None):
    client, _, headers = api
    auth = headers(actor)
    if key:
        auth['Idempotency-Key'] = key
    result = client.post(f'/api/v1/tasks/{task_id}/condition/{suffix}', headers=auth, json=body)
    assert result.status_code == expected, result.text
    return result.json()


def configure(api, task, checker_id='staff', **kwargs):
    return action(api, task['id'], 'configure', {
        'expected_task_revision': task.get('task_revision', task.get('revision')),
        'criterion': CRITERION, 'checker_id': checker_id, 'reason': '明确本次条件核验标准与责任人'}, actor='manager', **kwargs)


def check_body(current, source, outcome='met'):
    return {
        'expected_task_revision': current['task_revision'], 'outcome': outcome, 'note': '已人工核对本次回复记录',
        'valid_until': (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat() if outcome == 'met' else None,
        'evidence': [{'record_id': source['id'], 'revision': source['revision'],
                      'field': 'observations', 'quote': source['observations'][0]}],
    }


@pytest.fixture
def conditional(api):
    task = create(api)
    source = proof(api)
    current = configure(api, task)
    return task, source, current


@pytest.mark.parametrize('stage', ['unconfigured', 'waiting', 'not_met'])
@pytest.mark.parametrize('operation', ['start', 'complete'])
def test_unsatisfied_conditions_block_both_old_execution_endpoints(api, stage, operation):
    client, store, headers = api
    task = create(api)
    current = get(api, task['id'])
    if stage != 'unconfigured':
        current = configure(api, task)
    if stage == 'not_met':
        current = action(api, task['id'], 'check', check_body(current, proof(api, '家属回复：先等等，目前尚不同意。'), 'not_met'))
    assert current['current']['state'] == stage and not current['current']['ready']
    before = store.path.read_bytes()
    suffix, body = ('transition', {'expected_revision': current['task_revision'], 'action': 'start'}) if operation == 'start' else ('complete', {'result': '试图执行'})
    result = client.post(f'/api/v1/tasks/{task["id"]}/{suffix}', headers=headers(), json=body)
    assert result.status_code == 409 and result.json()['detail'] == 'task_condition_not_ready'
    assert store.path.read_bytes() == before


def test_unconditional_task_needs_no_configuration_and_no_fake_state_is_saved(api):
    client, store, headers = api
    task = create(api, condition=None)
    before = store.path.read_bytes()
    current = get(api, task['id'])
    assert current['verification'] is None and current['current']['state'] == 'not_required'
    assert current['current']['execution_allowed'] and store.path.read_bytes() == before
    assert configure(api, task, expected=422)['detail'] == 'task_has_no_condition'
    assert client.post(f'/api/v1/tasks/{task["id"]}/complete', headers=headers(), json={'result': '已完成本次活动安排'}).status_code == 200


def test_manual_not_met_then_met_does_not_execute_task_and_tracks_actor_source_history(api, conditional):
    client, store, headers = api
    task, source, current = conditional
    negative = proof(api, '家属表示目前不能确定，请稍后再问。')
    not_met = action(api, task['id'], 'check', check_body(current, negative, 'not_met'))
    assert not_met['current']['state'] == 'not_met'
    met = action(api, task['id'], 'check', check_body(not_met, source))
    assert met['current']['state'] == 'met' and met['current']['execution_allowed']
    latest = met['verification']['latest_check']
    assert latest['checked_by'] == 'staff' and latest['evidence'][0]['snapshot_text'] == QUOTE
    assert len(met['verification']['history']) == 3
    assert store.read()['care_tasks'][0]['status'] == 'pending'
    started = client.post(f'/api/v1/tasks/{task["id"]}/transition', headers=headers(), json={
        'expected_revision': met['task_revision'], 'action': 'start'})
    assert started.status_code == 200 and started.json()['status'] == 'in_progress'
    done = client.post(f'/api/v1/tasks/{task["id"]}/complete', headers=headers(), json={'result': '已安排本次活动'})
    assert done.status_code == 200
    historical = get(api, task['id'])
    assert historical['historical_only'] and not historical['current']['execution_allowed']
    assert action(api, task['id'], 'check', check_body(historical, source), expected=409)['detail'] == 'task_is_terminal'


def test_check_only_named_checker_can_submit_even_management_cannot_impersonate(api, conditional):
    client, _, headers = api
    task, source, current = conditional
    body = check_body(current, source)
    for actor in ('other', 'manager', 'family'):
        action(api, task['id'], 'check', body, actor=actor, expected=403)
    assert client.get(f'/api/v1/tasks/{task["id"]}/condition', headers=headers('family')).status_code == 403
    action(api, task['id'], 'configure', {'expected_task_revision': 2, 'criterion': CRITERION,
           'checker_id': 'staff', 'reason': '护理员越权配置'}, expected=403)


@pytest.mark.parametrize('case', ['wrong_elder', 'wrong_revision', 'missing', 'invented_quote', 'snapshot', 'empty', 'old_raw'])
def test_condition_evidence_rejects_false_or_stale_inputs_atomically(api, conditional, case):
    client, store, headers = api
    task, source, current = conditional
    body = check_body(current, source)
    expected = 422
    evidence = body['evidence'][0]
    if case == 'wrong_elder':
        store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '另一位虚构老人', 'status': 'active'}))
        other = proof(api, elder_id='E2')
        evidence['record_id'] = other['id']
    elif case == 'wrong_revision':
        evidence['revision'] = 99
        expected = 409
    elif case == 'missing':
        evidence['record_id'] = 'missing'
        expected = 404
    elif case == 'invented_quote':
        evidence['quote'] = '不存在的回复'
    elif case == 'snapshot':
        evidence['snapshot_text'] = '伪造证据快照'
    elif case == 'empty':
        body['evidence'] = []
    else:
        result = client.post(f'/api/v1/records/{source["id"]}/corrections', headers=headers(), json={
            'expected_revision': 1, 'observations': ['之前回复不准确，应重新核对'], 'reason': '补充更正'})
        assert result.status_code == 200
        evidence.update(field='raw_text', revision=2)
    before = store.path.read_bytes()
    action(api, task['id'], 'check', body, expected=expected)
    assert store.path.read_bytes() == before


def test_expiry_required_for_met_and_timezone_and_future_time_checked(api, conditional):
    _, store, _ = api
    task, source, current = conditional
    original = check_body(current, source)
    for expiry in (None, '2000-01-01T00:00:00Z', '2099-01-01T08:00:00'):
        before = store.path.read_bytes()
        action(api, task['id'], 'check', {**original, 'valid_until': expiry}, expected=422)
        assert store.path.read_bytes() == before


def test_correction_invalidates_current_check_without_overwriting_snapshot_or_task_revision(api, conditional):
    client, store, headers = api
    task, source, current = conditional
    met = action(api, task['id'], 'check', check_body(current, source))
    assert client.post(f'/api/v1/tasks/{task["id"]}/transition', headers=headers(), json={
        'expected_revision': met['task_revision'], 'action': 'start'}).status_code == 200
    corrected = client.post(f'/api/v1/records/{source["id"]}/corrections', headers=headers(), json={
        'expected_revision': 1, 'reason': '家属澄清刚才回复有误', 'observations': ['家属更正为尚未同意，请重新确认。']})
    assert corrected.status_code == 200
    before = store.path.read_bytes()
    stale = get(api, task['id'])
    assert stale['current']['state'] == 'needs_recheck' and not stale['current']['evidence_current']
    assert stale['verification'] == met['verification'] and store.path.read_bytes() == before
    assert client.post(f'/api/v1/tasks/{task["id"]}/complete', headers=headers(), json={'result': '试图沿用旧结论'}).status_code == 409
    events = client.get(f'/api/v1/items/{task["id"]}/timeline', headers=headers()).json()
    assert {'check_task_condition', 'correct_record'} <= {row['action'] for row in events}
    checked = next(row for row in events if row['action'] == 'check_task_condition')
    assert checked['condition_change']['after']['latest_check']['evidence'][0]['snapshot_text'] == QUOTE


def test_natural_expiry_and_execution_timestamp_use_same_instant(api, conditional, monkeypatch):
    client, store, headers = api
    task, source, current = conditional
    base = datetime.now(timezone.utc) + timedelta(seconds=10)
    body = {**check_body(current, source), 'valid_until': (base + timedelta(seconds=1)).isoformat()}
    action(api, task['id'], 'check', body)
    monkeypatch.setattr(service, 'now', lambda: base.isoformat())
    assert get(api, task['id'])['current']['ready']
    monkeypatch.setattr(task_service, 'now', lambda: (base + timedelta(seconds=1)).isoformat())
    before = store.path.read_bytes()
    result = client.post(f'/api/v1/tasks/{task["id"]}/complete', headers=headers(), json={'result': '到期边界执行'})
    assert result.status_code == 409 and store.path.read_bytes() == before
    monkeypatch.setattr(service, 'now', lambda: (base + timedelta(seconds=1)).isoformat())
    assert get(api, task['id'])['current']['expired']


def test_reconfigure_resets_effective_check_preserves_history_and_revokes_replay(api, conditional):
    _, store, _ = api
    task, source, current = conditional
    body = check_body(current, source)
    met = action(api, task['id'], 'check', body, key='condition-check-once')
    assert action(api, task['id'], 'check', body, key='condition-check-once') == met
    assert action(api, task['id'], 'check', {**body, 'note': '不同说明'}, key='condition-check-once', expected=409)['detail'] == 'idempotency_key_payload_mismatch'
    reconfigured = configure(api, {**task, 'revision': met['task_revision']}, checker_id='other')
    assert reconfigured['current']['state'] == 'waiting' and reconfigured['verification']['latest_check'] is None
    assert len(reconfigured['verification']['history']) == 3
    action(api, task['id'], 'check', body, key='condition-check-once', expected=403)
    assert store.read()['care_tasks'][0]['status'] == 'pending'


def test_concurrent_checks_one_winner_and_one_audit(api, conditional):
    _, store, _ = api
    task, source, current = conditional
    payload = ConditionCheckRequest(**check_body(current, source))
    def run(_):
        try:
            return service.check(store, task['id'], payload, 'staff', 'caregiver')['task_revision']
        except DomainError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(run, range(5)))
    assert results.count(3) == 1 and results.count('stale_revision') == 4
    assert len([row for row in store.read()['audit_logs'] if row['action'] == 'check_task_condition']) == 1


def test_task_creation_cannot_inject_condition_confirmation(api):
    client, store, headers = api
    for field in ('condition_verification', 'condition_check'):
        before = store.path.read_bytes()
        result = client.post('/api/v1/records/manual', headers=headers(), json={
            'elder_id': 'E1', 'raw_text': CONDITION, 'task_candidates': [{
                'title': '不能伪造条件已满足', 'condition': CONDITION, field: {'status': 'met'}}]})
        assert result.status_code == 422 and store.path.read_bytes() == before


def test_unmet_task_can_be_recorded_not_done_transferred_or_cancelled(api, conditional):
    client, _, headers = api
    task, _, current = conditional
    url = f'/api/v1/tasks/{task["id"]}/transition'
    result = client.post(url, headers=headers(), json={'expected_revision': current['task_revision'],
        'action': 'not_done', 'reason_code': 'other', 'note': '家属尚未回复，条件未满足'})
    assert result.status_code == 200
    result = client.post(url, headers=headers(), json={'expected_revision': result.json()['revision'],
        'action': 'transfer', 'assigned_to': 'other', 'note': '转交继续跟踪'})
    assert result.status_code == 200
    result = client.post(url, headers=headers('manager'), json={'expected_revision': result.json()['revision'],
        'action': 'cancel', 'note': '本次活动取消，保留条件核验历史'})
    assert result.status_code == 200 and get(api, task['id'])['historical_only']


@pytest.mark.parametrize('bad_checker', ['family', 'missing', 'inactive', 'wrong_shift'])
def test_checker_assignment_validates_staff_and_shift(api, bad_checker):
    _, store, _ = api
    source_shift, _ = shifts(api)
    task = create(api, source_shift['id'])
    target = bad_checker
    if bad_checker == 'inactive':
        target = 'staff'
        store.mutate(lambda data: data['users'][0].update(active=False))
    if bad_checker == 'wrong_shift':
        target = 'other'
    before = store.path.read_bytes()
    configure(api, task, checker_id=target, expected=404 if bad_checker == 'missing' else 422)
    assert store.path.read_bytes() == before


def test_closed_shift_rejects_new_condition_configuration_and_check(api):
    client, store, headers = api
    source_shift, target_shift = shifts(api)
    task = create(api, source_shift['id'])
    source = proof(api)
    current = configure(api, task)
    handover = client.post('/api/v1/handovers', headers=headers(), json={
        'source_shift_id': source_shift['id'], 'target_shift_id': target_shift['id']}).json()
    assert client.post(f'/api/v1/handovers/{handover["id"]}/submit', headers=headers(), json={'expected_revision': 1}).status_code == 200
    before = store.path.read_bytes()
    assert action(api, task['id'], 'check', check_body(current, source), expected=409)['detail'] == 'shift_closed'
    configure(api, {**task, 'revision': current['task_revision']}, expected=409)
    assert store.path.read_bytes() == before


def test_cross_shift_preserves_old_snapshot_clears_confirmation_and_requires_claim_then_recheck(api):
    client, store, headers = api
    source_shift, target_shift = shifts(api)
    task = create(api, source_shift['id'])
    source = proof(api)
    current = configure(api, task)
    met = action(api, task['id'], 'check', check_body(current, source))
    handover = client.post('/api/v1/handovers', headers=headers(), json={
        'source_shift_id': source_shift['id'], 'target_shift_id': target_shift['id']}).json()
    url = f'/api/v1/handovers/{handover["id"]}'
    task_item = next(row for row in handover['items'] if row['kind'] == 'task')
    assert task_item['condition_check']['state'] == 'met'
    old_snapshot = copy.deepcopy(task_item['condition_verification'])
    assert client.post(url + '/submit', headers=headers(), json={'expected_revision': 1}).status_code == 200
    for item in handover['items']:
        assert client.post(url + f'/items/{item["id"]}/receive', headers=headers('other'), json={'status': 'received'}).status_code == 200
    carried = get(api, task['id'])
    assert carried['current']['state'] == 'awaiting_assignment' and carried['verification']['latest_check'] is None
    assert carried['verification']['history'][-1]['before']['latest_check'] == met['verification']['latest_check']
    body = {'expected_task_revision': carried['task_revision'], 'reason': '接班后认领条件核验'}
    action(api, task['id'], 'claim', body, expected=403)
    claimed = action(api, task['id'], 'claim', body, actor='other', key='claim-once')
    assert action(api, task['id'], 'claim', body, actor='other', key='claim-once') == claimed
    assert claimed['current']['state'] == 'waiting'
    assert client.post(f'/api/v1/tasks/{task["id"]}/complete', headers=headers('other'), json={'result': '试图复用上班结论'}).status_code == 409
    checked = action(api, task['id'], 'check', check_body(claimed, source), actor='other')
    assert checked['current']['ready']
    assert client.post(f'/api/v1/tasks/{task["id"]}/complete', headers=headers('other'), json={'result': '接班核验后安排活动'}).status_code == 200
    old = client.get(url, headers=headers('other')).json()
    historical = next(row for row in old['items'] if row['kind'] == 'task')
    assert historical['condition_verification'] == old_snapshot and historical['condition_check']['state'] == 'met'
    assert len(store.read()['care_tasks']) == 1


def test_draft_handover_detects_natural_expiry_without_task_revision_change(api, monkeypatch):
    client, _, headers = api
    source_shift, target_shift = shifts(api)
    task = create(api, source_shift['id'])
    source = proof(api)
    current = configure(api, task)
    base = datetime.now(timezone.utc) + timedelta(seconds=10)
    monkeypatch.setattr(service, 'now', lambda: base.isoformat())
    from app.services import handover_service
    monkeypatch.setattr(handover_service, 'now', lambda: base.isoformat())
    body = {**check_body(current, source), 'valid_until': (base + timedelta(minutes=1)).isoformat()}
    met = action(api, task['id'], 'check', body)
    handover = client.post('/api/v1/handovers', headers=headers(), json={
        'source_shift_id': source_shift['id'], 'target_shift_id': target_shift['id']}).json()
    monkeypatch.setattr(handover_service, 'now', lambda: (base + timedelta(minutes=1)).isoformat())
    result = client.post(f'/api/v1/handovers/{handover["id"]}/submit', headers=headers(), json={'expected_revision': 1})
    assert result.status_code == 409 and result.json()['detail'] == 'handover_needs_refresh'
    monkeypatch.setattr(service, 'now', lambda: (base + timedelta(minutes=1)).isoformat())
    assert get(api, task['id'])['task_revision'] == met['task_revision']


def test_assistant_uses_check_metadata_and_stale_draft_is_rejected_after_source_correction(api, conditional, monkeypatch):
    client, _, headers = api
    task, source, current = conditional
    action(api, task['id'], 'check', check_body(current, source))
    monkeypatch.setattr(assistant_service, 'get_ai_provider', lambda: MockAIProvider())
    response = client.post('/api/v1/records/context-extract', headers=headers(), json={
        'elder_id': 'E1', 'scene': 'activity', 'text': '老人今天表示愿意先休息。'})
    assert response.status_code == 200, response.text
    draft = response.json()
    inputs = draft['context_snapshot']['sources']
    task_input = json.loads(next(row for row in inputs if row['kind'] == 'task')['text'])
    assert task_input['condition_check']['state'] == 'met'
    assert QUOTE not in json.dumps(task_input, ensure_ascii=False)
    assert client.post(f'/api/v1/records/{source["id"]}/corrections', headers=headers(), json={
        'expected_revision': 1, 'observations': ['家属尚未明确回复'], 'reason': '更正核实结果'}).status_code == 200
    result = client.post(f'/api/v1/records/{draft["id"]}/confirm', headers=headers(), json={})
    assert result.status_code == 409 and result.json()['detail'] == 'assistant_context_changed'


def test_quality_reports_unmet_and_overdue_condition_without_running_task(api, conditional, monkeypatch):
    client, store, headers = api
    task, _, current = conditional
    due = datetime.now(timezone.utc) + timedelta(minutes=10)
    configured = action(api, task['id'], 'configure', {'expected_task_revision': current['task_revision'],
        'criterion': CRITERION, 'checker_id': 'staff', 'check_due_at': due.isoformat(), 'reason': '设置核验提醒'}, actor='manager')
    from app.services import quality_service
    monkeypatch.setattr(quality_service, 'now', lambda: (due + timedelta(seconds=1)).isoformat())
    result = client.post('/api/v1/quality/checks', headers=headers('manager'), json={'elder_id': 'E1'})
    assert result.status_code == 201
    assert {'task_condition_blocked', 'condition_check_overdue'} <= {row['code'] for row in result.json()['issues']}
    assert store.read()['care_tasks'][0]['revision'] == configured['task_revision']


def test_disabled_checker_cannot_write_and_old_legacy_condition_is_read_only(api, conditional):
    _, store, _ = api
    task, source, current = conditional
    payload = ConditionCheckRequest(**check_body(current, source))
    store.mutate(lambda data: data['users'][0].update(active=False))
    before = store.path.read_bytes()
    with pytest.raises(DomainError) as rejected:
        service.check(store, task['id'], payload, 'staff', 'caregiver')
    assert rejected.value.status_code == 403 and store.path.read_bytes() == before
    # Missing optional data must not manufacture a historical confirmation on read.
    store.mutate(lambda data: data['care_tasks'][0].pop('condition_verification'))
    before = store.path.read_bytes()
    result = service.get(store, task['id'])
    assert result['verification'] is None and result['current']['state'] == 'unconfigured'
    assert store.path.read_bytes() == before


def test_claim_cannot_invent_configuration_or_replace_a_named_checker(api):
    _, store, _ = api
    task = create(api)
    before = store.path.read_bytes()
    assert action(api, task['id'], 'claim', {'expected_task_revision': 1, 'reason': '试图直接认领'}, expected=409)['detail'] == 'condition_requires_configuration'
    assert store.path.read_bytes() == before
    configured = configure(api, task)
    before = store.path.read_bytes()
    assert action(api, task['id'], 'claim', {'expected_task_revision': configured['task_revision'],
                  'reason': '已有核验人不得重新认领'}, expected=409)['detail'] == 'condition_checker_already_assigned'
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('kind', ['summary', 'quality'])
def test_ai_call_cannot_save_a_result_based_on_a_condition_expiring_in_flight(api, monkeypatch, kind):
    client, store, headers = api
    from app.services import handover_service, quality_service
    source_shift, target_shift = shifts(api)
    task = create(api, source_shift['id'])
    source = proof(api)
    current = configure(api, task)
    base = datetime.now(timezone.utc) + timedelta(seconds=10)
    clock = {'at': base}
    for module in (service, handover_service, quality_service):
        monkeypatch.setattr(module, 'now', lambda: clock['at'].isoformat())
    action(api, task['id'], 'check', {**check_body(current, source),
           'valid_until': (base + timedelta(minutes=1)).isoformat()})
    handover = client.post('/api/v1/handovers', headers=headers(), json={
        'source_shift_id': source_shift['id'], 'target_shift_id': target_shift['id']}).json()
    before = store.read()
    class SlowProvider(MockAIProvider):
        def summarize(self, sources):
            output = super().summarize(sources)
            clock['at'] = base + timedelta(minutes=1)
            return output
        def quality(self, sources):
            output = super().quality(sources)
            clock['at'] = base + timedelta(minutes=1)
            return output
    if kind == 'summary':
        monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: SlowProvider())
        result = client.post(f'/api/v1/handovers/{handover["id"]}/ai-summary', headers=headers(), json={'expected_revision': 1})
        assert result.status_code == 409 and result.json()['detail'] == 'handover_needs_refresh'
    else:
        monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: SlowProvider())
        result = client.post('/api/v1/quality/checks', headers=headers('manager'), json={'elder_id': 'E1', 'include_ai': True})
        assert result.status_code == 409 and result.json()['detail'] == 'quality_sources_changed_retry_scan'
    for collection in ('handovers', 'quality_checks', 'care_tasks', 'audit_logs'):
        assert store.read()[collection] == before[collection]
