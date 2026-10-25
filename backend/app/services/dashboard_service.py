"""One-snapshot charts and drill-down rows, with explicit time/denominator rules."""
from collections import Counter
from datetime import timedelta

from app.services.report_service import bounds, stamp, ratio
from app.services.workflow import current_staff, find, now, parse_time, DomainError


def _task_status(row, instant):
    status = row.get('status', 'pending')
    if status in {'pending', 'in_progress', 'overdue'}:
        due = stamp(row.get('due_at'))
        if due and due < instant:
            return 'overdue'
        if status == 'overdue':
            return 'pending'
    return status


def _group(rows, field):
    counts = Counter(row.get(field) or 'unclassified' for row in rows)
    return [{'key': key, 'count': count, 'ids': [r['id'] for r in rows if (r.get(field) or 'unclassified') == key]}
            for key, count in sorted(counts.items())]


def _build(data, start, end, instant, elder_id=None, shift_id=None, status=None):
    lower, upper = bounds(start, end)
    elders = {r['id']: r.get('name', '未命名老人') for r in data['elders']}
    people = {r['id']: r.get('display_name', r['id']) for r in data['users']}
    record_shifts = {r['id']: r.get('shift_id') for r in data['care_records']}

    def within(value, reached=True):
        at = stamp(value)
        return at is not None and lower <= at < upper and (not reached or at <= instant)

    def matches(row, source_shift=None):
        return (elder_id is None or row.get('elder_id') == elder_id) and (
            shift_id is None or row.get('shift_id') == shift_id or source_shift == shift_id)

    def brief(row, kind, **extra):
        titles = {'task': '照护任务', 'handover_item': '交班事项', 'incident': '安全事件',
                  'memory': '照护记忆', 'impression_point': '老人印象', 'summary': '家属简报',
                  'feedback': '家属反馈', 'attachments': '观察照片', 'image_analyses': '照片观察草稿'}
        item = {'id': row['id'], 'kind': kind, 'elder_id': row.get('elder_id'),
                'elder_name': elders.get(row.get('elder_id')), 'status': row.get('status'),
                'title': row.get('title') or titles[kind],
                'assigned_to': row.get('assigned_to'), 'due_at': row.get('due_at'),
                'shift_id': row.get('shift_id'), **extra}
        item['assigned_name'] = people.get(item['assigned_to'], '待主管安排或审核')
        return item

    # Collapse re-issued plan occurrences before applying status filters; a
    # cancelled predecessor must never reappear as a second service occurrence.
    groups = {}
    for row in data['care_tasks']:
        groups.setdefault(row.get('occurrence_key') or 'manual:' + row['id'], []).append(row)
    tasks, scheduled, excluded_future, invalid = [], [], 0, 0
    for group in groups.values():
        replaced = {r.get('replaces_task_id') for r in group}
        leaves = [r for r in group if r['id'] not in replaced]
        if len(leaves) != 1:
            raise DomainError('ambiguous_plan_occurrence_chain')
        row = leaves[0]
        if not matches(row):
            continue
        state = _task_status(row, instant)
        if status is not None and status != state:
            continue
        date_value = row.get('scheduled_at') if row.get('occurrence_key') else row.get('due_at') or row.get('created_at')
        if stamp(date_value) is None:
            invalid += 1
            continue
        if not within(date_value, reached=False):
            continue
        item = brief(row, 'task', status=state, metric_at=date_value, scheduled_at=row.get('scheduled_at'),
                     completed_at=row.get('completed_at'), is_plan_occurrence=bool(row.get('occurrence_key')))
        tasks.append(item)
        if stamp(date_value) > instant:
            excluded_future += 1
        elif row.get('occurrence_key'):
            scheduled.append(item)

    handover_objects = {r['id']: r for r in data['handovers'] if r['status'] in {'submitted', 'received'}
                        and within(r.get('submitted_at'))
                        and (shift_id is None or shift_id in {r['source_shift_id'], r['target_shift_id']})}
    handovers = [brief(row, 'handover_item', handover_id=row['handover_id'],
                      metric_at=handover_objects[row['handover_id']]['submitted_at'], source_id=row['source_id'])
                 for row in data['handover_items'] if row['handover_id'] in handover_objects
                 and (elder_id is None or row.get('elder_id') == elder_id)
                 and (status is None or row['status'] == status)]
    rects = {r['incident_id']: r for r in data['rectifications']}
    incidents = []
    for row in data['incidents']:
        source_matches = shift_id is None or any(record_shifts.get(e['record_id']) == shift_id for e in row.get('evidence', []))
        if (elder_id is not None and row['elder_id'] != elder_id) or not source_matches or not within(row['occurred_at']):
            continue
        rect = rects.get(row['id'])
        state = 'awaiting_review' if rect and rect['status'] == 'awaiting_review' else row['status']
        if status is not None and status != state:
            continue
        incidents.append(brief(row, 'incident', status=state, category=row.get('category', 'unclassified'),
            severity=row.get('severity'),
            metric_at=row['occurred_at'], assigned_to=rect.get('assigned_to') if rect else None,
            due_at=rect.get('due_at') if rect else None, rectification_id=rect['id'] if rect else None))

    from app.services.memory_service import _view as memory_view
    memories = []
    for row in data['care_memories']:
        source_shift = record_shifts.get(row.get('source', {}).get('record_id'))
        if matches(row, source_shift) and within(row['created_at']):
            view = memory_view(data, row, at=instant.isoformat())
            state = ('review_due' if row['status'] == 'confirmed' and view['review_state'] == 'pending'
                     else 'effective' if view['effective'] else row['status'])
            if status is None or status == state:
                memories.append(brief(row, 'memory', status=state, effective=view['effective'],
                                      review_state=view['review_state'], source_id=row['source']['record_id'],
                                      metric_at=row['created_at']))
    # Candidate counts come only from the newest longitudinal report per elder.
    latest = {}
    for report in data['elder_impressions']:
        if report['elder_id'] not in latest or stamp(report['created_at']) > stamp(latest[report['elder_id']]['created_at']):
            latest[report['elder_id']] = report
    impressions = []
    for row in latest.values():
        if not matches(row) or not within(row['created_at']) or shift_id is not None:
            continue  # Reports combine shifts: never guess that they belong to one.
        for point in row['points']:
            if status is None or point['status'] == status:
                impressions.append(brief(row, 'impression_point', id=row['id'] + ':' + point['id'],
                    report_id=row['id'], point_id=point['id'], status=point['status'], metric_at=row['created_at']))

    family = []
    for row in data['family_cases']:
        if row.get('kind') not in {'summary', 'feedback'} or not within(row['created_at']):
            continue
        if elder_id is not None and row['elder_id'] != elder_id:
            continue
        if shift_id is not None and not any(record_shifts.get(e['record_id']) == shift_id for e in row.get('evidence', [])):
            continue
        if status is None or row['status'] == status:
            family.append(brief(row, row['kind'], metric_at=row['created_at']))
    reviews = []
    for collection in ('attachments', 'image_analyses'):
        for row in data[collection]:
            if matches(row) and within(row['created_at']) and shift_id is None and row['status'] in {'pending_review', 'pending_management'}:
                if status is None or row['status'] == status:
                    reviews.append(brief(row, collection, metric_at=row['created_at']))

    trends = []
    day = start
    while day < end:
        next_day = day + timedelta(days=1)
        day_lower, day_upper = bounds(day, next_day)
        rows = [r for r in scheduled if day_lower <= stamp(r['metric_at']) < day_upper]
        done = [r for r in rows if r['status'] == 'completed']
        on_time = [r for r in done if stamp(r.get('completed_at')) and stamp(r.get('due_at')) and stamp(r['completed_at']) <= stamp(r['due_at'])]
        trends.append({'date': day.isoformat(), 'completion': ratio(len(done), len(rows)), 'count': len(rows),
                       'on_time': len(on_time), 'not_done': sum(r['status'] == 'not_done' for r in rows),
                       'overdue': sum(r['status'] == 'overdue' for r in rows), 'ids': [r['id'] for r in rows]})
        day = next_day
    sections = {'tasks': tasks, 'handovers': handovers, 'incidents': incidents,
                'memories': memories, 'impressions': impressions, 'family': family, 'photo_reviews': reviews}
    if sum(map(len, sections.values())) > 10000:
        raise DomainError('dashboard_narrow_range_required', 422)
    pending_tasks = [r for r in tasks if r['status'] in {'pending', 'in_progress', 'overdue'}]
    cards = {
        'pending_tasks': pending_tasks,
        'overdue_tasks': [r for r in tasks if r['status'] == 'overdue'],
        'pending_handovers': [r for r in handovers if r['status'] != 'received'],
        'untriaged_incidents': [r for r in incidents if r['status'] == 'reported'],
        'pending_rectification_review': [r for r in incidents if r['status'] == 'awaiting_review'],
        'pending_reviews': reviews + [r for r in memories if r['status'] in {'candidate', 'review_required', 'review_due'}]
            + [r for r in impressions if r['status'] == 'candidate'] + [r for r in family if r['kind'] == 'summary' and r['status'] == 'draft'],
    }
    distributions = {name: _group(rows, 'status') for name, rows in sections.items()}
    distributions['incident_categories'] = _group(incidents, 'category')
    distributions['family_kind'] = _group(family, 'kind')
    pending = {row['kind'] + ':' + row['id']: dict(row)
               for rows in cards.values() for row in rows}
    for row in incidents + family:
        if (row['kind'] == 'incident' and row['status'] != 'closed'
                or row['kind'] == 'feedback' and row['status'] != 'closed'):
            pending[row['kind'] + ':' + row['id']] = dict(row)
    for row in pending.values():
        due = stamp(row.get('due_at'))
        row['overdue'] = bool(due and due < instant)
        if row['kind'] == 'incident' and row['status'] == 'reported':
            priority, reason = 0, '事件尚未人工分级，优先核实'
        elif row.get('severity') == 'high':
            priority, reason = 1, '人工已标记为高风险事件'
        elif row['overdue']:
            priority, reason = 2, '超过处理期限'
        else:
            priority, reason = 3, '按处理期限及登记时间排列'
        row.update(priority_order=priority, priority_reason=reason)
    pending = sorted(pending.values(), key=lambda row: (
        row['priority_order'], stamp(row.get('due_at')) or upper + timedelta(days=367),
        stamp(row.get('metric_at')) or upper, row['id']))
    return {'as_of': instant.isoformat(), 'timezone': 'Asia/Shanghai',
        'filters': {'start_inclusive': lower.isoformat(), 'end_exclusive': upper.isoformat(),
                    'elder_id': elder_id, 'shift_id': shift_id, 'status': status},
        'cards': {key: {'count': len(rows), 'items': rows} for key, rows in cards.items()},
        'distributions': distributions, 'task_trend': trends,
        'pending_work': {'count': len(pending), 'items': pending,
            'definition': '去除重复卡片事项后按待分级事件、人工高风险、逾期、期限排序；不是AI风险评分。'},
        'details': {key: {'count': len(rows), 'items': rows} for key, rows in sections.items()},
        'excluded': {'future_trend_task_rows': excluded_future, 'invalid_task_time_rows': invalid},
        'definitions': {
            'snapshot': '图表与明细来自同一次服务器快照；展示当前处理状态，不重建历史时点状态。刷新期间状态变化会改变结果。',
            'time': '日期按北京时间左闭右开。任务按计划服务时间（人工任务按期限、无期限按建立时间），交班按提交时间，事件按发生时间，其他按建立时间。',
            'task_trend': '仅已生成且已到服务时间的计划事项进入完成率分母，取消仍计入；补发只计最后一项。分母为0时返回null。人工任务不计入计划完成率。',
            'pending': '待处理卡片受同一日期、老人、班次和状态筛选约束；未来期限任务可在待办卡展示，但不计入执行趋势。',
            'shift': '无直接班次的事件、记忆与简报仅按明确引用的来源记录关联；无明确来源的反馈、照片和跨班印象在班次筛选时排除。',
            'personalization': '印象候选与正式记忆分别计数，不能相加当作去重老人数量或宣称照护质量。',
            'safety': '类别与等级来自人工分级；无分级显示待分级，不依据记录数量认定事故、漏护或服务实际发生。',
        }}


def dashboard(store, start, end, user_id, role, elder_id=None, shift_id=None, status=None):
    bounds(start, end)
    data = store.read()
    current_staff(data, user_id, role, management=True)
    if elder_id:
        find(data, 'elders', elder_id, 'elder_not_found')
    if shift_id:
        find(data, 'shifts', shift_id, 'shift_not_found')
    instant = parse_time(now())
    result = _build(data, start, end, instant, elder_id, shift_id, status)
    try:
        previous_start = start - (end - start)
    except OverflowError as exc:
        raise DomainError('report_comparison_date_out_of_range', 422) from exc
    previous = _build(data, previous_start, start, instant, elder_id, shift_id, status)
    for key, card in result['cards'].items():
        count = previous['cards'][key]['count']
        card.update(previous_count=count, change=card['count'] - count,
                    change_ratio=(card['count'] - count) / count if count else None)
    result['comparison'] = {'filters': previous['filters'], 'cards': previous['cards'],
        'definition': '与相邻的同天数窗口按相同筛选和当前处理状态比较；并非还原上一周期末的积压。前值为0时变化比例为null。'}
    return result
