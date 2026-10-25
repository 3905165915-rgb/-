from datetime import date
import json

import pytest

from app.services import report_service
from test_facility import ROOT, post
from test_family import get
from test_incidents import prepared, submit, review
from test_change_reviews import affected


def metric(api, start='2026-10-18', end='2026-10-20'):
    return get(api, f'/reports/metrics?start={start}&end={end}', 'manager')


def test_report_math_boundaries_replacements_cancellations_and_empty_denominator(api, monkeypatch):
    _, store, _ = api
    monkeypatch.setattr(report_service, 'now', lambda: '2026-10-20T12:00:00+08:00')
    def seed(data):
        def task(key, **changes):
            row = {'id': key, 'elder_id': 'E1', 'occurrence_key': key,
                   'scheduled_at': '2026-10-18T09:00:00+08:00', 'due_at': '2026-10-18T10:00:00+08:00', 'status': 'pending'}
            row.update(changes)
            return row
        data['care_tasks'] = [
            task('cancelled-old', occurrence_key='reissued', status='cancelled'),
            task('replacement', occurrence_key='reissued', replaces_task_id='cancelled-old', status='completed', completed_at='2026-10-18T09:30:00+08:00'),
            task('cancelled', status='cancelled'), task('not-done', status='not_done'),
            task('at-start', scheduled_at='2026-10-17T16:00:00Z'),
            task('before-start', scheduled_at='2026-10-17T15:59:59Z'),
            task('at-end', scheduled_at='2026-10-19T16:00:00Z'),
            task('bad', scheduled_at='no-time'),
        ]
        data['handovers'] = [{'id': 'H', 'status': 'submitted', 'submitted_at': '2026-10-18T08:00:00+08:00'},
                            {'id': 'D', 'status': 'draft'}]
        data['handover_items'] = [{'id': str(i), 'handover_id': 'H', 'status': s} for i, s in enumerate(['received', 'clarifying', 'pending'])]
        data['handover_items'].append({'id': 'ignored', 'handover_id': 'D', 'status': 'received'})
    store.mutate(seed)
    result = metric(api)
    plan = result['generated_plan_occurrences']
    assert plan['completion'] == {'numerator': 1, 'denominator': 4, 'ratio': 0.25}
    assert plan['on_time_completion']['numerator'] == 1
    assert plan['cancelled'] == 1 and plan['not_done'] == 1 and plan['open_overdue'] == 2
    assert plan['invalid_schedule_rows'] == 1
    assert result['handover_receipt']['denominator'] == 3 and result['handover_receipt']['numerator'] == 1
    assert metric(api, '2026-10-10', '2026-10-11')['generated_plan_occurrences']['completion']['ratio'] is None
    assert result['window']['end_exclusive'] == '2026-10-20T00:00:00+08:00'


def test_future_schedules_not_counted_and_ambiguous_chains_refused(api, monkeypatch):
    _, store, _ = api
    monkeypatch.setattr(report_service, 'now', lambda: '2026-10-20T12:00:00+08:00')
    store.mutate(lambda data: data['care_tasks'].append({'id': 'future', 'occurrence_key': 'future',
         'scheduled_at': '2026-10-20T18:00:00+08:00', 'status': 'pending'}))
    result = metric(api, '2026-10-20', '2026-10-21')['generated_plan_occurrences']
    assert result['completion']['denominator'] == 0 and result['excluded_future_task_rows'] == 1
    def conflict(data):
        data['care_tasks'] = [{'id': str(i), 'occurrence_key': 'same', 'scheduled_at': '2026-10-18T09:00:00+08:00', 'status': 'pending'} for i in range(2)]
    store.mutate(conflict)
    get(api, '/reports/metrics?start=2026-10-18&end=2026-10-20', 'manager', 409)


@pytest.mark.parametrize('start,end', [('2026-10-20', '2026-10-20'), ('2026-10-20', '2026-10-19'), ('2024-01-01', '2026-01-01')])
def test_report_invalid_window(api, start, end):
    get(api, f'/reports/metrics?start={start}&end={end}', 'manager', 422)


def test_case_export_minimizes_data_and_requires_explicit_internal_text(api):
    _, rec, body, item = prepared(api)
    review(api, submit(api, item, body['evidence']))
    result = post(api, '/reports/elders/E1/export', {'reason': '参赛虚构案例核对'}, expected=200)
    raw = json.dumps(result, ensure_ascii=False)
    assert result['mode'] == 'pseudonymized_metadata' and result['subject'] == 'object-1'
    assert rec['id'] not in raw and rec['raw_text'] not in raw and '虚构老人' not in raw
    assert len(result['records']) == 1 and result['incidents'][0]['status'] == 'closed'
    detailed = post(api, '/reports/elders/E1/export', {'reason': '主管内部证据检查', 'include_text': True}, expected=200)
    assert detailed['records'][0]['raw_text'] == rec['raw_text']
    assert detailed['incidents'][0]['rectification']['submissions']
    assert 'password_hash' not in json.dumps(detailed) and 'contact_phone' not in json.dumps(detailed)
    _, store, _ = api
    assert len([r for r in store.read()['audit_logs'] if r['action'] == 'export_case']) == 2
    for actor in ('staff', 'family'):
        post(api, '/reports/elders/E1/export', {'reason': '越权尝试'}, actor=actor, expected=403)
    post(api, '/reports/elders/no-such/export', {'reason': '不存在'}, expected=404)


def test_incident_and_family_timelines_cannot_bypass_privacy(api):
    _, _, _, item = prepared(api)
    other = get(api, '/items/E1/timeline', 'other')
    assert not any(r['source_id'] == item['id'] for r in other)
    mine = get(api, '/items/E1/timeline', 'staff')
    assert any(r['source_id'] == item['id'] for r in mine)
    get(api, f'/items/{item["rectification"]["id"]}/timeline', 'other', 403)
    get(api, f'/items/{item["rectification"]["id"]}/timeline', 'manager')


def test_export_preserves_evidence_chain_without_other_elders_in_same_handover(api, affected):
    from test_handovers import shifts
    first, second = shifts(api)
    _, store, _ = api
    store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '其他老人', 'status': 'active'}))
    from scope_fixtures import grant
    grant(api, 'E2')
    for elder_id, text in [('E1', '本老人交班事项'), ('E2', '其他老人私密信息禁止导出')]:
        post(api, '/records/manual', {'elder_id': elder_id, 'shift_id': first['id'], 'raw_text': text,
            'task_candidates': [{'title': text}]}, actor='staff')
    handover = post(api, '/handovers', {'source_shift_id': first['id'], 'target_shift_id': second['id']}, actor='staff')
    store.mutate(lambda data: next(r for r in data['handovers'] if r['id'] == handover['id']).update(summary='其他老人私密信息禁止导出'))
    detailed = post(api, '/reports/elders/E1/export', {'reason': '检查证据链和单老人范围', 'include_text': True}, expected=200)
    assert '其他老人私密信息禁止导出' not in json.dumps(detailed, ensure_ascii=False)
    assert detailed['change_reviews'][0]['initial_snapshot']
    assert any(r.get('memory_references') for r in detailed['tasks'])
    assert len(detailed['handovers'][0]['items']) == 2
    safe = post(api, '/reports/elders/E1/export', {'reason': '最少字段导出'}, expected=200)
    assert affected['source']['id'] not in json.dumps(safe)
    assert all('detail' not in r for r in safe['handovers'][0]['items'])
    assert 'initial_snapshot' not in safe['change_reviews'][0]
