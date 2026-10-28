from __future__ import annotations

import copy

from app.services.workflow import DomainError, active_staff, audit, current_staff, find, identifier, now, open_shift, parse_time, replayable
from app.services import task_condition_service
from app.services import plan_service


def create_shift(store, payload, user_id, key=None):
    def mutate(data):
        current_staff(data, user_id, management=True)
        def operation():
            for user in payload.caregiver_ids:
                active_staff(data, user)
            members = set(payload.caregiver_ids)
            for shift in data['shifts']:
                if members.intersection(shift['caregiver_ids']) and payload.start_at < parse_time(shift['end_at']) and payload.end_at > parse_time(shift['start_at']):
                    raise DomainError('overlapping_shift_for_staff')
            item = {'id': identifier('SHIFT'), **payload.model_dump(mode='json'),
                    'status': 'open', 'created_by': user_id, 'created_at': now()}
            data['shifts'].append(item)
            audit(data, 'create_shift', item['id'], user_id, detail=payload.name)
            return dict(item)
        return replayable(data, user_id, 'create_shift', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def access(data, handover, user_id, role, side=None):
    if role in {'admin', 'supervisor'}:
        return
    fields = [f'{side}_shift_id'] if side else ['source_shift_id', 'target_shift_id']
    if not any(user_id in find(data, 'shifts', handover[field], 'shift_not_found')['caregiver_ids'] for field in fields):
        raise DomainError('not_a_handover_shift_member', 403)


def view(data, item):
    return {**item, 'items': [dict(row) for row in data['handover_items'] if row['handover_id'] == item['id']]}


def role_view(data, item, user_id, role):
    full = view(data, item)
    if role in {'admin', 'supervisor'}:
        return full
    from app.services.care_scope_service import require_elder_access
    visible = []
    for row in full['items']:
        try:
            require_elder_access(data, row['elder_id'], user_id, role)
        except DomainError:
            continue
        safe = {key: row.get(key) for key in
                ('id', 'handover_id', 'kind', 'elder_id', 'source_id', 'source_revision', 'detail', 'status')}
        safe['clarifications'] = [{key: note.get(key) for key in ('kind', 'note')}
                                  for note in row.get('clarifications', [])]
        if row['kind'] == 'task':
            safe.update({key: copy.deepcopy(row.get(key)) for key in
                         ('memory_references', 'condition_check', 'condition_verification',
                          'plan_check', 'source_plan_snapshot')})
        visible.append(safe)
    visible_ids = {row['source_id'] for row in visible}
    all_items_authorized = bool(full['items']) and len(visible) == len(full['items'])
    # With no saved shift items, the author must still be able to review their
    # own freshly typed note. Do not expose that free text to another caregiver
    # or relax filtering when any source item is outside the reader's scope.
    own_note_only = not full['items'] and (full.get('ai_summary') or {}).get('created_by') == user_id
    if all_items_authorized or own_note_only:
        visible_ids.add('handover-text')
    summary = ''
    ai_summary = None
    raw = full.get('ai_summary')
    if raw:
        points = [point for point in raw.get('points', [])
                  if point.get('citations') and all(c['source_id'] in visible_ids for c in point['citations'])]
        ai_summary = {key: raw.get(key) for key in ('status', 'provider', 'created_at')}
        ai_summary.update(points=copy.deepcopy(points), text='\n'.join(point['text'] for point in points),
                          warnings=copy.deepcopy(raw.get('warnings', [])))
        if raw.get('status') in {'confirmed', 'pending_review'}:
            summary = ai_summary['text']
    return {'id': full['id'], 'source_shift_id': full['source_shift_id'],
            'target_shift_id': full['target_shift_id'], 'status': full['status'],
            'revision': full['revision'], 'summary': summary, 'items': visible,
            'ai_summary': ai_summary,
            'handover_suggestions': copy.deepcopy((raw or {}).get('task_suggestions', []))
                if all_items_authorized else []}


def get(store, handover_id, user_id, role):
    data = store.read()
    item = find(data, 'handovers', handover_id, 'handover_not_found')
    access(data, item, user_id, role)
    return role_view(data, item, user_id, role)


def list_handovers(store, user_id, role, shift_id=None, limit=100, offset=0):
    data = store.read()
    items = []
    for item in reversed(data['handovers']):
        if shift_id and shift_id not in {item['source_shift_id'], item['target_shift_id']}:
            continue
        try:
            access(data, item, user_id, role)
        except DomainError:
            continue
        items.append(role_view(data, item, user_id, role))
    return items[offset:offset+limit]


def sources(data, shift_id):
    records = [row for row in data['care_records'] if row.get('shift_id') == shift_id]
    ids = {row['id'] for row in records}
    tasks = [row for row in data['care_tasks'] if row['status'] not in {'completed', 'cancelled'}
             and (row.get('shift_id') == shift_id or (row.get('shift_id') is None and row.get('source_record_id') in ids))]
    return records, tasks


def rebuild(data, item):
    at = now()
    records, tasks = sources(data, item['source_shift_id'])
    data['handover_items'] = [row for row in data['handover_items'] if row['handover_id'] != item['id']]
    for kind, rows in [('record', records), ('task', tasks)]:
        for row in rows:
            detail = '；'.join(row.get('observations', [])) if kind == 'record' else row['title']
            if kind == 'task':
                detail += ''.join(f'；{label}：{row[field]}' for field, label in [('condition', '条件'), ('due_text', '原文时间'), ('due_at', '截止时间')]
                                  if row.get(field))
                if row.get('condition'):
                    checked = task_condition_service.state_from_data(data, row, at)
                    checker = next((user for user in data['users'] if user['id'] == checked['checker_id']), None)
                    checker_name = checker.get('display_name', checker['id']) if checker else '待认领'
                    detail += f'；条件核验：{task_condition_service.STATE_LABELS[checked["state"]]}；核验人：{checker_name}'
                if row.get('source_plan_id'):
                    state = plan_service.task_state(data, row, at)
                    detail += '；计划依据：' + ('当前有效' if state['ready'] else '需主管复核')
            data['handover_items'].append({
                'id': identifier('HI'), 'handover_id': item['id'], 'kind': kind,
                'elder_id': row['elder_id'], 'source_id': row['id'], 'source_revision': row.get('revision', 1),
                'detail': detail, 'condition': row.get('condition'), 'status': 'pending',
                'clarifications': [], 'received_at': None, 'received_by': None,
                'memory_references': copy.deepcopy(row.get('memory_references', [])) if kind == 'task' else [],
                'condition_verification': copy.deepcopy(row.get('condition_verification')) if kind == 'task' else None,
                'condition_check': task_condition_service.state_from_data(data, row, at) if kind == 'task' and row.get('condition') else None,
                'plan_check': plan_service.task_state(data, row, at) if kind == 'task' and row.get('source_plan_id') else None,
                'source_plan_snapshot': copy.deepcopy(row.get('source_plan_snapshot')) if kind == 'task' else None,
            })
    item['ai_summary'] = None
    item['revision'] += 1


def create(store, payload, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role)
        source = find(data, 'shifts', payload.source_shift_id, 'source_shift_not_found')
        target = find(data, 'shifts', payload.target_shift_id, 'target_shift_not_found')
        item = {**payload.model_dump()}
        access(data, item, user_id, role, 'source')
        existing = next((row for row in data['handovers'] if row['source_shift_id'] == source['id'] and row['target_shift_id'] == target['id']), None)
        if existing:
            return view(data, existing)
        if source['status'] != 'open' or target['status'] != 'open':
            raise DomainError('handover_requires_open_shifts')
        if parse_time(target['start_at']) <= parse_time(source['start_at']):
            raise DomainError('target_shift_must_start_later', 422)
        item.update(id=identifier('HO'), status='draft', revision=0, created_by=user_id, created_at=now(), summary='')
        data['handovers'].append(item)
        rebuild(data, item)
        audit(data, 'create_handover', item['id'], user_id, detail='生成交班草稿')
        return view(data, item)
    return store.mutate(mutate)


def refresh(store, handover_id, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'handovers', handover_id, 'handover_not_found')
        access(data, item, user_id, role, 'source')
        if item['status'] != 'draft':
            raise DomainError('only_draft_handover_can_refresh')
        open_shift(data, item['source_shift_id'], user_id, role)
        rebuild(data, item)
        audit(data, 'refresh_handover', item['id'], user_id, detail='按最新正式记录和未完成任务刷新交班')
        return view(data, item)
    return store.mutate(mutate)


def assert_current(data, item):
    records, tasks = sources(data, item['source_shift_id'])
    expected = {(kind, row['id'], row.get('revision', 1)) for kind, rows in [('record', records), ('task', tasks)] for row in rows}
    actual = {(row['kind'], row['source_id'], row['source_revision']) for row in data['handover_items'] if row['handover_id'] == item['id']}
    if expected != actual:
        raise DomainError('handover_needs_refresh')
    at = now()
    by_id = {row['id']: row for row in tasks}
    for row in data['handover_items']:
        if row['handover_id'] == item['id'] and row['kind'] == 'task':
            task = by_id[row['source_id']]
            if task.get('condition') and row.get('condition_check') != task_condition_service.state_from_data(data, task, at):
                raise DomainError('handover_needs_refresh')
            if task.get('source_plan_id') and row.get('plan_check') != plan_service.task_state(data, task, at):
                raise DomainError('handover_needs_refresh')


def generate_summary(store, handover_id, expected_revision, user_id, role, text=''):
    from app.services.ai_service import get_ai_provider
    data = store.read()
    current_staff(data, user_id, role)
    item = find(data, 'handovers', handover_id, 'handover_not_found')
    access(data, item, user_id, role, 'source')
    if item['status'] != 'draft' or item['revision'] != expected_revision:
        raise DomainError('handover_not_draft_or_stale')
    open_shift(data, item['source_shift_id'], user_id, role)
    assert_current(data, item)
    inputs = [{'source_id': row['source_id'], 'text': row['detail'], 'elder_id': row['elder_id'],
               'kind': row['kind']} for row in data['handover_items'] if row['handover_id'] == handover_id]
    if text.strip():
        inputs.append({'source_id': 'handover-text', 'text': text.strip(), 'elder_id': None,
                       'kind': 'handover_text'})
    if sum(len(row['text']) for row in inputs) > 60000 or len(inputs) > 100:
        raise DomainError('ai_scope_too_large', 422)
    provider = get_ai_provider()
    output = provider.summarize(inputs)  # External calls never hold the JSON lock.
    suggestions = []
    if text.strip():
        extracted = provider.extract('', None, text.strip())
        suggestions = [{'id': identifier('HSUG'), 'title': row.get('title', ''),
                        'evidence_text': row.get('evidence_text') or text.strip(),
                        'condition': row.get('condition'), 'due_text': row.get('due_text')}
                       for row in extracted.task_candidates]
    def mutate(latest):
        current_staff(latest, user_id, role)
        current = find(latest, 'handovers', handover_id, 'handover_not_found')
        access(latest, current, user_id, role, 'source')
        if current['status'] != 'draft' or current['revision'] != expected_revision:
            raise DomainError('handover_changed_during_ai_call')
        open_shift(latest, current['source_shift_id'], user_id, role)
        assert_current(latest, current)
        cited = {citation['source_id'] for point in output['points'] for citation in point['citations']}
        missing_tasks = [row['source_id'] for row in inputs if row['kind'] == 'task' and row['source_id'] not in cited]
        current['ai_summary'] = {
            **output, 'text': '\n'.join(point['text'] for point in output['points']),
            'status': 'pending_review', 'provider': provider.name, 'created_by': user_id, 'created_at': now(),
            'input_text': text.strip(), 'task_suggestions': suggestions,
            'warnings': (['摘要未覆盖全部待办，请核对交接明细'] if missing_tasks else []) +
                        (['当前为演示结果，非真实AI推理'] if provider.name == 'mock' else []),
            'uncovered_task_ids': missing_tasks,
        }
        current['revision'] += 1
        audit(latest, 'generate_ai_summary', handover_id, user_id, detail='AI生成摘要，待人工确认',
              provider=provider.name, queue_record_job=False)
        return view(latest, current)
    return store.mutate(mutate)


def submit(store, handover_id, payload, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'handovers', handover_id, 'handover_not_found')
        access(data, item, user_id, role, 'source')
        if item['status'] != 'draft' or item['revision'] != payload.expected_revision:
            raise DomainError('handover_not_draft_or_stale')
        if find(data, 'shifts', item['source_shift_id'], 'shift_not_found')['status'] != 'open':
            raise DomainError('source_shift_already_closed')
        if find(data, 'shifts', item['target_shift_id'], 'shift_not_found')['status'] != 'open':
            raise DomainError('target_shift_closed')
        assert_current(data, item)
        if payload.approve_ai_summary:
            summary = item.get('ai_summary')
            if not summary or summary['status'] != 'pending_review':
                raise DomainError('no_pending_ai_summary')
            summary.update(status='confirmed', confirmed_by=user_id, confirmed_at=now())
            item['summary'] = payload.summary or summary['text']
        else:
            item['summary'] = payload.summary
            if item.get('ai_summary'):
                item['ai_summary']['status'] = 'not_used'
        if payload.accepted_tasks:
            summary = item.get('ai_summary')
            if not payload.approve_ai_summary or not summary or summary.get('status') != 'confirmed':
                raise DomainError('handover_task_suggestions_need_review')
            from app.models.entities import CareTask
            from app.services.care_scope_service import require_elder_access
            from app.services.workflow import active_staff
            suggestions = {row['id']: row for row in summary.get('task_suggestions', [])}
            source_item_elders = {row['elder_id'] for row in data['handover_items'] if row['handover_id'] == handover_id}
            for accepted in payload.accepted_tasks:
                suggestion = suggestions.get(accepted.suggestion_id)
                if not suggestion or not suggestion['evidence_text'] or suggestion['evidence_text'] not in summary.get('input_text', ''):
                    raise DomainError('handover_suggestion_source_invalid', 422)
                if accepted.elder_id not in source_item_elders:
                    raise DomainError('handover_task_elder_not_in_sources', 403)
                if accepted.shift_id != item['target_shift_id']:
                    raise DomainError('handover_task_must_target_incoming_shift', 422)
                target = find(data, 'shifts', accepted.shift_id, 'target_shift_not_found')
                if target['status'] != 'open' or accepted.assigned_to not in target['caregiver_ids']:
                    raise DomainError('assignee_not_in_target_shift', 422)
                due = accepted.due_at
                if due <= parse_time(now()) or not parse_time(target['start_at']) <= due < parse_time(target['end_at']):
                    raise DomainError('handover_task_due_outside_target_shift', 422)
                active_staff(data, accepted.assigned_to)
                assignee = find(data, 'users', accepted.assigned_to, 'assignee_not_found')
                require_elder_access(data, accepted.elder_id, accepted.assigned_to, assignee['role'])
                duplicate = next((row for row in data['care_tasks'] if row['elder_id'] == accepted.elder_id
                    and row.get('assigned_to') == accepted.assigned_to and row.get('due_at')
                    and row.get('status') not in {'completed', 'cancelled'} and row['title'] == accepted.title
                    and parse_time(row['due_at']) == due), None)
                if duplicate:
                    continue
                task = CareTask(id=identifier('TASK'), elder_id=accepted.elder_id, title=accepted.title,
                    completion_criteria=accepted.completion_criteria, due_at=due.isoformat(),
                    assigned_to=accepted.assigned_to, shift_id=target['id'], status='pending',
                    source_type='handover', source_id=handover_id, source_revision=item['revision'],
                    created_by=user_id, created_at=now(), updated_at=now(), condition=suggestion.get('condition'),
                    due_text=suggestion.get('due_text'))
                data['care_tasks'].append(task.model_dump())
                audit(data, 'create_task', task.id, user_id, elder_id=task.elder_id,
                      handover_id=handover_id, detail=task.title, queue_record_job=False)
        item.update(status='submitted', submitted_by=user_id, submitted_at=now(), revision=item['revision'] + 1)
        find(data, 'shifts', item['source_shift_id'], 'shift_not_found')['status'] = 'closed'
        audit(data, 'submit_handover', handover_id, user_id, detail='人工确认并提交交班单')
        if not any(row['handover_id'] == handover_id for row in data['handover_items']):
            item['status'] = 'received'
        return view(data, item)
    return store.mutate(mutate)


def receive(store, handover_id, item_id, payload, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role)
        handover = find(data, 'handovers', handover_id, 'handover_not_found')
        access(data, handover, user_id, role, 'target')
        item = find(data, 'handover_items', item_id, 'handover_item_not_found')
        if item['handover_id'] != handover_id:
            raise DomainError('handover_item_not_found', 404)
        if item['status'] == 'received':
            if payload.status == 'received':
                return view(data, handover)
            raise DomainError('received_item_cannot_be_reopened')
        if handover['status'] != 'submitted':
            raise DomainError('handover_must_be_submitted')
        if payload.status == 'clarifying':
            if not payload.note:
                raise DomainError('clarification_note_required', 422)
            item['clarifications'].append({'user_id': user_id, 'note': payload.note, 'created_at': now(), 'kind': 'question'})
            item['status'] = 'clarifying'
        else:
            if item['status'] == 'clarifying' and not payload.note and item['clarifications'][-1]['kind'] != 'reply':
                raise DomainError('clarification_needs_reply_or_resolution_note')
            if item['kind'] == 'task':
                task = find(data, 'care_tasks', item['source_id'], 'task_not_found')
                if task['status'] not in {'completed', 'cancelled'}:
                    target = find(data, 'shifts', handover['target_shift_id'], 'shift_not_found')
                    if target['status'] != 'open':
                        raise DomainError('target_shift_closed')
                    assignee = payload.assigned_to or (user_id if user_id in target['caregiver_ids'] else None)
                    if assignee is None or assignee not in target['caregiver_ids']:
                        raise DomainError('target_shift_assignee_required', 422)
                    active_staff(data, assignee)
                    before = copy.deepcopy(task)
                    task.update(shift_id=target['id'], assigned_to=assignee, continuity_key=task.get('continuity_key') or task['id'],
                                status='pending', reason_code=None, result=None, revision=task.get('revision', 1) + 1, updated_at=now())
                    task_condition_service.carry(data, task, user_id, task['updated_at'])
                    audit(data, 'carry_task', task['id'], user_id, elder_id=task['elder_id'], record_id=task.get('source_record_id'),
                          handover_id=handover_id, source_shift_id=handover['source_shift_id'], target_shift_id=target['id'],
                          detail='接班后延续原任务，不重复创建', before=before, after=copy.deepcopy(task))
            item.update(status='received', received_at=now(), received_by=user_id, receipt_note=payload.note)
        handover['revision'] += 1
        audit(data, 'receive_handover_item' if payload.status == 'received' else 'question_handover_item', item_id, user_id,
              elder_id=item['elder_id'], handover_id=handover_id, detail=payload.note or '已接收')
        if all(row['status'] == 'received' for row in data['handover_items'] if row['handover_id'] == handover_id):
            handover['status'] = 'received'
        return view(data, handover)
    return store.mutate(mutate)


def clarify(store, handover_id, item_id, note, user_id, role):
    def mutate(data):
        current_staff(data, user_id, role)
        handover = find(data, 'handovers', handover_id, 'handover_not_found')
        access(data, handover, user_id, role, 'source')
        item = find(data, 'handover_items', item_id, 'handover_item_not_found')
        if item['handover_id'] != handover_id:
            raise DomainError('handover_item_not_found', 404)
        if item['status'] != 'clarifying' or handover['status'] != 'submitted':
            raise DomainError('handover_item_is_not_clarifying')
        item['clarifications'].append({'user_id': user_id, 'note': note, 'created_at': now(), 'kind': 'reply'})
        audit(data, 'clarify_handover_item', item_id, user_id, elder_id=item['elder_id'], handover_id=handover_id, detail=note)
        handover['revision'] += 1
        return view(data, handover)
    return store.mutate(mutate)
