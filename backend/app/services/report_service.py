"""Transparent snapshot metrics and minimal, purpose-recorded case exports."""
import copy
from datetime import datetime, time, timedelta, timezone

from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, parse_time

LOCAL = timezone(timedelta(hours=8))


def bounds(start, end):
    if not 0 < (end - start).days <= 366:
        raise DomainError('report_range_must_be_1_to_366_days', 422)
    return datetime.combine(start, time.min, LOCAL), datetime.combine(end, time.min, LOCAL)


def stamp(value):
    try:
        result = parse_time(value)
        return result if result.tzinfo is not None else None
    except (ValueError, TypeError, AttributeError):
        return None


def ratio(numerator, denominator):
    return {'numerator': numerator, 'denominator': denominator,
            'ratio': numerator / denominator if denominator else None}


def metrics(store, start, end, user_id, role):
    lower, upper = bounds(start, end)
    data = store.read()
    current_staff(data, user_id, role, management=True)
    instant = parse_time(now())
    def within(value):
        parsed = stamp(value)
        return parsed is not None and lower <= parsed < upper and parsed <= instant
    groups = {}
    invalid = 0
    future = 0
    for row in data['care_tasks']:
        if not row.get('occurrence_key'):
            continue
        scheduled = stamp(row.get('scheduled_at'))
        if scheduled is None:
            invalid += 1
            continue
        if lower <= scheduled < upper and scheduled > instant:
            future += 1
        if within(row.get('scheduled_at')):
            groups.setdefault(row['occurrence_key'], []).append(row)
    latest = []
    for group in groups.values():
        replaced = {r.get('replaces_task_id') for r in group}
        leaves = [r for r in group if r['id'] not in replaced]
        if len(leaves) != 1:
            raise DomainError('ambiguous_plan_occurrence_chain')
        latest.append(leaves[0])
    done = [r for r in latest if r['status'] == 'completed']
    on_time = [r for r in done if stamp(r.get('completed_at')) is not None and
               stamp(r.get('due_at')) is not None and stamp(r['completed_at']) <= stamp(r['due_at'])]
    overdue = [r for r in latest if r['status'] not in {'completed', 'cancelled'} and
               stamp(r.get('due_at')) is not None and stamp(r['due_at']) < instant]
    handover_ids = {r['id'] for r in data['handovers'] if r['status'] in {'submitted', 'received'} and within(r.get('submitted_at'))}
    handover_items = [r for r in data['handover_items'] if r['handover_id'] in handover_ids]
    incident_ids = {r['id'] for r in data['incidents'] if within(r['occurred_at'])}
    incidents = [r for r in data['incidents'] if r['id'] in incident_ids]
    rects = [r for r in data['rectifications'] if r['incident_id'] in incident_ids]
    feedbacks = [r for r in data['family_cases'] if r.get('kind') == 'feedback' and within(r['created_at'])]
    return {'as_of': instant.isoformat(), 'timezone': 'Asia/Shanghai',
        'window': {'start_inclusive': lower.isoformat(), 'end_exclusive': upper.isoformat()},
        'interpretation': '按所选时间范围统计，显示当前处理结果，不代表历史时点的处理状态。只计算已生成且已到服务时间的计划任务；未生成的服务不在统计范围内，不能代表全机构计划履约率。',
        'generated_plan_occurrences': {
            'completion': ratio(len(done), len(latest)), 'on_time_completion': ratio(len(on_time), len(latest)),
            'cancelled': sum(r['status'] == 'cancelled' for r in latest),
            'not_done': sum(r['status'] == 'not_done' for r in latest), 'open_overdue': len(overdue),
            'excluded_future_task_rows': future, 'invalid_schedule_rows': invalid,
            'definition': '按计划服务时间筛选已到时间的计划事项。同一事项如有补发，仅统计最后一项；取消事项仍计入统计总数。'},
        'manual_task_rows_created': sum(not r.get('occurrence_key') and within(r.get('created_at')) for r in data['care_tasks']),
        'handover_receipt': {**ratio(sum(r['status'] == 'received' for r in handover_items), len(handover_items)),
            'definition': '按交班提交时间选取，全部提交事项计入统计总数，已接收事项计入达成数量；仍在澄清的事项暂不视为已接收。'},
        'incidents': {'reported': len(incidents), 'closed': sum(r['status'] == 'closed' for r in incidents),
            'open_rectifications_overdue': sum(r['status'] != 'closed' and stamp(r['due_at']) is not None and stamp(r['due_at']) < instant for r in rects),
            'definition': '按事件实际发生时间选取；整改未关闭且截止时间已过，计为整改逾期。'},
        'family_feedback': {'created': len(feedbacks), 'closed': sum(r['status'] == 'closed' for r in feedbacks),
            'definition': '按反馈提交时间选取；已关闭表示主管已回复，不代表家属满意。'}}


def export_case(store, elder_id, include_text, reason, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        find(data, 'elders', elder_id, 'elder_not_found')
        export_id = identifier('EXPORT')
        mapping = {}
        def ref(value):
            if value is None:
                return None
            if value not in mapping:
                mapping[value] = f'object-{len(mapping) + 1}'
            return mapping[value]
        def select(row, fields, references=(), texts=()):
            result = {field: copy.deepcopy(row.get(field)) for field in fields}
            for field in references:
                result[field] = ref(row.get(field))
            if include_text:
                for field in texts:
                    result[field] = copy.deepcopy(row.get(field))
            return result
        result = {'export_id': export_id, 'created_at': now(), 'mode': 'internal_text' if include_text else 'pseudonymized_metadata',
            'subject': ref(elder_id), 'notice': '仅用于经授权的内部审查。默认去标识不代表不可再识别；不要公开真实个案。导出不含账号、联系方式、家属授权凭证。',
            'records': [], 'tasks': [], 'memories': [], 'assessments': [], 'plans': [],
            'handovers': [], 'change_reviews': [], 'incidents': []}
        for row in data['care_records']:
            if row['elder_id'] == elder_id:
                result['records'].append(select(row, ('revision', 'status', 'created_at', 'happened_at'),
                    ('id', 'admission_id', 'source_draft_id'), ('raw_text', 'observations', 'corrections')))
        for row in data['care_tasks']:
            if row['elder_id'] == elder_id:
                task = select(row, ('revision', 'status', 'created_at', 'due_at', 'completed_at', 'reason_code', 'service_date', 'scheduled_at'),
                    ('id', 'source_record_id', 'source_plan_id', 'replaces_task_id'),
                    ('title', 'result', 'condition', 'memory_references', 'condition_verification', 'source_plan_snapshot'))
                if not include_text:
                    task['memory_references'] = [select(r, ('status', 'memory_revision'), ('id', 'memory_id')) for r in row.get('memory_references', [])]
                result['tasks'].append(task)
        for row in data['care_memories']:
            if row['elder_id'] == elder_id:
                result['memories'].append(select(row, ('revision', 'status', 'category', 'scenes', 'expires_at'), ('id',), ('content',)))
        for row in data['care_plans']:
            if row['elder_id'] == elder_id:
                result['plans'].append(select(row, ('revision', 'status', 'starts_on', 'ends_on'), ('id', 'assessment_id', 'supersedes_id'), ('title', 'goal', 'items')))
        for row in data['assessments']:
            if row['elder_id'] == elder_id:
                result['assessments'].append(select(row, ('revision', 'status', 'assessed_at', 'review_due_at'),
                    ('id', 'admission_id', 'supersedes_id'), ('scores', 'note', 'evidence', 'care_level_label', 'care_level_basis')))
        for row in data['change_reviews']:
            if row['elder_id'] == elder_id:
                result['change_reviews'].append(select(row, ('revision', 'status', 'created_at', 'due_at', 'closed_at'),
                    ('id', 'task_id', 'memory_id'), ('initial_snapshot', 'observations', 'submissions', 'reviews')))
        for row in data['handovers']:
            items = [r for r in data['handover_items'] if r['handover_id'] == row['id'] and r.get('elder_id') == elder_id]
            if items:
                # Do not include a whole shift summary: it can mention other elders.
                handover = select(row, ('revision', 'status', 'created_at', 'submitted_at'), ('id',))
                handover['items'] = [select(r, ('kind', 'status', 'received_at', 'source_revision'), ('id', 'source_id'),
                    ('detail', 'condition', 'memory_references', 'condition_verification', 'condition_check',
                     'source_plan_snapshot', 'plan_check', 'clarifications', 'receipt_note')) for r in items]
                result['handovers'].append(handover)
        for row in data['incidents']:
            if row['elder_id'] == elder_id:
                item = select(row, ('revision', 'status', 'occurred_at', 'category', 'severity'), ('id', 'admission_id'),
                              ('description', 'immediate_action', 'classification_basis', 'evidence', 'history'))
                rect = next((r for r in data['rectifications'] if r['incident_id'] == row['id']), None)
                if rect:
                    item['rectification'] = select(rect, ('revision', 'status', 'due_at'), ('id',),
                        ('corrective_plan', 'submissions', 'reviews', 'history'))
                result['incidents'].append(item)
        audit(data, 'export_case', elder_id, user_id, elder_id=elder_id, detail=reason,
              export_id=export_id, include_text=include_text)
        return result
    return store.mutate(mutate)
