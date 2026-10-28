import pytest

from app.services import ai_service, quality_service
from app.services.ai_service import AIProviderError, DeepSeekAIProvider, MockAIProvider
from test_handovers import prepare


def provider():
    return DeepSeekAIProvider('fake-test-key', 'https://example.invalid', 'test-model', 1)


def extracted(text):
    return {'observations': [text], 'task_candidates': [],
            'evidence': [{'text': text, 'type': 'observation'}], 'warnings': []}


@pytest.mark.parametrize('mutation', ['bad_type', 'fabricated_quote', 'unsupported_observation', 'made_up_assignee', 'missing_evidence'])
def test_extraction_rejects_bad_shapes_and_invented_evidence(monkeypatch, mutation):
    text = '老人表示今天不想外出，若晚餐仍进食较少再联系家属。'
    output = extracted(text)
    if mutation == 'bad_type':
        output['observations'] = 'not-an-array'
    elif mutation == 'fabricated_quote':
        output['evidence'][0]['text'] = '老人今天外出'
    elif mutation == 'unsupported_observation':
        output['observations'] = ['老人必须住院']
    elif mutation == 'made_up_assignee':
        output['task_candidates'] = [{'title': '联系家属', 'evidence_text': text, 'assigned_to': 'invented'}]
    else:
        output['evidence'] = []
    instance = provider()
    monkeypatch.setattr(instance, '_request', lambda *_: output)
    with pytest.raises(AIProviderError):
        instance.extract('E1', None, text)


def test_extraction_keeps_negative_and_conditional_verbatim(monkeypatch):
    text = '老人表示今天不想外出，若晚餐仍进食较少再联系家属。'
    output = extracted(text)
    output['task_candidates'] = [{'title': '联系家属', 'evidence_text': '若晚餐仍进食较少再联系家属', 'condition': '若晚餐仍进食较少'}]
    instance = provider()
    monkeypatch.setattr(instance, '_request', lambda *_: output)
    draft = instance.extract('E1', None, text)
    assert draft.observations == [text]
    assert draft.task_candidates[0]['condition'] == '若晚餐仍进食较少'
    assert draft.status == 'pending_review'


def test_summary_is_only_saved_as_draft_then_human_confirms(api, manual_payload):
    client, store, headers = api
    _, _, record, handover = prepare(api, manual_payload)
    url = f'/api/v1/handovers/{handover["id"]}'
    result = client.post(url + '/ai-summary', json={'expected_revision': 1}, headers=headers())
    assert result.status_code == 200
    summary = result.json()['ai_summary']
    assert summary['status'] == 'pending_review' and summary['provider'] == 'mock'
    assert store.read()['handovers'][0]['status'] == 'draft'
    assert store.read()['shifts'][0]['status'] == 'open'
    assert store.read()['care_tasks'][0]['id'] == record['tasks'][0]['id']
    assert client.post(url + '/submit', json={'expected_revision': 1, 'approve_ai_summary': True}, headers=headers()).status_code == 409
    result = client.post(url + '/submit', json={'expected_revision': 2, 'approve_ai_summary': True}, headers=headers())
    assert result.status_code == 200
    assert result.json()['ai_summary']['status'] == 'confirmed'


def test_summary_discards_racing_record_correction(api, manual_payload, monkeypatch):
    client, store, headers = api
    _, _, _, handover = prepare(api, manual_payload)
    class RacingProvider(MockAIProvider):
        def summarize(self, sources):
            store.mutate(lambda data: data['care_records'][0].update(revision=2, observations=['重新核对的记录']))
            return super().summarize(sources)
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: RacingProvider())
    result = client.post(f'/api/v1/handovers/{handover["id"]}/ai-summary', json={'expected_revision': 1}, headers=headers())
    assert result.status_code == 409
    assert store.read()['handovers'][0]['ai_summary'] is None


@pytest.mark.parametrize('kind', ['summary', 'quality'])
def test_fake_source_or_quote_rejected(kind, monkeypatch):
    instance = provider()
    for citation in [{'source_id': 'fake', 'quote': '真实原文'}, {'source_id': 'R1', 'quote': '编造内容'}]:
        row = {'citations': [citation]}
        if kind == 'summary':
            row['text'] = '摘要'
            output = {'points': [row]}
        else:
            row.update(title='核对', explanation='原因')
            output = {'findings': [row]}
        monkeypatch.setattr(instance, '_request', lambda *_, value=output: value)
        with pytest.raises(AIProviderError):
            (instance.summarize if kind == 'summary' else instance.quality)([{'source_id': 'R1', 'text': '真实原文'}])


def test_rule_quality_review_changes_no_record_or_task(api, manual_payload):
    client, store, headers = api
    created = client.post('/api/v1/records/manual', json=manual_payload, headers=headers()).json()
    baseline = store.read()
    url = '/api/v1/quality/checks'
    assert client.post(url, json={'elder_id': 'E1'}, headers=headers()).status_code == 403
    result = client.post(url, json={'elder_id': 'E1'}, headers=headers('manager'))
    assert result.status_code == 201
    report = result.json()
    assert {'task_unassigned', 'task_deadline_unconfirmed'} <= {row['code'] for row in report['issues']}
    task_id = created['tasks'][0]['id']
    assert all(row['citations'][0]['source_id'] == task_id for row in report['issues'])
    issue = report['issues'][0]
    resolve_url = f'{url}/{report["id"]}/issues/{issue["id"]}/resolve'
    body = {'status': 'acknowledged', 'note': '已核对，另行安排人员与时间'}
    assert client.post(resolve_url, json=body, headers=headers('manager')).status_code == 200
    assert client.post(resolve_url, json=body, headers=headers('manager')).status_code == 200
    assert client.post(resolve_url, json={**body, 'status': 'not_applicable'}, headers=headers('manager')).status_code == 409
    after = store.read()
    assert after['care_records'] == baseline['care_records'] and after['care_tasks'] == baseline['care_tasks']
    assert client.get(f'{url}/{report["id"]}', headers=headers('family')).status_code == 403
    assert client.get(f'/api/v1/items/{report["id"]}/timeline', headers=headers()).status_code == 403
    assert client.get(f'/api/v1/items/{report["id"]}/timeline', headers=headers('manager')).status_code == 200


def test_quality_provider_failure_does_not_save_success_and_rules_still_work(api, manual_payload, monkeypatch):
    client, store, headers = api
    client.post('/api/v1/records/manual', json=manual_payload, headers=headers())
    class Broken(MockAIProvider):
        def quality(self, sources):
            raise AIProviderError('provider unavailable')
    monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: Broken())
    result = client.post('/api/v1/quality/checks', json={'include_ai': True}, headers=headers('manager'))
    assert result.status_code == 201
    report = result.json()
    assert report['ai_status'] == 'failed'
    assert report['ai_error'] == 'ai_unavailable'
    assert report['issues']
    assert store.read()['quality_checks']
    assert client.post('/api/v1/quality/checks', json={'include_ai': False}, headers=headers('manager')).status_code == 201


def test_stale_handover_quality_reports_missing_revision(api, manual_payload):
    client, _, headers = api
    _, _, record, handover = prepare(api, manual_payload)
    client.post(f'/api/v1/records/{record["record"]["id"]}/corrections', json={
        'observations': ['人工修正'], 'reason': '复核', 'expected_revision': 1}, headers=headers())
    result = client.post('/api/v1/quality/checks', json={'handover_id': handover['id']}, headers=headers('manager'))
    assert result.status_code == 201
    assert 'handover_source_missing_or_stale' in {issue['code'] for issue in result.json()['issues']}
