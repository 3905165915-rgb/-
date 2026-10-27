from app.services.presentation_service import task_context


def test_history_uses_snapshot_and_current_assignee():
    data = {'elders': [{'id': 'e', 'name': '王爷爷', 'bed_id': 'new'}],
            'beds': [{'id': 'new', 'room': '202', 'label': '2床'}],
            'users': [{'id': 'u', 'display_name': '小王'}],
            'shifts': [{'id': 's', 'name': '午班'}], 'admissions': []}
    task = {'id': 't', 'elder_id': 'e', 'assigned_to': 'u', 'shift_id': 's', 'status': 'completed',
            'display_snapshot': {'elder_name': '王爷爷', 'bed_label': '101房·1床'}}
    view = task_context(data, task, 'u', 'caregiver')
    assert view['bed_label'] == '101房·1床'
    assert view['assignee_name'] == '小王'
    assert view['shift_name'] == '午班'
    assert not view['allowed_actions']
    assert 'assignee_name' not in task


def test_broken_history_never_guesses_current_bed():
    data = {'elders': [], 'beds': [], 'users': [], 'shifts': [], 'admissions': []}
    view = task_context(data, {'id': 't', 'elder_id': 'deleted', 'status': 'pending'}, 'other', 'caregiver')
    assert view['elder_name'] == view['bed_label'] == ''


def test_historical_bed_stay_labels_survive_removed_bed_catalog():
    data={'elders':[{'id':'e','name':'王爷爷','bed_id':'new'}],'beds':[], 'users':[], 'shifts':[],
        'admissions':[{'id':'a','bed_stays':[{'bed_id':'removed','room':'101','label':'1床',
            'started_at':'2026-10-01T00:00:00+08:00','ended_at':'2026-10-20T00:00:00+08:00'}]}]}
    view=task_context(data,{'id':'t','elder_id':'e','admission_id':'a','status':'completed',
        'scheduled_at':'2026-10-10T15:00:00+08:00'})
    assert view['bed_label']=='101房·1床'


def test_terminal_task_can_keep_original_staff_and_shift_names():
    data={'elders':[], 'beds':[], 'users':[], 'shifts':[], 'admissions':[],
        'task_display_snapshots':{'t':{'elder_name':'王爷爷','bed_label':'101房·1床',
            'assigned_to':'u','assignee_name':'小王','shift_id':'s','shift_name':'午班'}}}
    view=task_context(data,{'id':'t','elder_id':'e','assigned_to':'u','shift_id':'s','status':'completed'})
    assert (view['assignee_name'],view['shift_name'])==('小王','午班')
