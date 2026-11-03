"""Product contracts exercised with isolated, synthetic workflow data."""
from test_facility import post, legacy


def test_01_task_primary_action_survives_response_model(api, manual_payload):
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    client, store, headers = api
    before = store.path.read_bytes()
    body = client.get('/api/v1/tasks/' + task['id'], headers=headers()).json()
    assert body['workflow']['state_label'] == '待执行'
    assert body['workflow']['primary_action']['code'] == 'start'
    assert body['workflow']['primary_action']['path'] == '/tasks/' + task['id'] + '/transition'
    assert store.path.read_bytes() == before


def test_13_cross_timezone_shift_roundtrip_keeps_business_date(api):
    from datetime import datetime
    body = {'name': '跨设备时区班次', 'start_at': '2027-01-01T15:00:00-05:00',
            'end_at': '2027-01-01T23:00:00-05:00', 'caregiver_ids': ['staff']}
    created = post(api, '/shifts', body)
    client, _, headers = api
    saved = client.get('/api/v1/shifts/' + created['id'], headers=headers()).json()
    assert datetime.fromisoformat(saved['start_at']).timestamp() == datetime.fromisoformat(body['start_at']).timestamp()
    assert '2027-01-02 04:00' in saved['display_label'] and '12:00' in saved['display_label']
    assert saved['timezone'] == 'Asia/Shanghai'


def test_13_business_day_bounds_equal_utc_instants():
    from datetime import date, datetime, timezone
    from app.services.report_service import bounds
    from app.services.plan_service import local_date
    lower, upper = bounds(date(2027, 1, 2), date(2027, 1, 3))
    assert lower == datetime(2027, 1, 1, 16, tzinfo=timezone.utc)
    assert upper == datetime(2027, 1, 2, 16, tzinfo=timezone.utc)
    assert local_date('2027-01-01T16:00:00Z') == date(2027, 1, 2)


def test_13_record_fact_time_must_not_be_future(api, manual_payload):
    from datetime import datetime, timedelta, timezone
    before = len(api[1].read()['care_records'])
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    result = post(api, '/records/manual', {**manual_payload, 'happened_at': future}, actor='staff', expected=422)
    assert result['error_code'] == 'record_happened_at_in_future'
    assert len(api[1].read()['care_records']) == before


def test_01_reported_incident_and_followup_share_primary_action(api):
    from test_family import instant
    stay = legacy(api)
    incident = post(api, '/incidents', {'elder_id': 'E1', 'admission_id': stay['admission']['id'],
        'occurred_at': instant(), 'description': '走廊地面有水', 'immediate_action': '已设置提示并通知现场人员'}, actor='staff')
    client, store, headers = api
    before = store.path.read_bytes()
    detail = client.get('/api/v1/incidents/' + incident['id'], headers=headers('manager')).json()
    cards = client.get('/api/v1/followups', headers=headers('manager')).json()['items']
    card = next(row for row in cards if row['object_id'] == incident['id'])
    assert card['workflow'] == detail['workflow']
    assert card['workflow']['primary_action']['code'] == 'triage'
    assert card['workflow']['responsibility']['roles'] == ['admin', 'supervisor']
    assert store.path.read_bytes() == before


def test_01_change_assignment_explains_actual_responsibility():
    from app.services.workflow_context_service import change_workflow
    workflow = change_workflow({'id': 'case', 'status': 'assigned', 'assigned_to': 'worker'}, 'worker', 'caregiver')
    assert workflow['primary_action']['path'] == '/change-reviews/case/submit'
    assert workflow['responsibility']['assigned_to'] == 'worker'
    assert 'caregiver' in workflow['responsibility']['roles']


def test_02_inbox_merges_notice_and_business_and_read_stays_pending(api):
    from test_incidents import report
    _, _, _, incident = report(api)
    client, store, headers = api
    response = client.get('/api/v1/work-inbox?limit=1', headers=headers('manager'))
    assert response.status_code == 200, response.text
    inbox = response.json()
    assert inbox['total'] == 1 and sum(inbox['counts'].values()) == 1
    item = inbox['items'][0]
    assert item['object_id'] == incident['id'] and item['priority'] == 'urgent'
    assert len(item['notification_ids']) == 1 and item['queue'] == 'mine'
    notice = store.read()['notifications'][0]
    post(api, '/notifications/' + notice['id'] + '/actions',
         {'expected_revision': notice['revision'], 'action': 'read'}, expected=200)
    refreshed = client.get('/api/v1/work-inbox', headers=headers('manager')).json()
    assert refreshed['total'] == 1 and not refreshed['items'][0]['unread']
    assert store.read()['incidents'][0]['status'] == 'reported'


def test_02_inbox_pagination_counts_all_distinct_tasks(api, manual_payload):
    for title in ('询问活动意愿', '整理生活物品'):
        post(api, '/records/manual', {**manual_payload, 'task_candidates': [{'title': title}]}, actor='staff')
    client, _, headers = api
    first = client.get('/api/v1/work-inbox?limit=1', headers=headers('manager')).json()
    second = client.get('/api/v1/work-inbox?limit=1&offset=1', headers=headers('manager')).json()
    assert first['total'] == second['total'] == 2
    assert first['counts'] == second['counts']
    assert first['items'][0]['id'] != second['items'][0]['id']


def test_02_feedback_is_reply_work_not_summary_review(api):
    from app.services.workflow import audit, now
    def seed(data):
        data['family_cases'].append({'id': 'FB-synthetic', 'kind': 'feedback', 'status': 'received',
                                    'elder_id': 'E1', 'created_at': now()})
        audit(data, 'create_feedback', 'FB-synthetic', 'manager', elder_id='E1')
    api[1].mutate(seed)
    client, _, headers = api
    body = client.get('/api/v1/work-inbox', headers=headers('manager')).json()
    row = next(r for r in body['items'] if r['object_id'] == 'FB-synthetic')
    assert row['queue'] == 'mine'
    assert row['path'] == '/family/cases?elder_id=E1&kind=feedback'
    response = client.get('/api/v1' + row['path'], headers=headers('manager'))
    assert response.status_code == 200, response.text


def test_04_worklist_separates_own_tasks_and_sorts_overdue_first(api):
    from datetime import datetime, timedelta, timezone
    instant = datetime.now(timezone.utc)
    def seed(data):
        data['shifts'].append({'id': 'CURRENT', 'name': '日间班', 'status': 'open', 'caregiver_ids': ['staff', 'other'],
                              'start_at': (instant - timedelta(hours=1)).isoformat(), 'end_at': (instant + timedelta(hours=1)).isoformat()})
        data['care_tasks'] = [{'id': key, 'elder_id': 'E1', 'title': key, 'status': 'pending',
            'assigned_to': who, 'shift_id': 'CURRENT', 'updated_at': instant.isoformat(),
            'due_at': (instant + timedelta(minutes=minutes)).isoformat()}
            for key, who, minutes in [('later', 'staff', 30), ('overdue', 'staff', -5), ('colleague', 'other', 20)]]
    api[1].mutate(seed)
    client, _, headers = api
    body = client.get('/api/v1/elders/worklist/me', headers=headers()).json()
    row = body['items'][0]
    assert [task['id'] for task in row['my_tasks']] == ['overdue', 'later']
    assert body['current_shifts'][0]['id'] == 'CURRENT'
    assert set(row['current_shift_task_ids']) == {'overdue', 'later'}


def test_05_workspace_uses_current_admission_and_never_writes(api, manual_payload):
    stay = legacy(api)
    record = post(api, '/records/manual', manual_payload, actor='staff')['record']
    client, store, headers = api
    before = store.path.read_bytes()
    response = client.get('/api/v1/elders/E1/workspace', headers=headers())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['current_admission']['id'] == stay['admission']['id']
    assert body['recent_records'][0]['id'] == record['id']
    assert store.path.read_bytes() == before


def test_05_workspace_without_stay_labels_missing_context(api):
    client, _, headers = api
    response = client.get('/api/v1/elders/E1/workspace', headers=headers('manager'))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['current_admission'] is None and body['current_care_available'] is False
    assert body['tasks'] == body['plans'] == body['recent_records'] == []


def test_08_incident_workflow_follows_full_human_lifecycle(api):
    from test_incidents import report, triage, submit, review
    _, _, payload, incident = report(api)
    assigned = triage(api, incident, payload['evidence'])
    client, _, headers = api
    staff = client.get('/api/v1/incidents/' + incident['id'], headers=headers()).json()
    assert staff['workflow']['primary_action']['code'] == 'submit'
    submitted = submit(api, assigned, payload['evidence'])
    assert submitted['workflow']['primary_action'] is None
    manager = client.get('/api/v1/incidents/' + incident['id'], headers=headers('manager')).json()
    assert manager['workflow']['primary_action']['code'] == 'review'
    closed = review(api, submitted)
    assert closed['workflow']['state_label'] == '已关闭'
    assert closed['workflow']['primary_action'] is None
    assert closed['workflow']['secondary_actions'][0]['code'] == 'reopen'


def test_11_plan_generation_preview_reuses_real_rules_without_writes(api):
    from test_elder_workspace import make_plan_rule
    from app.services.plan_service import local_date
    rule, _ = make_plan_rule(api)
    client, store, headers = api
    data = store.read()
    shift = next(s for s in data['shifts'] if s['id'] == rule['shift_id'])
    payload = {'expected_revision': rule['plan_revision'], 'service_date': local_date(shift['start_at']).isoformat(),
               'assigned_to': 'staff', 'shift_id': shift['id']}
    before = store.path.read_bytes()
    preview = post(api, '/care-plans/' + rule['plan_id'] + '/generate-preview', payload, expected=200)
    assert preview['preview'] and len(preview['items']) == 1
    assert 'id' not in preview['items'][0]
    assert store.path.read_bytes() == before
    actual = post(api, '/care-plans/' + rule['plan_id'] + '/generate', payload, expected=200, key='real-plan-generation')
    assert actual['created_tasks'][0]['title'] == preview['items'][0]['title']
    again = post(api, '/care-plans/' + rule['plan_id'] + '/generate-preview', payload, expected=200)
    assert again['items'] == [] and again['existing_task_ids'] == [actual['created_tasks'][0]['id']]


def test_11_preview_retains_tasks_already_scheduled_in_other_shift(api):
    from test_elder_workspace import make_plan_rule
    from test_planning import shift
    from app.services.plan_service import local_date
    rule, _ = make_plan_rule(api)
    data = api[1].read()
    original_shift = next(s for s in data['shifts'] if s['id'] == rule['shift_id'])
    day = local_date(original_shift['start_at'])
    payload = {'expected_revision': rule['plan_revision'], 'service_date': day.isoformat(),
               'assigned_to': 'staff', 'shift_id': original_shift['id']}
    actual = post(api, '/care-plans/' + rule['plan_id'] + '/generate', payload, expected=200)
    earlier = shift(api, day, hours=12, member='other')
    preview = post(api, '/care-plans/' + rule['plan_id'] + '/generate-preview',
                   {**payload, 'shift_id': earlier['id'], 'assigned_to': 'other'}, expected=200)
    assert preview['items'] == preview['unassigned_items'] == []
    assert preview['retained_task_ids'] == [actual['created_tasks'][0]['id']]
    client, _, headers = api
    options = client.get('/api/v1/shifts', headers=headers('manager')).json()
    assert all('display_label' in s and s['timezone'] == 'Asia/Shanghai' for s in options)


def test_12_options_search_and_page_one_authorized_snapshot(api):
    def seed(data):
        data['elders'].extend([{'id': 'E2', 'name': '第二位虚构老人', 'status': 'active'},
                               {'id': 'E3', 'name': '第三位虚构老人', 'status': 'active'}])
    api[1].mutate(seed)
    client, store, headers = api
    before = store.path.read_bytes()
    mine = client.get('/api/v1/options/elders', headers=headers()).json()
    assert mine['total'] == 1 and mine['items'][0]['id'] == 'E1'
    first = client.get('/api/v1/options/elders?limit=1', headers=headers('manager')).json()
    second = client.get('/api/v1/options/elders?limit=1&offset=1', headers=headers('manager')).json()
    assert first['total'] == second['total'] == 3 and first['items'] != second['items']
    found = client.get('/api/v1/options/elders?q=第二位', headers=headers('manager')).json()
    assert found['total'] == 1 and found['items'][0]['id'] == 'E2'
    staff = client.get('/api/v1/options/staff', headers=headers()).json()
    assert all(set(r) == {'id', 'label', 'display_name', 'role'} for r in staff['items'])
    assert store.path.read_bytes() == before


def test_12_shift_options_include_next_shift_for_other_workers(api):
    from test_planning import shift
    target = shift(api, member='other')
    client, _, headers = api
    response = client.get('/api/v1/options/shifts', headers=headers())
    assert response.status_code == 200
    assert any(s['id'] == target['id'] for s in response.json()['items'])
    members = client.get('/api/v1/options/staff?shift_id=' + target['id'], headers=headers()).json()
    assert [s['id'] for s in members['items']] == ['other']


def test_14_incident_labels_identify_content_and_preserve_description(api):
    from test_incidents import report
    _, _, _, incident = report(api)
    client, store, headers = api
    detail = client.get('/api/v1/incidents/' + incident['id'], headers=headers('manager')).json()
    options = client.get('/api/v1/options/incidents', headers=headers('manager')).json()['items']
    assert options[0]['label'] == detail['display_label']
    assert options[0]['description'] == incident['description']
    assert detail['elder_name'] == '虚构老人' and detail['state_label'] == '待人工分级'
    store.mutate(lambda data: data['incidents'][0].update(description='现场观察记录' * 25 + '走廊湿滑'))
    found = client.get('/api/v1/options/incidents?q=湿滑', headers=headers('manager')).json()
    assert found['total'] == 1 and '湿滑' in found['items'][0]['description']
    store.mutate(lambda data: data['incidents'][0].update(description=''))
    missing = client.get('/api/v1/options/incidents', headers=headers('manager')).json()['items'][0]
    assert missing['label'] == '事件内容待补充' and missing['description_missing']


def test_15_timeline_groups_missing_registration_times_without_guessing(api, manual_payload):
    record = post(api, '/records/manual', manual_payload, actor='staff')['record']
    def seed(data):
        data['audit_logs'].extend([
            {'id': 'MISSING-TIME', 'object_id': record['id'], 'action': 'correct_record', 'user_id': 'staff'},
            {'id': 'NAIVE-TIME', 'object_id': record['id'], 'action': 'correct_record', 'user_id': 'staff',
             'created_at': '2026-10-01T09:00:00'}])
    api[1].mutate(seed)
    client, store, headers = api
    before = store.path.read_bytes()
    page = client.get('/api/v1/items/' + record['id'] + '/timeline?envelope=true', headers=headers()).json()
    assert page['unverified_total'] == 2
    assert page['groups']['needs_verification'] == ['MISSING-TIME', 'NAIVE-TIME']
    assert all(e['recorded_at'] is None for e in page['items'][-2:])
    assert page['items'][0]['source_kind'] == 'care_records'
    assert store.path.read_bytes() == before


def test_16_display_context_and_empty_page_are_explicit(api, manual_payload):
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    client, _, headers = api
    shown = client.get('/api/v1/tasks/' + task['id'], headers=headers()).json()
    assert shown['state_label'] == shown['workflow']['state_label'] == '待执行'
    empty = client.get('/api/v1/options/elders?q=不存在的姓名', headers=headers()).json()
    assert empty['empty_state']['code'] == 'no_matches'
    beyond = client.get('/api/v1/options/elders?offset=100', headers=headers()).json()
    assert beyond['empty_state']['code'] == 'page_out_of_range'
