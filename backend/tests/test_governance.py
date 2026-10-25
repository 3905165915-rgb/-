from app.services import ai_service
from test_facility import post


def evaluation(case_id='one', model='model-a', **changes):
    body = {'dataset_version': 'synthetic-v1', 'case_id': case_id, 'sample_sha256': 'a' * 64,
            'sample_kind': 'synthetic', 'split': 'holdout', 'feature': 'extraction',
            'model': model, 'prompt_version': 'prompt-v1', 'expected_labels': ['task-water', 'task-contact'],
            'predicted_labels': ['task-water', 'wrong-task'], 'checked_citations': 2, 'incorrect_citations': 1,
            'output_valid': True, 'elapsed_ms': 1200, 'privacy_confirmed': True, 'note': '人工逐项核对合成样本'}
    return {**body, **changes}


def test_paired_evaluation_has_real_denominators_and_immutable_labels(api):
    a = post(api, '/ai-governance/evaluations', evaluation(), key='eval')
    assert (a['true_positive'], a['false_positive'], a['false_negative']) == (1, 1, 1)
    assert post(api, '/ai-governance/evaluations', evaluation(), key='eval') == a
    post(api, '/ai-governance/evaluations', evaluation(model='model-b', predicted_labels=['task-water', 'task-contact']))
    post(api, '/ai-governance/evaluations', evaluation(case_id='only-a'))
    post(api, '/ai-governance/evaluations', evaluation(model='model-c', expected_labels=['changed']), expected=409)
    client, _, headers = api
    response = client.get('/api/v1/ai-governance/comparison', params={'dataset_version': 'synthetic-v1',
                          'feature': 'extraction', 'split': 'holdout'}, headers=headers('manager'))
    assert response.status_code == 200
    result = response.json()
    assert result['paired_case_ids'] == ['one']
    models = {r['model']: r for r in result['versions']}
    assert models['model-a']['paired']['precision'] == 0.5
    assert models['model-a']['paired']['recall'] == 0.5
    assert models['model-b']['paired']['f1'] == 1
    assert models['model-a']['unpaired_case_ids'] == ['only-a']
    assert models['model-a']['paired']['incorrect_citation_ratio'] == 0.5


def test_zero_denominator_invalid_output_privacy_and_management_authority(api):
    item = post(api, '/ai-governance/evaluations', evaluation(expected_labels=[], predicted_labels=[],
                output_valid=False, checked_citations=0, incorrect_citations=0))
    assert item['false_positive'] == item['false_negative'] == 0
    post(api, '/ai-governance/evaluations', evaluation(case_id='bad', privacy_confirmed=False), expected=422)
    post(api, '/ai-governance/evaluations', evaluation(case_id='bad', expected_labels=['x', 'x']), expected=422)
    post(api, '/ai-governance/evaluations', evaluation(case_id='bad'), actor='staff', expected=403)
    client, _, headers = api
    assert client.get('/api/v1/ai-governance/operations', headers=headers('family')).status_code == 403


def test_provider_measurements_preserve_mock_type_and_do_not_log_raw_inputs(api):
    provider = ai_service.get_ai_provider()
    assert isinstance(provider, ai_service.MockAIProvider)
    provider.extract('E1', None, '仅用于测试的私密照护内容')
    rows = [r for r in api[1].read()['ai_evaluations'] if r['kind'] == 'run']
    assert len(rows) == 1 and rows[0]['feature'] == 'extraction' and rows[0]['is_demo'] is True
    assert '私密' not in str(rows)
    client, _, headers = api
    report = client.get('/api/v1/ai-governance/operations', headers=headers('manager')).json()
    assert report['models'][0]['calls'] == 1 and report['models'][0]['failed'] == 0


def test_provider_failure_is_measured_without_exposing_exception_or_key(api):
    from app.services.governance_service import instrument
    import pytest
    class Broken(ai_service.MockAIProvider):
        name = 'test-failing-model'
        def quality(self, sources):
            raise ai_service.AIProviderError('sensitive provider details')
    provider = instrument(Broken(), api[1].data_dir)
    with pytest.raises(ai_service.AIProviderError):
        provider.quality([])
    row = api[1].read()['ai_evaluations'][0]
    assert row['outcome'] == 'failed' and 'sensitive' not in str(row)


def test_rejected_task_candidate_counts_as_human_edit_even_when_observations_unchanged(api):
    client, _, headers = api
    draft = client.post('/api/v1/records/extract', headers=headers(),
                        json={'elder_id': 'E1', 'text': '请联系家属确认散步安排。'}).json()
    assert draft['task_candidates']
    response = client.post('/api/v1/records/' + draft['id'] + '/confirm', headers=headers(),
                           json={'observations': draft['observations'], 'task_candidates': [], 'expected_revision': 1})
    assert response.status_code == 200 and response.json()['tasks'] == []
    report = client.get('/api/v1/ai-governance/operations', headers=headers('manager')).json()
    assert report['record_drafts']['confirmed_with_edits'] == 1
