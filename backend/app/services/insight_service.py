"""Evidence-based operational views. No inferred clinical facts or automatic edits."""
import copy
import hashlib
import json
from datetime import date, timedelta

from app.services import plan_service, report_service
from app.services.workflow import DomainError, audit, current_staff, find, now, parse_time


def coverage_from_data(data, elder_id, day):
    find(data, 'elders', elder_id, 'elder_not_found')
    rows = {}
    for plan in data['care_plans']:
        if plan['elder_id'] != elder_id or plan['status'] != 'active':
            continue
        for item, instant, key in plan_service.occurrences(plan, day):
            rows[key] = {'occurrence_key': key, 'plan_id': plan['id'], 'plan_revision': plan['revision'],
                         'title': item['title'], 'requirement': item['instruction'], 'scheduled_at': instant.isoformat(),
                         'tasks': [], 'evidence': []}
    tasks = [row for row in data['care_tasks'] if row['elder_id'] == elder_id and
             row.get('service_date') == day.isoformat() and row.get('occurrence_key')]
    for task in tasks:
        key = task['occurrence_key']
        snapshot = task.get('source_plan_snapshot') or {}
        item = snapshot.get('item') or {}
        entry = rows.setdefault(key, {'occurrence_key': key, 'plan_id': task.get('source_plan_id'),
             'plan_revision': task.get('source_plan_revision'), 'title': task['title'],
             'requirement': item.get('instruction'), 'scheduled_at': task.get('scheduled_at'), 'tasks': [], 'evidence': []})
        entry['tasks'].append({name: task.get(name) for name in ('id', 'status', 'revision', 'assigned_to', 'result',
             'source_record_id', 'completed_at', 'replaces_task_id', 'due_at')})
        source = next((row for row in data['care_records'] if row['id'] == task.get('source_record_id') and row['elder_id'] == elder_id), None)
        if source:
            entry['evidence'].append({'record_id': source['id'], 'revision': source.get('revision', 1),
                  'observations': source.get('observations', []), 'link_type': 'task_creation_source_not_completion_proof'})
    for row in rows.values():
        replaced = {task['replaces_task_id'] for task in row['tasks'] if task['replaces_task_id']}
        current = [task for task in row['tasks'] if task['id'] not in replaced]
        if len(current) > 1:
            raise DomainError('ambiguous_plan_occurrence_chain')
        task = current[0] if current else None
        row['current_task_id'] = task['id'] if task else None
        row['coverage_status'] = ('covered' if task and task['status'] == 'completed' and task['result'] else
                                  'partial' if task and (task['result'] or row['evidence']) else 'missing_record')
        row['fingerprint'] = hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        reviews = [event for event in data['audit_logs'] if event['action'] == 'review_coverage' and
                   event.get('elder_id') == elder_id and event.get('occurrence_key') == row['occurrence_key']]
        row['human_reviews'] = [{**event, 'current': event.get('source_fingerprint') == row['fingerprint']} for event in reviews]
        latest = next((event for event in reversed(row['human_reviews']) if event['current']), None)
        if latest and latest['decision'] == 'not_applicable':
            row['coverage_status'] = 'not_applicable'
    lower, upper = report_service.bounds(day, day + timedelta(days=1))
    record_links = []
    for record in data['care_records']:
        observed = report_service.stamp(record.get('happened_at') or record.get('created_at'))
        if record['elder_id'] != elder_id or observed is None or not lower <= observed < upper:
            continue
        record_links.append({'record_id': record['id'], 'revision': record.get('revision', 1),
            'observations': record.get('observations', []),
            'linked_tasks': [{'id': task['id'], 'title': task['title'], 'status': task['status']}
                             for task in data['care_tasks'] if task.get('source_record_id') == record['id'] and task['elder_id'] == elder_id]})
    return {'elder_id': elder_id, 'service_date': day.isoformat(), 'as_of': now(), 'items': list(rows.values()),
            'record_task_links': record_links,
            'notice': '仅核对计划发生项、任务状态与已登记结果；来源记录仅证明建任务依据。缺记录不等于未服务，完成结果不代表医学达标。'}


def coverage(store, elder_id, day, user_id, role):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    return coverage_from_data(data, elder_id, day)


def review_coverage(store, payload, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        snapshot = coverage_from_data(data, payload.elder_id, payload.service_date)
        row = next((r for r in snapshot['items'] if r['occurrence_key'] == payload.occurrence_key), None)
        if row is None:
            raise DomainError('coverage_occurrence_not_found', 404)
        if row['fingerprint'] != payload.expected_fingerprint:
            raise DomainError('coverage_sources_changed_refresh')
        prior = next((event for event in reversed(data['audit_logs']) if event['action'] == 'review_coverage' and
                      event.get('source_fingerprint') == row['fingerprint']), None)
        if (not prior or prior['user_id'] != user_id or prior.get('detail') != payload.note
                or prior.get('decision') != payload.decision):
            audit(data, 'review_coverage', row['current_task_id'] or row['plan_id'], user_id,
                  elder_id=payload.elder_id, occurrence_key=payload.occurrence_key, decision=payload.decision,
                  source_fingerprint=row['fingerprint'], detail=payload.note)
        return coverage_from_data(data, payload.elder_id, payload.service_date)
    return store.mutate(mutate)


def changes(store, user_id, role, since=None, elder_id=None, limit=100, offset=0):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    if elder_id:
        find(data, 'elders', elder_id, 'elder_not_found')
    instant = parse_time(now())
    start = since or (instant - timedelta(days=1))
    if start > instant:
        raise DomainError('changes_since_must_not_be_future', 422)
    acknowledgements = {key for row in data['audit_logs'] if row['action'] == 'acknowledge_changes' and row['user_id'] == user_id
                        for key in row.get('event_ids', [])}
    events = [{**row, 'acknowledged': row['id'] in acknowledgements} for row in reversed(data['audit_logs'])
              if row['action'] not in {'acknowledge_changes', 'review_coverage'} and
              report_service.stamp(row.get('created_at')) is not None and parse_time(row['created_at']) >= start and
              (not elder_id or row.get('elder_id') == elder_id)]
    pending = [{'id': row['id'], 'elder_id': row['elder_id'], 'title': row['title'], 'status': row['status'],
                'assigned_to': row.get('assigned_to'), 'due_at': row.get('due_at')}
               for row in data['care_tasks'] if row['status'] not in {'completed', 'cancelled'} and
               (not elder_id or row['elder_id'] == elder_id)]
    return {'as_of': instant.isoformat(), 'since': start.isoformat(), 'total_events': len(events),
            'events': events[offset:offset + limit], 'offset': offset, 'limit': limit, 'has_more': offset + limit < len(events),
            'unresolved_tasks': pending, 'notice': '已读只代表此账号已查看该事件，不会完成任务或隐藏重要遗留。'}


def acknowledge(store, event_ids, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        valid = {row['id'] for row in data['audit_logs'] if row['action'] not in {'acknowledge_changes', 'review_coverage'}}
        if not set(event_ids).issubset(valid):
            raise DomainError('change_event_not_found', 404)
        existing = {key for row in data['audit_logs'] if row['action'] == 'acknowledge_changes' and row['user_id'] == user_id
                    for key in row.get('event_ids', [])}
        new = sorted(set(event_ids) - existing)
        if new:
            audit(data, 'acknowledge_changes', user_id, user_id, event_ids=new)
        return {'event_ids': event_ids, 'acknowledged': True, 'task_status_changed': False}
    return store.mutate(mutate)


def plan_impact(store, plan_id, user_id, role):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    plan = find(data, 'care_plans', plan_id, 'plan_not_found')
    old = find(data, 'care_plans', plan['supersedes_id'], 'plan_not_found') if plan.get('supersedes_id') else None
    before = {item['key']: item for item in old['items']} if old else {}
    after = {item['key']: item for item in plan['items']}
    differences = [{'key': key, 'before': before.get(key), 'after': after.get(key)} for key in sorted(before.keys() | after.keys())
                   if before.get(key) != after.get(key)]
    instant = parse_time(now())
    series_ids = {row['id'] for row in data['care_plans'] if row['elder_id'] == plan['elder_id'] and row.get('series_id') == plan.get('series_id')}
    tasks = [row for row in data['care_tasks'] if row['elder_id'] == plan['elder_id'] and row.get('source_plan_id') in series_ids]
    future = [copy.deepcopy(row) for row in tasks if row['status'] not in {'completed', 'cancelled'} and
              report_service.stamp(row.get('scheduled_at')) is not None and parse_time(row['scheduled_at']) >= instant]
    return {'plan_id': plan_id, 'plan_revision': plan['revision'], 'previous_plan_id': old['id'] if old else None,
            'differences': differences, 'future_tasks_requiring_human_review': future,
            'plan_scope_diff': {'before': {key: old.get(key) for key in ('title', 'goal', 'starts_on', 'ends_on', 'assessment_id')} if old else None,
                                'after': {key: plan.get(key) for key in ('title', 'goal', 'starts_on', 'ends_on', 'assessment_id')}},
            'historical_completed_task_ids': [row['id'] for row in tasks if row['status'] == 'completed'],
            'affected_shift_ids': sorted({row['shift_id'] for row in future if row.get('shift_id')}),
            'notice': '只读预览，不自动改写、取消或重开任何任务。已完成任务及其原计划快照保持不变；审批新版本后仍须人工处理旧待办。'}
