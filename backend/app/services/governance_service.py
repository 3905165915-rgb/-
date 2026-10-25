"""Operational measurements and immutable human-labeled evaluations are distinct."""
import copy
import hashlib
import json
from collections import defaultdict
from functools import wraps
from time import perf_counter

from app.services.workflow import DomainError, current_staff, identifier, now, audit, replayable


def instrument(provider, data_dir):
    """Preserve provider type/name, log metadata only, and never log prompts/keys."""
    from app.storage.json_store import JsonStore
    for method, feature in [('extract', 'extraction'), ('extract_context', 'context'),
                            ('impression', 'impression'), ('summarize', 'summary'), ('quality', 'quality'), ('care_advice', 'care_advice')]:
        original = getattr(provider, method)
        def wrap(fn, feature):
            @wraps(fn)
            def call(*args, **kwargs):
                started = perf_counter()
                outcome = 'returned'
                try:
                    return fn(*args, **kwargs)
                except Exception:
                    outcome = 'failed'
                    raise
                finally:
                    row = {'id': identifier('RUN'), 'kind': 'run', 'feature': feature, 'model': provider.name,
                           'prompt_version': ('care-advice-2026-10-25-v1' if feature == 'care_advice'
                                              else 'care-text-2026-10-25'), 'outcome': outcome,
                           'model_id': getattr(provider, 'model', provider.name),
                           'is_demo': provider.name == 'mock', 'created_at': now(),
                           'elapsed_ms': round((perf_counter() - started) * 1000)}
                    # Measurement is part of the model operation, not a fabricated
                    # accuracy result. A failed log write must be visible to caller.
                    JsonStore(data_dir).mutate(lambda data: data['ai_evaluations'].append(row))
            return call
        setattr(provider, method, wrap(original, feature))
    return provider


def submit(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            gold = hashlib.sha256(json.dumps({'sample_sha256': payload.sample_sha256,
                'expected_labels': sorted(payload.expected_labels), 'split': payload.split,
                'sample_kind': payload.sample_kind}, sort_keys=True).encode()).hexdigest()
            cases = [r for r in data['ai_evaluations'] if r.get('kind') == 'evaluation'
                     and r['dataset_version'] == payload.dataset_version and r['case_id'] == payload.case_id
                     and r['feature'] == payload.feature]
            if any(r['gold_fingerprint'] != gold for r in cases):
                raise DomainError('evaluation_gold_changed_use_new_dataset_version')
            existing = next((r for r in cases if r['model'] == payload.model and r['prompt_version'] == payload.prompt_version), None)
            values = payload.model_dump()
            if existing:
                if any(existing[k] != v for k, v in values.items()):
                    raise DomainError('evaluation_immutable_use_new_version')
                return copy.deepcopy(existing)
            expected, predicted = set(payload.expected_labels), set(payload.predicted_labels)
            item = {'id': identifier('EVAL'), 'kind': 'evaluation', **values, 'gold_fingerprint': gold,
                    'true_positive': len(expected & predicted), 'false_positive': len(predicted - expected),
                    'false_negative': len(expected - predicted), 'reviewed_by': user_id, 'created_at': now()}
            data['ai_evaluations'].append(item)
            audit(data, 'submit_ai_evaluation', item['id'], user_id)
            return copy.deepcopy(item)
        return replayable(data, user_id, 'submit_ai_evaluation', key, payload.model_dump(), operation)
    return store.mutate(mutate)


def _metrics(rows):
    tp = sum(r['true_positive'] for r in rows)
    fp = sum(r['false_positive'] for r in rows)
    fn = sum(r['false_negative'] for r in rows)
    citations = sum(r['checked_citations'] for r in rows)
    incorrect = sum(r['incorrect_citations'] for r in rows)
    return {'cases': len(rows), 'true_positive': tp, 'false_positive': fp, 'false_negative': fn,
            'precision': tp / (tp + fp) if tp + fp else None,
            'recall': tp / (tp + fn) if tp + fn else None,
            'f1': 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
            'invalid_outputs': sum(not r['output_valid'] for r in rows),
            'checked_citations': citations, 'incorrect_citations': incorrect,
            'incorrect_citation_ratio': incorrect / citations if citations else None,
            'mean_elapsed_ms': sum(r['elapsed_ms'] for r in rows) / len(rows) if rows else None}


def compare(store, dataset_version, feature, split, user_id, role):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    rows = [r for r in data['ai_evaluations'] if r.get('kind') == 'evaluation'
            and r['dataset_version'] == dataset_version and r['feature'] == feature and r['split'] == split]
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row['model'], row['prompt_version'])].append(row)
    common = set.intersection(*({r['case_id'] for r in group} for group in grouped.values())) if grouped else set()
    versions = [{'model': model, 'prompt_version': prompt,
                 'all_submitted': _metrics(group),
                 'paired': _metrics([r for r in group if r['case_id'] in common]),
                 'unpaired_case_ids': sorted({r['case_id'] for r in group} - common)}
                for (model, prompt), group in sorted(grouped.items())]
    return {'as_of': now(), 'dataset_version': dataset_version, 'feature': feature, 'split': split,
            'paired_case_ids': sorted(common), 'versions': versions,
            'definition': '逐项对照人工标注的标签标识，精确匹配计算误提与漏提；版本公平比较仅使用共同样本。零分母返回null。错误引用单独统计，不等同于语义正确率。',
            'notice': '团队标注的合成或脱敏样本评测，不代表独立机构验证或真实照护准确率；开发集与留出集分别报告，不能用采纳率代替准确率。'}


def operations(store, user_id, role):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    runs = [r for r in data['ai_evaluations'] if r.get('kind') == 'run']
    grouped = defaultdict(list)
    for row in runs:
        grouped[(row['feature'], row['model'], row['prompt_version'])].append(row)
    groups = [{'feature': feature, 'model': model, 'prompt_version': prompt, 'calls': len(rows),
               'failed': sum(r['outcome'] == 'failed' for r in rows), 'is_demo': all(r['is_demo'] for r in rows),
               'mean_elapsed_ms': sum(r['elapsed_ms'] for r in rows) / len(rows)}
              for (feature, model, prompt), rows in sorted(grouped.items())]
    # Confirm/edit outcomes describe workflow adoption, never correctness.
    drafts = data['ai_drafts']
    confirmed = [r for r in drafts if r['status'] == 'confirmed']
    edited_ids = {r['object_id'] for r in data['audit_logs'] if r['action'] == 'edit_ai_draft'}
    confirmations = {r['object_id']: r for r in data['audit_logs'] if r['action'] == 'confirm_ai_draft'}
    def tasks(values):
        return [{key: value.get(key) for key in ('title', 'due_at', 'assigned_to', 'condition', 'due_text')}
                for value in values or []]
    manual_edits = 0
    for draft in confirmed:
        record = next((r for r in data['care_records'] if r.get('source_draft_id') == draft['id']), None)
        confirmation = confirmations.get(draft['id'], {})
        task_edits = tasks(confirmation.get('before', {}).get('task_candidates')) != tasks(
            confirmation.get('after', {}).get('task_candidates'))
        if draft['id'] in edited_ids or task_edits or record and record['observations'] != draft.get('observations', []):
            manual_edits += 1
    vision = data['image_analyses']
    return {'as_of': now(), 'models': groups,
            'record_drafts': {'total': len(drafts), 'confirmed': len(confirmed),
                'rejected': sum(r['status'] == 'rejected' for r in drafts), 'confirmed_with_edits': manual_edits,
                'failed': sum(r['status'] == 'failed' for r in drafts)},
            'vision': {'attempts': len(vision), 'failed_or_unavailable': sum(r['model_status'] in {'failed', 'unavailable'} for r in vision),
                'confirmed': sum(r['status'] == 'confirmed' for r in vision), 'rejected': sum(r['status'] == 'rejected' for r in vision),
                'edited_reviews': sum(review['edited'] for r in vision for review in r['reviews'])},
            'notice': '运行耗时与人工采纳、修改、拒绝统计只描述系统使用情况，不是模型准确率。returned表示返回结果，业务校验及人工复核仍可能拒绝。'}
