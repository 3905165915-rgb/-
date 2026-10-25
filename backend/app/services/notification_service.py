"""Transactional business inbox. Reading/receiving never completes the business."""
import copy

from app.services.workflow import current_staff, find, identifier, now, replayable, DomainError


def _managers(data):
    return {u['id'] for u in data['users'] if u.get('active', True) and u['role'] in {'admin', 'supervisor'}}


def _target(data, object_id):
    for collection in ('care_tasks', 'incidents', 'care_memories', 'change_reviews', 'family_cases',
                       'handovers', 'handover_items', 'attachments', 'image_analyses', 'elder_impressions'):
        row = next((r for r in data[collection] if r['id'] == object_id), None)
        if row:
            if collection == 'handover_items':
                return 'handovers', find(data, 'handovers', row['handover_id'], 'handover_not_found')
            return collection, row
    return None, None


def _pending(data, kind, row):
    """Return recipients, stage and Chinese label from current authoritative state."""
    managers = _managers(data)
    status = row.get('status')
    if kind == 'care_tasks' and status not in {'completed', 'not_done', 'cancelled'}:
        return ({row['assigned_to']} if row.get('assigned_to') else managers), 'task', '待执行任务'
    if kind == 'incidents':
        rect = next((r for r in data['rectifications'] if r['incident_id'] == row['id']), None)
        if status == 'reported':
            return managers, 'triage', '安全事件待分级'
        if status != 'closed' and rect:
            if rect['status'] == 'awaiting_review':
                submitter = rect['submissions'][-1]['by'] if rect['submissions'] else None
                return managers - {submitter}, 'review', '整改待独立复查'
            return {rect['assigned_to']}, 'rectify', '待提交整改结果'
    if kind == 'care_memories' and status in {'candidate', 'pending_review', 'review_required'}:
        return managers, 'memory_review', '个性化信息待核实'
    if kind == 'care_memories' and status == 'confirmed':
        from app.services.memory_service import _view
        if _view(data, row)['review_state'] == 'pending':
            return managers, 'memory_review', '个性化信息待复核'
    if kind == 'change_reviews' and status != 'closed':
        return (managers if status == 'awaiting_review' or not row.get('assigned_to') else {row['assigned_to']}), status, '照护变更待核验'
    if kind == 'family_cases':
        if row.get('kind') == 'summary' and status == 'draft':
            return managers, 'summary_review', '家属简报待审核'
        if row.get('kind') == 'feedback' and status != 'closed':
            return managers, 'feedback', '家属反馈待回复'
    if kind == 'handovers' and status in {'submitted', 'received'}:
        items = [r for r in data['handover_items'] if r['handover_id'] == row['id']]
        question = any(r['status'] == 'clarifying' for r in items)
        if question or any(r['status'] != 'received' for r in items):
            side = 'source' if question else 'target'
            shift = find(data, 'shifts', row[side + '_shift_id'], 'shift_not_found')
            return set(shift['caregiver_ids']) | managers, 'clarify' if question else 'receive', '交班待澄清' if question else '交班待接收'
    if kind in {'attachments', 'image_analyses'} and status in {'pending_review', 'pending_management'}:
        return managers, 'photo_review', '照片观察待审核'
    if kind == 'elder_impressions' and any(p['status'] == 'candidate' for p in row.get('points', [])):
        return managers, 'impression_review', '老人印象待核实'
    return set(), 'closed', '已处理'


def project(data, event):
    """Called by audit while the business transaction lock is held. No I/O."""
    if any(n['source_event_id'] == event['id'] for n in data['notifications']):
        return
    kind, row = _target(data, event['object_id'])
    if row is None:
        return
    recipients, stage, title = _pending(data, kind, row)
    recipients &= {u['id'] for u in data['users'] if u.get('active', True) and u['role'] != 'family'}
    # Revision and audit ID distinguish a fresh return/reassignment even when a
    # legacy object does not increment its parent revision for child actions.
    for item in data['notifications']:
        if item['object_id'] == row['id'] and item['status'] != 'closed':
            item.update(status='closed', closed_at=event['created_at'], close_reason='业务状态已更新', revision=item['revision'] + 1)
    for recipient in sorted(recipients):
        dedup = f"{event['id']}:{recipient}"
        if any(n['dedup_key'] == dedup for n in data['notifications']):
            continue
        data['notifications'].append({'id': identifier('NOTICE'), 'recipient_id': recipient,
            'object_type': kind, 'object_id': row['id'], 'elder_id': row.get('elder_id'),
            'title': title, 'stage': stage, 'status': 'pending', 'read_at': None,
            'accepted_at': None, 'created_at': event['created_at'], 'revision': 1,
            'dedup_key': dedup, 'source_event_id': event['id'],
            'returned': event['action'] in {'review_rectification', 'review_change_review'} and event.get('decision') == 'return'})


def _visible(data, item, user_id, role):
    if item['recipient_id'] != user_id:
        return False
    kind, row = _target(data, item['object_id'])
    if row is None:
        return False
    if role in {'admin', 'supervisor'}:
        return True
    if kind == 'care_tasks':
        return row.get('assigned_to') == user_id
    if kind == 'incidents':
        from app.services.incident_service import access
        try:
            access(data, row, user_id, role)
            return True
        except DomainError:
            return False
    if kind == 'handovers':
        from app.services.handover_service import access
        try:
            access(data, row, user_id, role)
            return True
        except DomainError:
            return False
    if kind == 'change_reviews':
        return row.get('assigned_to') == user_id
    return False


def listing(store, user_id, role, unread=False, pending=False, limit=100, offset=0):
    data = store.read()
    current_staff(data, user_id, role)
    # Calendar-based reminders have no user mutation to trigger audit projection.
    # Materialize each distinct review trigger once so refreshes stay durable.
    from app.services.memory_service import _view
    import hashlib
    def missing_notifications(snapshot):
        # Schema upgrades retain pre-existing open work. Surface that work once,
        # without replaying historical side effects or requiring users to edit it.
        known = {n['object_id'] for n in snapshot['notifications']}
        result = []
        for kind in ('care_tasks', 'incidents', 'care_memories', 'change_reviews', 'family_cases',
                     'handovers', 'attachments', 'image_analyses', 'elder_impressions'):
            for row in snapshot[kind]:
                if row['id'] in known:
                    continue
                recipients, _, _ = _pending(snapshot, kind, row)
                if recipients:
                    result.append({'id': 'INBOX-' + hashlib.sha256((kind + ':' + row['id']).encode()).hexdigest()[:24],
                                   'action': 'initialize_pending_notification', 'object_id': row['id'],
                                   'elder_id': row.get('elder_id'), 'user_id': 'system', 'created_at': now()})
        return result
    def pending_reminders(snapshot):
        events = {r['id'] for r in snapshot['audit_logs']}
        result = []
        for memory in snapshot['care_memories']:
            if memory['status'] != 'confirmed':
                continue
            view = _view(snapshot, memory)
            if view['review_state'] != 'pending':
                continue
            token = hashlib.sha256(str((memory['id'], memory['revision'], sorted(view['review_reasons']))).encode()).hexdigest()[:24]
            event_id = 'REMINDER-' + token
            if event_id not in events:
                result.append({'id': event_id, 'action': 'memory_review_reminder', 'object_id': memory['id'],
                               'elder_id': memory['elder_id'], 'user_id': 'system', 'created_at': now()})
        return result
    if missing_notifications(data) or pending_reminders(data):
        def refresh(fresh):
            current_staff(fresh, user_id, role)
            for event in missing_notifications(fresh):
                fresh['audit_logs'].append(event)
                project(fresh, event)
            for event in pending_reminders(fresh):
                fresh['audit_logs'].append(event)
                project(fresh, event)
        store.mutate(refresh)
        data = store.read()
    rows = [copy.deepcopy(n) for n in reversed(data['notifications']) if _visible(data, n, user_id, role)
            and (not unread or n['read_at'] is None) and (not pending or n['status'] != 'closed')]
    for row in rows:
        row.pop('dedup_key', None)
    return {'items': rows[offset:offset + limit], 'total': len(rows), 'offset': offset, 'limit': limit,
            'as_of': now(), 'definition': '已读和接单仅为通知状态；完成、退回、关闭必须通过关联业务操作。'}


def act(store, item_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'notifications', item_id, 'notification_not_found')
        if not _visible(data, item, user_id, role):
            raise DomainError('notification_not_authorized', 403)
        def operation():
            from app.services.facility_service import version
            version(item, payload.expected_revision)
            if payload.action == 'accept' and item['status'] == 'closed':
                raise DomainError('notification_business_already_changed')
            item['read_at'] = item['read_at'] or now()
            if payload.action == 'accept':
                item.update(status='accepted', accepted_at=now())
            item['revision'] += 1
            return {k: copy.deepcopy(v) for k, v in item.items() if k != 'dedup_key'}
        return replayable(data, user_id, 'notification_' + payload.action, key,
                          {'id': item_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
