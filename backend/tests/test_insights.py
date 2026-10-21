from datetime import date
import copy

from app.services import insight_service
from app.services.workflow import audit

ROOT = '/api/v1'


def prepared(api):
    client, store, headers = api
    def seed(data):
        data['care_plans'] = [{'id': 'P1', 'elder_id': 'E1', 'revision': 1, 'series_id': 'series',
             'status': 'active', 'starts_on': '2026-10-20', 'ends_on': '2026-10-21',
             'items': [{'key': 'food', 'title': '饮食观察', 'instruction': '记录实际食量', 'times': ['12:00'],
                        'weekdays': list(range(1, 8)), 'every_n_days': 1}]}]
        data['care_tasks'] = [{'id': 'T1', 'elder_id': 'E1', 'revision': 1, 'title': '饮食观察',
             'status': 'pending', 'occurrence_key': 'series/food/2026-10-20/12:00', 'service_date': '2026-10-20',
             'scheduled_at': '2026-10-20T12:00:00+08:00', 'source_plan_id': 'P1', 'source_plan_revision': 1,
             'source_plan_snapshot': {'item': {'instruction': '记录实际食量'}}}]
        audit(data, 'created_test_record', 'R1', 'manager', elder_id='E1')
    store.mutate(seed)
    return client, store, headers


def test_coverage_missing_record_is_not_service_failure_and_reads_do_not_write(api):
    client, store, headers = prepared(api)
    before = store.read()
    response = client.get(ROOT + '/insights/coverage?elder_id=E1&service_date=2026-10-20', headers=headers('manager'))
    assert response.status_code == 200
    row = response.json()['items'][0]
    assert row['coverage_status'] == 'missing_record'
    assert '缺记录不等于未服务' in response.json()['notice']
    assert store.read() == before


def test_coverage_notes_are_versioned_and_new_results_invalidate_old_na_decision(api):
    client, store, headers = prepared(api)
    path = ROOT + '/insights/coverage?elder_id=E1&service_date=2026-10-20'
    row = client.get(path, headers=headers('manager')).json()['items'][0]
    body = {'elder_id':'E1', 'service_date':'2026-10-20', 'occurrence_key':row['occurrence_key'],
            'expected_fingerprint':row['fingerprint'], 'decision':'not_applicable', 'note':'虚构：当天外出，人工说明'}
    result = client.post(ROOT+'/insights/coverage/reviews', json=body, headers=headers('manager'))
    assert result.status_code == 200 and result.json()['items'][0]['coverage_status'] == 'not_applicable'
    log_count = len(store.read()['audit_logs'])
    client.post(ROOT+'/insights/coverage/reviews', json=body, headers=headers('manager'))
    assert len(store.read()['audit_logs']) == log_count
    def complete(data):
        data['care_tasks'][0].update(status='completed', result='虚构：已登记实际进食', revision=2)
    store.mutate(complete)
    current = client.get(path, headers=headers('manager')).json()['items'][0]
    assert current['coverage_status'] == 'covered'
    assert not current['human_reviews'][0]['current']
    assert client.post(ROOT+'/insights/coverage/reviews', json=body, headers=headers('manager')).status_code == 409


def test_coverage_new_decision_is_not_deduplicated_against_older_personal_decision(api):
    client, store, headers = prepared(api)
    store.mutate(lambda data: data['users'].append({**data['users'][2], 'id': 'manager2', 'username': 'manager2'}))
    url = ROOT + '/insights/coverage?elder_id=E1&service_date=2026-10-20'
    row = client.get(url, headers=headers('manager')).json()['items'][0]
    body = {'elder_id': 'E1', 'service_date': '2026-10-20', 'occurrence_key': row['occurrence_key'],
            'expected_fingerprint': row['fingerprint'], 'decision': 'not_applicable', 'note': '虚构：已确认本人外出'}
    endpoint = ROOT + '/insights/coverage/reviews'
    assert client.post(endpoint, json=body, headers=headers('manager')).json()['items'][0]['coverage_status'] == 'not_applicable'
    reopened = client.post(endpoint, json={**body, 'decision': 'reopen_review', 'note': '另一人要求重新核对'}, headers=headers('manager2'))
    assert reopened.json()['items'][0]['coverage_status'] == 'missing_record'
    reapplied = client.post(endpoint, json=body, headers=headers('manager'))
    assert reapplied.json()['items'][0]['coverage_status'] == 'not_applicable'
    assert len(reapplied.json()['items'][0]['human_reviews']) == 3
    retried = client.post(endpoint, json=body, headers=headers('manager'))
    assert len(retried.json()['items'][0]['human_reviews']) == 3


def test_plan_occurrences_not_generated_and_reissue_deduplication(api):
    _, store, _ = prepared(api)
    def seed(data):
        original = data['care_tasks'][0]
        original['status'] = 'cancelled'
        replacement = {**original, 'id':'T2', 'status':'completed', 'result':'已登记', 'replaces_task_id':'T1'}
        data['care_tasks'].append(replacement)
    store.mutate(seed)
    result = insight_service.coverage(store, 'E1', date(2026,10,20), 'manager', 'supervisor')
    assert len(result['items']) == 1 and result['items'][0]['current_task_id'] == 'T2'
    assert result['items'][0]['coverage_status'] == 'covered'
    tomorrow = insight_service.coverage(store, 'E1', date(2026,10,21), 'manager', 'supervisor')
    assert len(tomorrow['items']) == 1 and tomorrow['items'][0]['current_task_id'] is None


def test_change_acknowledgement_is_personal_and_never_hides_unresolved_tasks(api):
    client, store, headers = prepared(api)
    route = ROOT+'/insights/changes?since=2020-01-01T00:00:00Z'
    first = client.get(route, headers=headers('manager')).json()
    ids = [row['id'] for row in first['events']]
    assert client.post(ROOT+'/insights/changes/acknowledge', json={'event_ids':ids}, headers=headers('manager')).status_code == 200
    second = client.get(route, headers=headers('manager')).json()
    assert all(row['acknowledged'] for row in second['events'])
    assert second['unresolved_tasks'][0]['id'] == 'T1'
    store.mutate(lambda data: data['users'].append({**data['users'][2], 'id':'manager2', 'username':'manager2'}))
    third = client.get(route, headers=headers('manager2')).json()
    assert all(not row['acknowledged'] for row in third['events'])
    assert client.post(ROOT+'/insights/changes/acknowledge', json={'event_ids':['not-found']}, headers=headers('manager')).status_code == 404


def test_plan_impact_preserves_completed_snapshots_and_never_mutates_tasks(api):
    client, store, headers = prepared(api)
    def seed(data):
        parent = data['care_plans'][0]
        newer = copy.deepcopy(parent)
        newer.update(id='P2', status='draft', supersedes_id='P1')
        newer['items'][0]['instruction'] = '增加水量记录'
        data['care_plans'].append(newer)
        data['care_tasks'][0].update(status='completed', result='原要求已完成')
        data['care_tasks'].append({**data['care_tasks'][0], 'id':'T2', 'status':'pending',
                                   'scheduled_at':'2099-01-01T12:00:00+08:00', 'shift_id':'S2'})
    store.mutate(seed)
    before = store.read()
    result = client.get(ROOT+'/care-plans/P2/impact', headers=headers('manager'))
    assert result.status_code == 200
    body = result.json()
    assert len(body['differences']) == 1
    assert body['historical_completed_task_ids'] == ['T1']
    assert [row['id'] for row in body['future_tasks_requiring_human_review']] == ['T2']
    assert body['affected_shift_ids'] == ['S2']
    assert store.read() == before


def test_insights_denies_unauthorized_and_rejects_future_change_cursor(api):
    client, _, headers = prepared(api)
    for role in ['family', 'staff']:
        assert client.get(ROOT+'/insights/changes',headers=headers(role)).status_code == 403
        assert client.get(ROOT+'/insights/coverage?elder_id=E1&service_date=2026-10-20',headers=headers(role)).status_code == 403
        assert client.get(ROOT+'/care-plans/P1/impact',headers=headers(role)).status_code == 403
    assert client.get(ROOT+'/insights/changes?since=2099-01-01T00:00:00Z',headers=headers('manager')).status_code == 422


def test_record_links_are_actual_sources_and_do_not_claim_completion(api):
    client, store, headers = prepared(api)
    def seed(data):
        data['care_records'] = [
            {'id': 'R1', 'elder_id': 'E1', 'revision': 2, 'observations': ['虚构：午餐吃了一半'],
             'happened_at': '2026-10-20T12:00:00+08:00'},
            {'id': 'R2', 'elder_id': 'E1', 'revision': 1, 'observations': ['虚构：晚餐记录'],
             'happened_at': '2026-10-21T00:01:00+08:00'},
        ]
        data['care_tasks'][0]['source_record_id'] = 'R1'
    store.mutate(seed)
    response = client.get(ROOT + '/insights/coverage?elder_id=E1&service_date=2026-10-20', headers=headers('manager'))
    body = response.json()
    assert response.status_code == 200
    assert [r['record_id'] for r in body['record_task_links']] == ['R1']
    assert body['record_task_links'][0]['revision'] == 2
    assert body['record_task_links'][0]['linked_tasks'][0]['id'] == 'T1'
    assert body['items'][0]['coverage_status'] == 'partial'
    assert body['items'][0]['evidence'][0]['link_type'] == 'task_creation_source_not_completion_proof'


def test_plan_impact_includes_older_series_tasks_but_excludes_other_plans(api):
    client, store, headers = prepared(api)
    def seed(data):
        parent = data['care_plans'][0]
        parent['title'] = '原计划'
        newer = copy.deepcopy(parent)
        newer.update(id='P2', status='active', supersedes_id='P1')
        newest = copy.deepcopy(newer)
        newest.update(id='P3', status='draft', supersedes_id='P2', title='最新计划', ends_on='2026-11-01')
        other = copy.deepcopy(parent)
        other.update(id='P4', series_id='other-series')
        data['care_plans'].extend([newer, newest, other])
        data['care_tasks'][0]['scheduled_at'] = '2099-01-01T12:00:00+08:00'
        data['care_tasks'].append({**data['care_tasks'][0], 'id': 'T-other', 'source_plan_id': 'P4'})
    store.mutate(seed)
    result = client.get(ROOT + '/care-plans/P3/impact', headers=headers('manager'))
    body = result.json()
    assert result.status_code == 200
    assert [r['id'] for r in body['future_tasks_requiring_human_review']] == ['T1']
    assert body['plan_scope_diff']['before']['title'] == '原计划'
    assert body['plan_scope_diff']['after']['ends_on'] == '2026-11-01'
