"""One authorized business row per object, with notification state as metadata."""
from copy import deepcopy
from datetime import datetime, timezone

from app.services import followup_service, notification_service
from app.services.elder_workspace_service import TransactionStore
from app.services.workflow import current_staff, now, parse_time

COLLECTIONS = {'incident': 'incidents', 'change': 'change_reviews', 'quality': 'quality_checks'}
DECISIONS = {'task': 'care_tasks', 'memory': 'care_memories', 'assessment': 'assessments',
             'understanding': 'elder_impressions', 'care_advice': 'care_advice',
             'organising': 'care_jobs', 'followup': 'care_records', 'plan': 'automation_rules'}
PATHS = {'care_tasks': '/tasks/', 'incidents': '/incidents/', 'change_reviews': '/change-reviews/',
         'handovers': '/handovers/', 'care_memories': '/memories/', 'attachments': '/attachments/',
         'image_analyses': '/attachments/analyses/'}


def object_path(kind, obj):
    if kind in PATHS:
        return PATHS[kind] + obj['id']
    if kind == 'family_cases':
        return '/family/cases?elder_id=' + obj['elder_id'] + '&kind=' + obj['kind']
    if kind in {'care_advice', 'elder_impressions'}:
        return '/elders/' + obj['elder_id'] + ('/care-advice/' if kind == 'care_advice' else '/impressions/') + obj['id']
    return '/elders/' + obj.get('elder_id', '')


def listing(store, user_id, role, queue=None, elder_id=None, limit=100, offset=0):
    # Reuse durable reminder materialization, then project everything from one snapshot.
    notification_service.listing(store, user_id, role, limit=1)
    data = store.read()
    current_staff(data, user_id, role)
    snapshot = TransactionStore(deepcopy(data))
    followups = followup_service.listing(snapshot, user_id, role, elder_id)['items']
    notices = notification_service.listing(snapshot, user_id, role, limit=len(data['notifications']) + 1, materialize=False)['items']
    if elder_id is not None:
        notices = [n for n in notices if n.get('elder_id') == elder_id]
    rows = {}
    for item in followups:
        kind = COLLECTIONS.get(item['kind'])
        if item['kind'] == 'decision':
            kind = DECISIONS.get(item.get('context', {}).get('decision_kind'), 'decision')
        object_id = item['object_id'].split(':', 1)[0] if kind == 'elder_impressions' else item['object_id']
        key = (kind or item['kind'], object_id)
        related_context = {**deepcopy(item.get('context', {})), 'original_object_id': item['object_id']}
        if key in rows:
            rows[key]['reasons'].append(item['title'])
            rows[key]['related_contexts'].append(related_context)
            continue
        rows[key] = {**deepcopy(item), 'id': ':'.join(key), 'object_type': key[0],
                     'object_id': object_id, 'related_contexts': [related_context],
                     'notification_ids': [], 'unread': False, 'priority': 'urgent' if kind == 'incidents' and item['state'] != 'closed' else 'normal',
                     'reasons': [item['title']]}
    names = {e['id']: e.get('name', '') for e in data['elders']}
    for notice in notices:
        key = (notice['object_type'], notice['object_id'])
        kind, obj = notification_service._target(data, key[1])
        if obj is None:
            continue
        recipients, stage, title = notification_service._pending(data, kind, obj)
        if key not in rows:
            # A past notice is history, never a new assignment to its old recipient.
            state = 'closed' if stage == 'closed' else 'pending'
            path = object_path(kind, obj)
            from app.services.workflow_context_service import action, hint
            workflow = hint('已处理' if state == 'closed' else '待处理',
                            action('open', '查看并办理', path, 'GET') if user_id in recipients else None,
                            obj.get('assigned_to'), (role,))
            if kind == 'care_tasks':
                from app.services.presentation_service import task_context
                from app.services.task_service import task_view
                workflow = task_context(data, task_view(obj), user_id, role)['workflow']
            elif kind == 'change_reviews':
                from app.services.workflow_context_service import change_workflow
                workflow = change_workflow(obj, user_id, role)
            rows[key] = {'id': ':'.join(key), 'object_type': kind, 'object_id': obj['id'],
                         'elder_id': obj.get('elder_id'), 'elder_name': names.get(obj.get('elder_id'), '机构事项'),
                         'title': obj.get('title') or obj.get('description') or title, 'status': obj.get('status'),
                         'state': state, 'due_at': obj.get('due_at'), 'path': path, 'workflow': workflow,
                         'notification_ids': [], 'unread': False, 'priority': notice['priority'], 'reasons': [title]}
        row = rows[key]
        row['business_stage'] = stage
        row['notification_ids'].append(notice['id'])
        row['unread'] = row['unread'] or notice.get('read_at') is None
    for row in rows.values():
        primary = (row.get('workflow') or {}).get('primary_action')
        review = primary and (primary['code'] in {'review', 'resolve'} or
                             row.get('business_stage') in {'summary_review', 'memory_review', 'advice_review',
                                                           'photo_review', 'impression_review', 'review', 'awaiting_review'})
        row['queue'] = 'processed' if row['state'] == 'closed' else 'review' if review else 'mine' if primary else 'waiting'
        row['notification_ids'] = sorted(set(row['notification_ids']))
    items = list(rows.values())
    counts = {key: sum(r['queue'] == key for r in items) for key in ('mine', 'review', 'waiting', 'processed')}
    def order(row):
        try:
            due = parse_time(row['due_at']) if row.get('due_at') else None
        except (ValueError, TypeError):
            due = None
        return (row['priority'] != 'urgent', due if due and due.utcoffset() is not None else datetime.max.replace(tzinfo=timezone.utc), row['id'])
    items = sorted((r for r in items if queue is None or r['queue'] == queue), key=order)
    from app.services.presentation_service import empty_state
    return {'items': items[offset:offset + limit], 'total': len(items), 'counts': counts,
            'limit': limit, 'offset': offset, 'filters': {'queue': queue, 'elder_id': elder_id},
            'timezone': 'Asia/Shanghai', 'as_of': now(), 'contract_version': 1,
            'empty_state': empty_state(len(items), offset),
            'notice': '每个业务对象只列一次；已读和接单不会完成业务。'}
