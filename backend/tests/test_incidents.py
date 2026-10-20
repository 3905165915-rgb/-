from concurrent.futures import ThreadPoolExecutor

import pytest

from app.schemas.incident import IncidentCreate
from app.services import incident_service
from test_facility import ROOT, legacy, post, patch, action, admit
from test_family import instant, get

QUOTE = '发现老人房间地面有积水，已陪同老人离开并通知清洁人员。'


def report(api):
    state = legacy(api)
    rec = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': QUOTE}, actor='staff')['record']
    body = {'elder_id': 'E1', 'admission_id': state['admission']['id'], 'occurred_at': instant(),
            'description': '疑似服务风险，需主管核实', 'immediate_action': '已陪同老人离开湿滑区域',
            'evidence': [{'record_id': rec['id'], 'revision': 1, 'quote': '地面有积水'}]}
    item = post(api, '/incidents', body, actor='staff', key='report')
    return state, rec, body, item


def triage(api, item, evidence, **changes):
    body = {'expected_revision': item['revision'], 'category': 'service_omission', 'severity': 'low',
            'classification_basis': '演示分级，仅主管判断', 'assigned_to': 'staff', 'due_at': instant(1),
            'corrective_plan': '清理积水并检查同层环境', 'evidence': evidence, 'reason': '现场核对后安排整改'}
    body.update(changes)
    return post(api, f'/incidents/{item["id"]}/triage', body, expected=200)


def submit(api, item, evidence, actor='staff', expected=200, key=None):
    rect = item['rectification']
    return post(api, f'/rectifications/{rect["id"]}/submit', {'expected_revision': rect['revision'],
        'expected_incident_revision': item['revision'], 'result': '已完成现场核对和清理，提交主管复查',
        'evidence': evidence}, actor=actor, expected=expected, key=key)


def review(api, item, decision='accept', expected=200, actor='manager'):
    return post(api, f'/rectifications/{item["rectification"]["id"]}/review',
        {'expected_revision': item['rectification']['revision'], 'expected_incident_revision': item['revision'],
         'decision': decision, 'note': '主管现场复查并核对证据'}, expected=expected, actor=actor)


def prepared(api):
    state, rec, body, item = report(api)
    return state, rec, body, triage(api, item, body['evidence'])


def test_complete_incident_return_resubmit_close_and_reopen(api):
    _, rec, body, item = prepared(api)
    assert item['status'] == 'rectifying'
    submitted = submit(api, item, body['evidence'], key='submit')
    assert submit(api, item, body['evidence'], key='submit') == submitted
    returned = review(api, submitted, 'return')
    assert returned['rectification']['status'] == 'assigned' and returned['status'] == 'rectifying'
    again = submit(api, returned, body['evidence'])
    closed = review(api, again)
    assert closed['status'] == 'closed' and closed['rectification']['status'] == 'closed'
    assert len(closed['rectification']['submissions']) == 2
    assert len(closed['rectification']['reviews']) == 2
    reopened = post(api, f'/incidents/{closed["id"]}/reopen', {'expected_revision': closed['revision'],
        'expected_rectification_revision': closed['rectification']['revision'], 'assigned_to': 'other',
        'due_at': instant(2), 'reason': '发现需要继续检查'}, expected=200)
    assert reopened['status'] == 'rectifying' and reopened['rectification']['assigned_to'] == 'other'
    assert len(reopened['rectification']['reviews']) == 2


def test_independent_review_is_required_even_for_management(api):
    _, _, body, item = prepared(api)
    reassigned = post(api, f'/rectifications/{item["rectification"]["id"]}/assign',
        {'expected_revision': 1, 'assigned_to': 'manager', 'due_at': instant(1), 'reason': '主管本人处理'}, expected=200)
    submitted = submit(api, reassigned, body['evidence'], actor='manager')
    review(api, submitted, expected=403)


def test_source_correction_requires_retriage_and_keeps_history(api):
    _, rec, body, item = prepared(api)
    submitted = submit(api, item, body['evidence'])
    old = submitted['rectification']['submissions'][0]
    post(api, f'/records/{rec["id"]}/corrections', {'expected_revision': 1, 'observations': ['更正：实际是水杯外壁有水，地面干燥'],
         'reason': '现场复查更正'}, actor='staff', expected=200)
    review(api, submitted, expected=409)
    current = get(api, f'/incidents/{item["id"]}', 'manager')
    assert not current['evidence_current'] and not current['rectification']['submission_current']
    submit(api, current, body['evidence'], expected=409)
    revised = triage(api, current, [{'record_id': rec['id'], 'revision': 2, 'quote': '地面干燥'}])
    assert revised['rectification']['submissions'][0] == old
    new = submit(api, revised, [{'record_id': rec['id'], 'revision': 2, 'quote': '地面干燥'}])
    assert review(api, new)['status'] == 'closed'


@pytest.mark.parametrize('actor', ['other', 'family'])
def test_incident_privacy_and_responsibility(api, actor):
    _, _, body, item = prepared(api)
    get(api, f'/incidents/{item["id"]}', actor, 403)
    submit(api, item, body['evidence'], actor=actor, expected=403)
    if actor == 'other':
        assert get(api, '/incidents', actor) == []


def test_disable_requires_rectification_reassignment(api):
    _, _, _, item = prepared(api)
    patch(api, '/staff/staff', {'expected_revision': 1, 'active': False, 'reason': '尝试停用'}, expected=409)
    work = get(api, '/staff/staff/workload', 'manager')
    assert work['rectification_ids'] == [item['rectification']['id']]
    post(api, f'/rectifications/{item["rectification"]["id"]}/assign',
        {'expected_revision': 1, 'assigned_to': 'other', 'due_at': instant(1), 'reason': '先完成责任交接'}, expected=200)
    assert patch(api, '/staff/staff', {'expected_revision': 1, 'active': False, 'reason': '已交接责任'})['active'] is False


def test_discharge_keeps_rectification_and_readmission_evidence_rejected(api):
    state, _, body, item = prepared(api)
    closed = action(api, state, 'discharge')
    admit(api, closed['elder'], closed['bed'])
    later = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': QUOTE}, actor='staff')['record']
    submit(api, item, [{'record_id': later['id'], 'revision': 1, 'quote': '地面有积水'}], expected=422)
    # Original stay's current evidence may still be used to review its old duty.
    assert review(api, submit(api, item, body['evidence']))['status'] == 'closed'


def test_concurrent_reporting_deduplicates_and_rolls_back(api, monkeypatch):
    _, store, _ = api
    _, _, body, item = report(api)
    payload = IncidentCreate(**body)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: incident_service.create(store, payload, 'staff', 'caregiver', 'report'), range(2)))
    assert results[0]['id'] == results[1]['id'] == item['id']
    assert len(store.read()['incidents']) == 1
    before = store.path.read_bytes()
    def fail(*args, **kwargs):
        raise RuntimeError('audit unavailable')
    monkeypatch.setattr(incident_service, 'audit', fail)
    with pytest.raises(RuntimeError):
        incident_service.create(store, payload, 'staff', 'caregiver', 'rollback')
    assert store.path.read_bytes() == before


def test_future_incident_forged_quote_and_severity_rejected(api):
    _, _, body, item = report(api)
    post(api, '/incidents', {**body, 'occurred_at': instant(1)}, actor='staff', expected=422)
    post(api, '/incidents', {**body, 'severity': 'high'}, actor='staff', expected=422)
    post(api, '/incidents', {**body, 'evidence': [{**body['evidence'][0], 'quote': '伪造引文'}]}, actor='staff', expected=422)
    assert item['status'] == 'reported' and 'severity' not in item
