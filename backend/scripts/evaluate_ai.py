"""Offline extraction evaluation; never calls a vendor or changes the store.

Predictions JSONL: {case_id, provider, output}. output is the original strict
extraction object (observations/task_candidates/evidence/warnings). Missing
predictions count as missing cases, never silently disappear from the denominator.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.ai_outputs import validate_extraction  # noqa: E402


def condition_matches(expected, actual):
    """Only an optional leading 如果 is equivalent; keep the entire predicate.

    Do not use fuzzy matching or remove negatives, subjects, time qualifiers or
    comparisons. Verbatim-source validation still runs before this comparison.
    """
    if expected is None:
        return not actual
    if not actual:
        return False
    def predicate(value):
        return value[2:] if value.startswith('如果') else value
    return predicate(expected) == predicate(actual)


def evaluate(cases, predictions):
    case_ids = [row['id'] for row in cases]
    if len(set(case_ids)) != len(case_ids) or not cases:
        raise ValueError('Cases must be nonempty and unique')
    lookup = {}
    for row in predictions:
        if row['case_id'] in lookup or row['case_id'] not in case_ids:
            raise ValueError('Duplicate or unknown prediction case_id')
        lookup[row['case_id']] = row
    details = []
    hits = expected = predicted = span_hits = spans = 0
    valid = missing = 0
    providers = set()
    for case in cases:
        expected += len(case['tasks'])
        spans += len(case['required_observation_spans'])
        row = lookup.get(case['id'])
        status = {'case_id': case['id'], 'status': 'missing', 'matched_tasks': 0}
        if row is None:
            missing += 1
            details.append(status)
            continue
        providers.add(row.get('provider', 'unspecified'))
        try:
            output = validate_extraction(row['output'], case['text'])
        except (ValueError, KeyError, TypeError):
            status['status'] = 'invalid_structure_or_quote'
            details.append(status)
            continue
        valid += 1
        tasks = output['task_candidates']
        predicted += len(tasks)
        matched = set()
        for task in tasks:
            for index, target in enumerate(case['tasks']):
                if index in matched or target['anchor'] not in task['evidence_text']:
                    continue
                if not condition_matches(target['condition'], task.get('condition')):
                    continue
                matched.add(index)
                break
        hits += len(matched)
        preserved = sum(any(span in observed for observed in output['observations']) for span in case['required_observation_spans'])
        span_hits += preserved
        status.update(status='valid', matched_tasks=len(matched), predicted_tasks=len(tasks), preserved_spans=preserved)
        details.append(status)
    return {'dataset_kind': 'team_authored_synthetic_development_set', 'vendor_calls_by_evaluator': 0,
            'providers': sorted(providers), 'cases': len(cases), 'predictions': len(lookup), 'missing': missing,
            'valid_structure_and_quotes': {'count': valid, 'total': len(cases)},
            'task_precision': {'hits': hits, 'predicted': predicted, 'ratio': hits / predicted if predicted else None,
                               'definition': '只统计通过结构/引文检查的输出，必须同时查看invalid和missing，不能单独宣传该比率。'},
            'task_recall': {'hits': hits, 'expected': expected, 'ratio': hits / expected if expected else None},
            'required_span_coverage': {'hits': span_hits, 'total': spans, 'ratio': span_hits / spans if spans else None},
            'notice': '开发期合成案例；引文合法不代表语义正确。需人工另审否定、归因、医疗补写与任务标题，不能称为独立临床/机构效果验证。',
            'details': details}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, default=Path(__file__).resolve().parents[1] / 'evaluation' / 'cases.json')
    parser.add_argument('--predictions', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text(encoding='utf-8-sig'))
    predictions = [json.loads(line) for line in args.predictions.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    result = evaluate(cases, predictions)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Evaluated {result["predictions"]}/{result["cases"]} cases; report written. No vendor calls.')


if __name__ == '__main__':
    main()
