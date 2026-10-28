"""Read-only quality suggestions with independently persisted human review decisions."""
from __future__ import annotations

import hashlib
import json

from app.services.ai_service import AIProviderError, get_ai_provider
from app.services.task_service import task_view
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, parse_time, replayable
from app.services import task_condition_service


def collect(data, scope):
    if scope.elder_id:
        find(data, 'elders', scope.elder_id, 'elder_not_found')
    shift_id = scope.shift_id
    handover = None
    if scope.handover_id:
        handover = find(data, 'handovers', scope.handover_id, 'handover_not_found')
        if shift_id and shift_id != handover['source_shift_id']:
            raise DomainError('quality_scope_mismatch', 422)
        shift_id = handover['source_shift_id']
    if shift_id:
        find(data, 'shifts', shift_id, 'shift_not_found')
    def matches(row):
        return (not scope.elder_id or row['elder_id'] == scope.elder_id) and (not shift_id or row.get('shift_id') == shift_id)
    result = {name: [row for row in data[name] if matches(row)] for name in ['care_records', 'care_tasks', 'ai_drafts']}
    result['handover'] = handover
    result['handover_items'] = [row for row in data['handover_items'] if handover and row['handover_id'] == handover['id']]
    at = now()
    result['condition_checks'] = {row['id']: task_condition_service.state_from_data(data, row, at)
                                  for row in result['care_tasks'] if row.get('condition')}
    from app.services.plan_service import task_state
    result['plan_checks'] = {row['id']: task_state(data, row, at)
                             for row in result['care_tasks'] if row.get('source_plan_id')}
    return result


def fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def ai_sources(snapshot):
    sources = []
    for row in snapshot['care_records']:
        sources.append({'source_id': row['id'], 'elder_id': row['elder_id'], 'kind': 'record',
                        'text': '原文：' + row['raw_text'] + '\n人工确认记录：' + '；'.join(row['observations']),
                        'happened_at': row.get('happened_at'), 'created_at': row['created_at'], 'revision': row.get('revision', 1)})
    for row in snapshot['care_tasks']:
        sources.append({'source_id': row['id'], 'elder_id': row['elder_id'], 'kind': 'task',
                        'text': row['title'] + (f"；条件：{row['condition']}" if row.get('condition') else ''),
                        'status': row['status'], 'due_at': row.get('due_at'), 'revision': row.get('revision', 1)})
    return sources


def rule_issues(snapshot):
    issues = []
    def add(code, title, row, quote, explanation):
        issues.append({'id': identifier('QI'), 'type': 'rule', 'code': code, 'title': title,
                       'elder_id': row.get('elder_id'), 'status': 'pending_review', 'explanation': explanation,
                       'citations': [{'source_id': row['id'], 'quote': quote}]})
    for row in snapshot['care_tasks']:
        if row['status'] in {'completed', 'cancelled'}:
            continue
        plan_check = snapshot.get('plan_checks', {}).get(row['id'])
        if plan_check and not plan_check['ready']:
            add('task_plan_requires_review', '待办计划依据需要复核', row, row['title'],
                '计划已变更、停用、评估到期或来源有变，请主管核对，不自动继续执行旧安排。')
        condition = snapshot.get('condition_checks', {}).get(row['id'])
        if condition and not condition['ready']:
            add('task_condition_blocked', '待办条件尚未通过当前核验', row, row['condition'],
                '当前条件状态：' + task_condition_service.STATE_LABELS[condition['state']] + '。需核对负责人、正式记录及有效期，不自动执行。')
        if condition and condition['overdue']:
            add('condition_check_overdue', '条件核验已超过提醒期限', row, row['condition'], '请核验人重新核对进展；逾期不等同条件满足。')
        if not row.get('assigned_to'):
            add('task_unassigned', '待办未指定负责人', row, row['title'], '请管理人员核对并安排负责人。')
        if not row.get('due_at'):
            add('task_deadline_unconfirmed', '待办截止时间待确认', row, row['title'], '原文时间不自动转换为截止时间，请人工确认。')
        else:
            try:
                if parse_time(row['due_at']).utcoffset() is None:
                    raise ValueError('Missing timezone')
                if task_view(row)['status'] == 'overdue':
                    add('task_overdue', '待办已超过截止时间', row, row['title'], '按本次扫描时间判断，请核对任务实际进展。')
            except ValueError:
                add('task_invalid_deadline', '历史任务时间格式待核对', row, row['title'], '截止时间缺少时区或格式不正确。')
    for row in snapshot['ai_drafts']:
        if row['status'] == 'pending_review':
            add('draft_pending_review', 'AI草稿尚未人工确认', row, row['raw_text'], '草稿不属于正式记录，也不会自动生成任务。')
    handover = snapshot['handover']
    if handover and handover['status'] == 'draft':
        actual = {(row['kind'], row['source_id'], row['source_revision']) for row in snapshot['handover_items']}
        for kind, name in [('record', 'care_records'), ('task', 'care_tasks')]:
            for row in snapshot[name]:
                if kind == 'task' and row['status'] in {'completed', 'cancelled'}:
                    continue
                if (kind, row['id'], row.get('revision', 1)) not in actual:
                    add('handover_source_missing_or_stale', '交班明细遗漏或版本已过期', row,
                        row['title'] if kind == 'task' else '；'.join(row['observations']), '请刷新交班单，重新核对后提交。')
        for source_id in (handover.get('ai_summary') or {}).get('uncovered_task_ids', []):
            task = next((row for row in snapshot['care_tasks'] if row['id'] == source_id), None)
            if task:
                add('summary_task_not_cited', 'AI摘要未引用该待办', task, task['title'], '任务仍保留在交班明细中，请人工核对摘要。')
    return issues


def report_view(data, report):
    from copy import deepcopy
    from app.schemas.api import QualityScanRequest
    result = deepcopy(report)
    try:
        result['source_current'] = bool(report.get('source_fingerprint')) and fingerprint(
            collect(data, QualityScanRequest.model_validate(report.get('scope', {})))) == report['source_fingerprint']
    except DomainError:
        # A historical report remains readable after its scope is retired.
        result['source_current'] = False
    for issue in result['issues']:
        issue['source_current'] = result['source_current']
        issue['related_items'] = [
            {'id': c['source_id'], 'kind': 'task' if any(t['id'] == c['source_id'] for t in data['care_tasks']) else 'record'}
            for c in issue['citations']]
    return result


def scan(store, scope, user_id, key=None):
    from app.core.config import settings
    initial = store.read()
    actor_role = current_staff(initial, user_id, management=True)['role']
    payload = scope.model_dump()
    if key is not None and any(r['user_id'] == user_id and r['action'] == 'quality_scan_request' and r['key'] == key
                               for r in initial['idempotency_keys']):
        return replayable(initial, user_id, 'quality_scan_request', key, payload, lambda: None)
    snapshot = collect(initial, scope)
    source_hash = fingerprint(snapshot)
    issues = rule_issues(snapshot)
    provider_name = None
    ai_status = 'not_requested'
    ai_error = None
    sources = ai_sources(snapshot)
    include_ai = scope.include_ai if scope.include_ai is not None else settings.quality_ai_enabled
    if include_ai and sources:
        try:
            if len(sources) > 100 or sum(len(row['text']) for row in sources) > 60000:
                raise AIProviderError('ai_scope_too_large_choose_elder_or_shift')
            provider = get_ai_provider()
            provider_name = provider.name
            result = provider.quality(sources)
            ai_status = 'completed'
            # Keep one actionable suggestion per source/title/explanation. A model may
            # repeat the same citation when several records contain similar wording.
            seen = set()
            for finding in result['findings']:
                finding_key = (finding.get('title', ''), finding.get('explanation', ''),
                       tuple((c.get('source_id'), c.get('quote')) for c in finding.get('citations', [])))
                if finding_key in seen:
                    continue
                seen.add(finding_key)
                cited_elders = {s['elder_id'] for s in sources if s['source_id'] in
                               {c['source_id'] for c in finding.get('citations', [])}}
                issues.append({'id': identifier('QI'), 'type': 'ai_suggestion', 'code': 'ai_text_review',
                               'status': 'pending_review', **finding,
                               'elder_id': next(iter(cited_elders)) if len(cited_elders) == 1 else scope.elder_id})
        except AIProviderError:
            # Rule checks are independent of the model. Persist them so an outage does
            # not erase the manager's actionable review queue; the model can be retried.
            ai_status = 'failed'
            ai_error = 'ai_unavailable'
    def mutate(data):
        current_staff(data, user_id, actor_role, management=True)
        if data.get('demo_batch_id') != initial.get('demo_batch_id'):
            raise DomainError('demo_batch_changed')
        if key is not None and any(r['user_id'] == user_id and r['action'] == 'quality_scan_request' and r['key'] == key
                                   for r in data['idempotency_keys']):
            return replayable(data, user_id, 'quality_scan_request', key, payload, lambda: None)
        if fingerprint(collect(data, scope)) != source_hash:
            raise DomainError('quality_sources_changed_retry_scan')
        # Concurrent double clicks against one unchanged snapshot share a report.
        recent = next((r for r in reversed(data['quality_checks']) if r['created_by'] == user_id
                       and r['scope'] == payload and r['source_fingerprint'] == source_hash
                       and r.get('ai_status') == ai_status
                       and 0 <= (parse_time(now()) - parse_time(r['created_at'])).total_seconds() < 2), None)
        if recent:
            return replayable(data, user_id, 'quality_scan_request', key, payload, lambda: recent)
        report = {'id': identifier('QC'), 'scope': payload, 'elder_id': scope.elder_id,
                  'created_by': user_id, 'created_at': now(), 'status': 'pending_review' if issues else 'reviewed',
                  'source_fingerprint': source_hash, 'sources': sources, 'issues': issues, 'provider': provider_name,
                  'ai_status': ai_status, 'ai_error': ai_error,
                  'checked_at': now(), 'rule_status': 'completed', 'model_status': ai_status,
                  'execution_status': 'partial' if ai_status == 'failed' else 'completed',
                  'has_sources': bool(sources or snapshot['ai_drafts'] or snapshot['handover']),
                  'retryable': ai_status == 'failed', 'timezone': 'Asia/Shanghai',
                  'historical_snapshot': True, 'warnings': ['结果是扫描时的建议，不是医疗结论、事故认定或实时状态。']}
        if ai_status == 'failed':
            report['warnings'].append('AI部分未完成，已保留规则检查结果；可稍后重新发起含AI质检。')
        if provider_name == 'mock':
            report['warnings'].append('当前为演示结果，非真实AI推理。')
        data['quality_checks'].append(report)
        audit(data, 'ai_quality_scan' if include_ai else 'quality_scan', report['id'], user_id,
              elder_id=scope.elder_id, detail=f'生成{len(issues)}条待核对建议')
        return replayable(data, user_id, 'quality_scan_request', key, payload, lambda: report)
    return store.mutate(mutate)


def resolve(store, report_id, issue_id, payload, user_id):
    def mutate(data):
        current_staff(data, user_id, management=True)
        report = find(data, 'quality_checks', report_id, 'quality_report_not_found')
        issue = next((row for row in report['issues'] if row['id'] == issue_id), None)
        if issue is None:
            raise DomainError('quality_issue_not_found', 404)
        if issue['status'] != 'pending_review':
            if issue['status'] == payload.status and issue.get('review_note') == payload.note:
                return report
            raise DomainError('quality_issue_already_reviewed')
        if not report_view(data, report)['source_current']:
            raise DomainError('quality_sources_changed_retry_scan')
        issue.update(status=payload.status, review_note=payload.note, reviewed_by=user_id, reviewed_at=now())
        if all(row['status'] != 'pending_review' for row in report['issues']):
            report['status'] = 'reviewed'
        audit(data, 'resolve_quality_issue', report_id, user_id, elder_id=report.get('elder_id'),
              issue_id=issue_id, detail=payload.note, decision=payload.status)
        return report
    return store.mutate(mutate)
