import pytest


def draft(api):
    client, _, headers = api
    result = client.post('/api/v1/records/extract', headers=headers(), json={
        'elder_id': 'E1', 'text': '午餐吃了一半，请联系家属。',
    })
    assert result.status_code == 200, result.text
    return result.json()


def test_edits_preserve_original_and_audit_diff_without_formal_writes(api):
    client, store, headers = api
    original = draft(api)
    url = f'/api/v1/records/drafts/{original["id"]}'
    body = {'expected_revision': 1, 'observations': ['人工核对后进食约一半'],
            'task_candidates': [], 'reason': '核对本人实际表达'}
    auth = {**headers(), 'Idempotency-Key': 'draft-edit'}
    result = client.patch(url, json=body, headers=auth)
    assert result.status_code == 200, result.text
    changed = result.json()
    assert changed['revision'] == 2 and changed['raw_text'] == original['raw_text']
    assert changed['status'] == 'pending_review' and not store.read()['care_records']
    assert client.patch(url, json=body, headers=auth).json() == changed
    assert client.patch(url, json={**body, 'reason': '另一编辑'}, headers=auth).status_code == 409
    assert client.patch(url, json=body, headers=headers()).status_code == 409
    audit = next(row for row in store.read()['audit_logs'] if row['action'] == 'edit_ai_draft')
    assert audit['before']['observations'] == original['observations']
    assert audit['after']['observations'] == body['observations'] and audit['actor_role'] == 'caregiver'
    confirm_url = f'/api/v1/records/{original["id"]}/confirm'
    assert client.post(confirm_url, json={'expected_revision': 1}, headers=headers()).status_code == 409
    assert client.post(confirm_url, json={}, headers=headers()).status_code == 409
    confirmed = client.post(confirm_url, json={'expected_revision': 2}, headers=headers())
    assert confirmed.status_code == 200 and confirmed.json()['tasks'] == []
    assert confirmed.json()['record']['observations'] == body['observations']
    assert client.post(confirm_url, json={'expected_revision': 2}, headers=headers()).json() == confirmed.json()
    assert client.patch(url, json={**body, 'expected_revision': 3}, headers=headers()).status_code == 409


@pytest.mark.parametrize('author', ['other', 'family'])
def test_other_users_cannot_modify_drafts(api, author):
    client, store, headers = api
    original = draft(api)
    before = store.path.read_bytes()
    response = client.patch(f'/api/v1/records/drafts/{original["id"]}', headers=headers(author), json={
        'expected_revision': 1, 'observations': ['试图修改'], 'reason': '测试权限',
    })
    assert response.status_code == 403 and store.path.read_bytes() == before


@pytest.mark.parametrize('change', [
    {}, {'observations': None}, {'observations': []}, {'raw_text': '改原文'},
    {'task_candidates': [{'title': '测试', 'assigned_to': 'family'}], 'observations': ['人工观察']},
])
def test_invalid_edits_cannot_become_formal_records(api, change):
    client, store, headers = api
    original = draft(api)
    result = client.patch(f'/api/v1/records/drafts/{original["id"]}', headers=headers(), json={
        'expected_revision': 1, 'reason': '测试', **change,
    })
    if result.status_code == 200:
        # Assignments are drafts until formal confirmation checks live permissions.
        result = client.post(f'/api/v1/records/{original["id"]}/confirm', headers=headers(),
                             json={'expected_revision': 2})
    assert result.status_code == 422, result.text
    assert not store.read()['care_records'] and not store.read()['care_tasks']


def test_final_confirm_audits_human_changes_relative_to_model_draft(api):
    client, store, headers = api
    original = draft(api)
    response = client.post(f'/api/v1/records/{original["id"]}/confirm', headers=headers(), json={
        'observations': ['人工核对的结果'], 'task_candidates': [], 'expected_revision': 1,
    })
    assert response.status_code == 200, response.text
    event = next(r for r in store.read()['audit_logs'] if r['action'] == 'confirm_ai_draft')
    assert event['before']['observations'] == original['observations']
    assert event['after']['observations'] == ['人工核对的结果']
    assert event['after']['revision'] == 2 and store.read()['ai_drafts'][0]['raw_text'] == original['raw_text']
