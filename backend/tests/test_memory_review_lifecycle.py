from datetime import datetime, timedelta, timezone

import pytest

from app.services import memory_service, workflow
from test_memories import context, memory_payload, propose, review


def refusal_record(api, elder='E1', author='staff'):
    client, _, headers = api
    response = client.post('/api/v1/records/manual', headers=headers(author), json={
        'elder_id': elder, 'raw_text': '今天本人说不想洗澡，希望休息。',
        'observations': ['本人表示今天不想洗澡'],
    })
    assert response.status_code == 201, response.text
    return response.json()['record']


def report(api, memory, record, key=None, author='staff', **changes):
    client, _, headers = api
    auth = headers(author)
    if key:
        auth['Idempotency-Key'] = key
    return client.post(f'/api/v1/memories/{memory["id"]}/refusals', headers=auth, json={
        'record_id': record['id'], 'record_revision': record['revision'],
        'source_quote': '本人表示今天不想洗澡', 'note': '护理员核对本人本次拒绝，仅申请复核', **changes,
    })


def test_three_distinct_reports_only_trigger_review_and_keep_effective_memory(api, memory_payload):
    _, store, _ = api
    memory = review(api, propose(api, memory_payload))
    for count in range(1, 4):
        record = refusal_record(api)
        response = report(api, memory, record, key=f'report-{count}')
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['refusal_count'] == count
        assert result['effective'] and result['status'] == 'confirmed'
        assert result['content'] == memory['content'] and result['revision'] == memory['revision']
        assert report(api, memory, record, key=f'report-{count}').json() == result
        assert report(api, memory, record, key=f'retry-{count}').json()['refusal_count'] == count
    assert result['review_state'] == 'pending'
    assert result['review_reasons'] == ['repeated_refusal_reported']
    assert len(context(api)) == 1 and store.read()['care_tasks'] == []
    kept = review(api, result, 'keep')
    assert kept['effective'] and kept['review_state'] == 'not_required'
    assert kept['refusal_count'] == 0
    assert len([e for e in store.read()['audit_logs'] if e['action'] == 'report_memory_refusal']) == 3


@pytest.mark.parametrize('change,author,status', [
    ({'record_revision': 2}, 'staff', 409),
    ({'source_quote': '伪造原文'}, 'staff', 422),
    ({}, 'other', 403),
    ({}, 'family', 403),
])
def test_refusal_requires_current_evidence_and_authority(api, memory_payload, change, author, status):
    _, store, _ = api
    memory = review(api, propose(api, memory_payload))
    record = refusal_record(api)
    before = store.path.read_bytes()
    response = report(api, memory, record, author=author, **change)
    assert response.status_code == status, response.text
    assert store.path.read_bytes() == before


def test_refusal_evidence_must_belong_to_same_elder(api, memory_payload):
    _, store, _ = api
    memory = review(api, propose(api, memory_payload))
    store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '测试老人', 'status': 'active'}))
    assert report(api, memory, refusal_record(api, 'E2')).status_code == 422


def test_corrected_refusal_evidence_no_longer_counts_and_can_be_reported_at_new_revision(api, memory_payload):
    client, _, headers = api
    memory = review(api, propose(api, memory_payload))
    record = refusal_record(api)
    assert report(api, memory, record).json()['refusal_count'] == 1
    changed = client.post(f'/api/v1/records/{record["id"]}/corrections', headers=headers(), json={
        'observations': ['本人表示今天不想洗澡，已再次核实'], 'reason': '补充本人确认', 'expected_revision': 1,
    })
    assert changed.status_code == 200, changed.text
    current = client.get(f'/api/v1/memories/{memory["id"]}', headers=headers()).json()
    assert current['refusal_count'] == 0
    assert report(api, memory, changed.json()).json()['refusal_count'] == 1


def test_suspend_resume_are_explicit_versioned_actions(api, memory_payload):
    memory = review(api, propose(api, memory_payload))
    suspended = review(api, memory, 'suspend')
    assert suspended['status'] == 'suspended' and not suspended['effective'] and context(api) == []
    restored = review(api, suspended, 'resume')
    assert restored['status'] == 'confirmed' and restored['effective']
    assert restored['revision'] == memory['revision'] + 2


def test_source_correction_does_not_undo_explicit_suspension(api, memory_payload):
    client, _, headers = api
    suspended = review(api, review(api, propose(api, memory_payload)), 'suspend')
    response = client.post(f'/api/v1/records/{memory_payload["source_record_id"]}/corrections', headers=headers(), json={
        'expected_revision': 1, 'reason': '本人更正', 'observations': ['本人现在喜欢上午洗澡'],
    })
    assert response.status_code == 200, response.text
    current = client.get(f'/api/v1/memories/{suspended["id"]}', headers=headers()).json()
    assert current['status'] == 'suspended' and current['review_state'] == 'pending'
    assert not current['effective'] and context(api) == []
    assert review(api, current, 'resume', expected=409)['detail'] == 'memory_source_revision_changed'


def test_due_review_keeps_preference_effective_but_hard_expiry_blocks_resume(api, memory_payload, monkeypatch):
    instant = datetime(2099, 1, 1, tzinfo=timezone.utc)
    for module in (memory_service, workflow):
        monkeypatch.setattr(module, 'now', lambda: instant.isoformat())
    due = review(api, propose(api, {**memory_payload, 'review_due_at': (instant + timedelta(hours=1)).isoformat()}))
    temporary = review(api, propose(api, {**memory_payload, 'category': 'temporary_wish',
                                          'expires_at': (instant + timedelta(hours=1)).isoformat()}))
    suspended = review(api, temporary, 'suspend')
    instant += timedelta(hours=2)
    current = next(m for m in context(api) if m['id'] == due['id'])
    assert current['review_state'] == 'pending' and current['effective']
    kept = review(api, current, 'keep')
    assert kept['review_due'] and kept['review_state'] == 'not_required' and kept['effective']
    assert review(api, suspended, 'resume', expected=409)['detail'] == 'memory_not_confirmable'
