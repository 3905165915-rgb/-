from datetime import datetime, timedelta, timezone

from test_incidents import report


def dashboard(api, **changes):
    client, _, headers = api
    today = datetime.now(timezone(timedelta(hours=8))).date()
    params = {'start': (today - timedelta(days=2)).isoformat(), 'end': (today + timedelta(days=2)).isoformat(), **changes}
    response = client.get('/api/v1/reports/dashboard', params=params, headers=headers('manager'))
    assert response.status_code == 200, response.text
    return response.json()


def test_chart_values_match_embedded_details_future_excluded_and_reissues_deduplicated(api):
    instant = datetime.now(timezone.utc)
    def seed(data):
        data['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'active'})
        def task(task_id, elder='E1', status='pending', occurrence=None, scheduled=None, **extra):
            return {'id': task_id, 'elder_id': elder, 'status': status, 'title': '饮水提醒',
                    'created_at': instant.isoformat(), 'due_at': (instant - timedelta(minutes=1)).isoformat(),
                    'occurrence_key': occurrence, 'scheduled_at': scheduled, **extra}
        data['care_tasks'] = [
            task('old', status='cancelled', occurrence='once', scheduled=(instant - timedelta(hours=1)).isoformat()),
            task('new', status='completed', occurrence='once', scheduled=(instant - timedelta(hours=1)).isoformat(),
                 replaces_task_id='old', completed_at=(instant - timedelta(minutes=5)).isoformat()),
            task('future', occurrence='next', scheduled=(instant + timedelta(hours=2)).isoformat()),
            task('manual', elder='E2'),
        ]
    api[1].mutate(seed)
    result = dashboard(api)
    assert {r['id'] for r in result['details']['tasks']['items']} == {'new', 'future', 'manual'}
    assert sum(r['completion']['denominator'] for r in result['task_trend']) == 1
    assert sum(r['completion']['numerator'] for r in result['task_trend']) == 1
    assert result['excluded']['future_trend_task_rows'] == 1
    for name, detail in result['details'].items():
        assert detail['count'] == len(detail['items'])
        assert sum(g['count'] for g in result['distributions'][name]) == detail['count']
        assert {i for g in result['distributions'][name] for i in g['ids']} == {r['id'] for r in detail['items']}
    assert all(card['count'] == len(card['items']) for card in result['cards'].values())
    filtered = dashboard(api, elder_id='E2')
    assert {r['id'] for r in filtered['details']['tasks']['items']} == {'manual'}
    assert all(row['completion']['ratio'] is None for row in filtered['task_trend'])


def test_dashboard_management_only_and_safety_classification_is_manual(api):
    _, _, _, incident = report(api)
    result = dashboard(api)
    assert result['cards']['untriaged_incidents']['count'] == 1
    assert result['distributions']['incident_categories'] == [{'key': 'unclassified', 'count': 1, 'ids': [incident['id']]}]
    client, _, headers = api
    params = {'start': '2026-01-01', 'end': '2026-01-02'}
    for actor in ('staff', 'family'):
        assert client.get('/api/v1/reports/dashboard', params=params, headers=headers(actor)).status_code == 403
    params['end'] = params['start']
    assert client.get('/api/v1/reports/dashboard', params=params, headers=headers('manager')).status_code == 422


def test_previous_period_and_pending_queue_use_same_snapshot_without_risk_scores(api, monkeypatch):
    from app.services import dashboard_service
    from datetime import date
    instant = datetime(2026, 10, 25, 8, tzinfo=timezone.utc)
    monkeypatch.setattr(dashboard_service, 'now', lambda: instant.isoformat())
    def seed(data):
        data['care_tasks'] = [
            {'id': 'current', 'elder_id': 'E1', 'title': '当前待办', 'status': 'pending',
             'due_at': '2026-10-25T09:00:00Z', 'created_at': instant.isoformat()},
            {'id': 'past', 'elder_id': 'E1', 'title': '上一窗口待办', 'status': 'pending',
             'due_at': '2026-10-24T09:00:00Z', 'created_at': instant.isoformat()}]
        data['incidents'] = [{'id': 'untriaged', 'elder_id': 'E1', 'status': 'reported',
                             'occurred_at': instant.isoformat()}]
    api[1].mutate(seed)
    calls = []
    read = api[1].read
    monkeypatch.setattr(api[1], 'read', lambda: calls.append(True) or read())
    result = dashboard_service.dashboard(api[1], date(2026, 10, 25), date(2026, 10, 26), 'manager', 'supervisor')
    assert calls == [True]
    card = result['cards']['pending_tasks']
    assert card['count'] == card['previous_count'] == 1 and card['change'] == 0
    assert result['cards']['untriaged_incidents']['change_ratio'] is None
    assert result['comparison']['cards']['pending_tasks']['items'][0]['id'] == 'past'
    queue = result['pending_work']
    assert queue['count'] == 2 and queue['items'][0]['id'] == 'untriaged'
    assert queue['items'][0]['priority_reason'] == '事件尚未人工分级，优先核实'
    assert all('risk_score' not in row for row in queue['items'])
