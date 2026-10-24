"""Record -> reviewed proposals -> atomic tasks, entirely isolated from live data."""
import pytest

from app.services import assistant_service, store_service
from app.services.ai_service import DeepSeekAIProvider
from app.services.task_proposals import explicit_due, task_proposals

ANCHOR = '2026-10-24T15:40:00Z'  # 23:40 in China, deliberately near midnight.


@pytest.mark.parametrize(('expression', 'expected'), [
    ('明天下午三点', '2026-10-25T15:00:00+08:00'),
    ('今晚八点', '2026-10-24T20:00:00+08:00'),
    ('明早九点钟', '2026-10-25T09:00:00+08:00'),
    ('明天下午 三 点 十五分', '2026-10-25T15:15:00+08:00'),
    ('明天15:30前', '2026-10-25T15:30:00+08:00'),
    ('今天23:50', '2026-10-24T23:50:00+08:00'),
    ('后天上午九点半', '2026-10-26T09:30:00+08:00'),
    ('2026年11月1日14时20分', '2026-11-01T14:20:00+08:00'),
    ('2026-11-01 08:05', '2026-11-01T08:05:00+08:00'),
    ('30分钟后', '2026-10-25T00:10:00+08:00'),
    ('2小时后', '2026-10-25T01:40:00+08:00'),
    ('明天', None), ('饭后', None), ('明天三点', None), ('下午三点', None),
    ('每天15:00', None), ('明天15:00或16:00', None),
    ('2026-02-30 15:00', None), ('明天25:00', None), ('明天15:99', None),
    ('明天晚上十二点', None), ('明天傍晚三点', None), ('今天上午十三点', None),
])
def test_explicit_due_keeps_ambiguous_expressions_unresolved(expression, expected):
    assert explicit_due(expression, ANCHOR) == expected


def people():
    return {'users': [
        {'id': 'staff', 'display_name': '小王', 'role': 'caregiver', 'active': True},
        {'id': 'other', 'display_name': '小李', 'role': 'caregiver', 'active': True},
    ], 'shifts': [{'id': 'S1', 'caregiver_ids': ['staff']}],
        'elders': [{'id': 'E1', 'name': '张阿姨'}, {'id': 'E2', 'name': '李爷爷'}]}


def proposals(rows, data=None, role='caregiver'):
    return task_proposals(rows, data or people(), elder_id='E1', shift_id='S1', user_id='staff', role=role, reference_time=ANCHOR)


def test_named_owner_and_explicit_time_are_draft_suggestions_only():
    text = '张阿姨明天下午三点由小王负责陪同散步，本人同意后再进行。'
    row = {'title': '陪同散步', 'evidence_text': text, 'due_text': '明天下午三点', 'condition': '本人同意后'}
    result = proposals([row])[0]
    assert result['assigned_to'] == 'staff'
    assert result['due_at'] == '2026-10-25T15:00:00+08:00'
    assert result['condition'] == '本人同意后'
    assert 'due_at' not in row and 'assigned_to' not in row
    assert any('前提' in note for note in result['review_notes'])


def test_missing_forbidden_duplicate_or_foreign_assignment_is_never_invented():
    for quote in ['明天再看看', '由小李负责联系家属', '由下一班负责', '由小王负责并由小李负责', '家属说：明天我负责联系女儿']:
        result = proposals([{'title': '跟进', 'evidence_text': quote, 'due_text': '明天'}])[0]
        assert not result.get('assigned_to') and not result.get('due_at')
    data = people()
    data['users'].append({'id': 'same-name', 'display_name': '小王', 'role': 'caregiver'})
    assert 'assigned_to' not in proposals([{'title': '跟进', 'evidence_text': '由小王负责'}], data)[0]
    injected = proposals([{'title': '跟进', 'due_at': ANCHOR, 'assigned_to': 'other'}])[0]
    assert not injected.get('due_at') and not injected.get('assigned_to')


def test_time_must_be_in_this_task_evidence_and_other_elder_requires_review():
    row = proposals([{'title': '陪同活动', 'evidence_text': '李爷爷想活动', 'due_text': '明天15:00'}])[0]
    assert not row.get('due_at')
    assert row['object_review_required'] is True


def test_only_literal_duplicate_proposals_are_collapsed():
    row = {'title': '回访', 'evidence_text': '明天再看看', 'due_text': '明天'}
    result = proposals([row, row.copy(), {**row, 'condition': '本人同意后'}])
    assert len(result) == 2
    assert result[1]['condition'] == '本人同意后'


@pytest.mark.parametrize('contextual', [False, True])
def test_save_record_creates_its_tasks_once_with_source_and_conditions(api, monkeypatch, contextual):
    client, store, headers = api
    def seed(data):
        data['users'][0]['display_name'] = '小王'
        data['elders'][0]['name'] = '张阿姨'
    store.mutate(seed)
    text = '今天进食正常。明天下午三点由小王负责联系家属；本人同意后，明天16:00由小王负责陪同散步。'
    output = {
        'observations': ['今天进食正常。'],
        'task_candidates': [
            {'title': '联系家属', 'evidence_text': '明天下午三点由小王负责联系家属', 'due_text': '明天下午三点'},
            {'title': '陪同散步', 'evidence_text': '本人同意后，明天16:00由小王负责陪同散步', 'due_text': '明天16:00', 'condition': '本人同意后'},
        ],
        'evidence': [{'text': '今天进食正常。', 'type': 'current_observation'}], 'warnings': [],
    }
    provider = DeepSeekAIProvider('isolated-placeholder', 'https://example.invalid', 'test', 1)
    monkeypatch.setattr(provider, '_request', lambda *args: {**output, **({'memory_candidates': [], 'context_notes': []} if contextual else {})})
    monkeypatch.setattr(assistant_service if contextual else store_service, 'get_ai_provider', lambda: provider)
    module = assistant_service if contextual else store_service
    monkeypatch.setattr(module, 'now', lambda: ANCHOR, raising=False)
    from app.services import workflow
    monkeypatch.setattr(workflow, 'now', lambda: ANCHOR)
    response = client.post('/api/v1/records/' + ('context-extract' if contextual else 'extract'), headers=headers(), json={
        'elder_id': 'E1', 'text': text, **({'scene': 'activity'} if contextual else {})})
    assert response.status_code == 200, response.text
    draft = response.json()
    assert not store.read()['care_records'] and not store.read()['care_tasks']
    assert all(row['assigned_to'] == 'staff' for row in draft['task_candidates'])
    assert draft['task_candidates'][0]['due_at'] == '2026-10-25T15:00:00+08:00'
    body = {'expected_revision': draft['revision'], 'observations': draft['observations'], 'task_candidates': draft['task_candidates']}
    url = f'/api/v1/records/{draft["id"]}/confirm'
    response = client.post(url, headers=headers(), json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result['tasks']) == 2
    for task in result['tasks']:
        assert task['source_record_id'] == result['record']['id']
        assert task['source_revision'] == result['record']['revision']
        assert task['elder_id'] == 'E1' and task['status'] == 'pending'
    assert result['tasks'][1]['condition'] == '本人同意后'
    assert client.post(url, headers=headers(), json=body).json() == result
    assert len(store.read()['care_records']) == 1 and len(store.read()['care_tasks']) == 2


def test_invalid_assignment_rolls_back_entire_record_and_tasks(api):
    client, store, headers = api
    draft = client.post('/api/v1/records/extract', headers=headers(), json={'elder_id': 'E1', 'text': '请联系家属'}).json()
    url = f'/api/v1/records/{draft["id"]}/confirm'
    response = client.post(url, headers=headers(), json={'task_candidates': [
        {'title': '联系家属', 'assigned_to': 'staff', 'due_at': '2026-10-25T15:00:00+08:00'},
        {'title': '跟进', 'assigned_to': 'other', 'due_at': '2026-10-25T16:00:00+08:00'},
    ]})
    assert response.status_code == 403
    assert not store.read()['care_tasks'] and not store.read()['care_records']
    assert store.read()['ai_drafts'][0]['status'] == 'pending_review'
    response = client.post(url, headers=headers(), json={'task_candidates': []})
    assert response.status_code == 200 and response.json()['tasks'] == []
