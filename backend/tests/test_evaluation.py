import copy

import pytest

from scripts.evaluate_ai import evaluate


def test_evaluation_missing_invalid_and_duplicate_predictions():
    cases = [{'id': 'a', 'text': '如果本人同意再联系家属，目前尚未联系。',
              'required_observation_spans': ['尚未联系'], 'tasks': [{'anchor': '联系家属', 'condition': '如果本人同意'}]},
             {'id': 'b', 'text': '没有新的任务。', 'required_observation_spans': ['没有新的任务'], 'tasks': []}]
    prediction = {'case_id': 'a', 'provider': 'synthetic-test-only', 'output': {
        'observations': ['目前尚未联系'], 'evidence': [{'text': '目前尚未联系', 'type': 'observation'}], 'warnings': [],
        'task_candidates': [{'title': '联系家属', 'evidence_text': '如果本人同意再联系家属', 'condition': '如果本人同意'}]}}
    result = evaluate(cases, [prediction])
    assert result['cases'] == 2 and result['missing'] == 1
    assert result['task_recall']['hits'] == 1 and result['required_span_coverage']['hits'] == 1
    with pytest.raises(ValueError):
        evaluate(cases, [prediction, prediction])
    invalid = copy.deepcopy(prediction)
    invalid['output']['observations'] = ['编造的事实']
    assert evaluate(cases, [invalid])['valid_structure_and_quotes']['count'] == 0
    omitted_condition = copy.deepcopy(prediction)
    omitted_condition['output']['task_candidates'][0].pop('condition')
    assert evaluate(cases, [omitted_condition])['task_recall']['hits'] == 0


def test_duplicate_tasks_do_not_inflate_recall_and_false_positives_count():
    cases = [{'id': 'a', 'text': '请联系家属', 'required_observation_spans': [], 'tasks': [{'anchor': '联系家属', 'condition': None}]}]
    task = {'title': '联系家属', 'evidence_text': '请联系家属'}
    result = evaluate(cases, [{'case_id': 'a', 'output': {'observations': ['请联系家属'],
        'task_candidates': [task, task], 'evidence': [{'text': '请联系家属', 'type': 'task'}], 'warnings': []}}])
    assert result['task_precision']['ratio'] == 0.5 and result['task_recall']['ratio'] == 1


@pytest.mark.parametrize('condition,matched', [
    ('如果老人仍表示不适', 1), ('老人仍表示不适', 1),
    (None, 0), ('老人', 0), ('仍表示不适', 0), ('不适', 0),
    ('今晚', 0), ('老人未表示不适', 0),
])
def test_condition_scoring_ignores_only_if_connector(condition, matched):
    text = '今晚如果老人仍表示不适，再联系家属。此前老人未表示不适。'
    cases = [{'id': 'condition', 'text': text, 'required_observation_spans': [],
              'tasks': [{'anchor': '联系家属', 'condition': '如果老人仍表示不适'}]}]
    prediction = {'case_id': 'condition', 'output': {'observations': [text],
        'evidence': [{'text': text, 'type': 'synthetic'}], 'warnings': [],
        'task_candidates': [{'title': '联系家属', 'evidence_text': '再联系家属', 'condition': condition}]}}
    result = evaluate(cases, [prediction])
    assert result['valid_structure_and_quotes']['count'] == 1
    assert result['task_recall']['hits'] == matched
    assert result['task_precision']['hits'] == matched
