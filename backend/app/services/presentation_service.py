"""Minimal task display context; no grant to an elder's complete file."""
from copy import deepcopy


def bed_label(data, bed_id):
    bed = next((b for b in data['beds'] if b['id'] == bed_id), None)
    if not bed:
        return ''
    label, room = bed.get('label', ''), bed.get('room', '')
    return f'{room}房·{label}' if room and not label.startswith(room + '房') else label


def task_context(data, task, user_id=None, role=None):
    result = deepcopy(task)
    elder = next((e for e in data['elders'] if e['id'] == task.get('elder_id')), {})
    snapshot = task.get('display_snapshot') or data.get('task_display_snapshots', {}).get(task['id'], {})
    admission = next((a for a in data['admissions'] if a['id'] == task.get('admission_id')), None)
    # Resolve a legacy task only against its admission's dated bed history.
    historical_bed = ''
    if admission:
        from app.services.workflow import parse_time
        instant = task.get('scheduled_at') or task.get('created_at')
        try:
            at = parse_time(instant)
            stays = [stay for stay in admission.get('bed_stays', [])
                if parse_time(stay['started_at']) <= at and
                (not stay.get('ended_at') or at < parse_time(stay['ended_at']))]
            if len(stays) == 1:
                historical_bed = bed_label(data, stays[0].get('bed_id')) or (f"{stays[0].get('room', '')}房·{stays[0].get('label', '')}" if stays[0].get('room') and stays[0].get('label') else '')
            elif not admission.get('bed_stays'):
                historical_bed = bed_label(data, admission.get('bed_id'))
        except (KeyError, TypeError, ValueError):
            pass
    # Never guess the current bed for an unrelated historical admission.
    result.update(elder_name=snapshot.get('elder_name') or elder.get('name', ''),
                  bed_label=snapshot.get('bed_label') or historical_bed,
                  assignee_name=(snapshot.get('assignee_name', '') if snapshot.get('assigned_to') == task.get('assigned_to') and task['status'] in {'completed','cancelled'} else '') or next((u.get('display_name', '') for u in data['users'] if u['id'] == task.get('assigned_to')), ''),
                  shift_name=(snapshot.get('shift_name', '') if snapshot.get('shift_id') == task.get('shift_id') else '') or next((s.get('name', '') for s in data['shifts'] if s['id'] == task.get('shift_id')), ''))
    actions = []
    if task['status'] not in {'completed', 'cancelled'}:
        if role in {'admin', 'supervisor'} or task.get('assigned_to') in {None, user_id}:
            actions = ['reopen'] if task['status'] == 'not_done' else ['complete', 'not_done']
            if task['status'] in {'pending', 'overdue'}:
                actions.insert(0, 'start')
        if actions:
            actions.append('transfer')
        if role in {'admin', 'supervisor'}:
            actions.append('cancel')
    if actions:
        from app.services.workflow import open_shift, now, DomainError
        try:
            open_shift(data, task.get('shift_id'), user_id, role)
        except (DomainError, KeyError):
            actions = []
        if actions and task['status'] != 'not_done':
            from app.services.plan_service import assert_task_ready
            from app.services.task_condition_service import assert_ready
            from app.services.care_advice_service import assert_task_ready as advice_ready
            try:
                from app.services.facility_service import care_eligible
                care_eligible(data, task['elder_id'])
                assert_task_ready(data, task, now())
                assert_ready(data, task, now())
                advice_ready(data, task)
            except DomainError:
                actions = [a for a in actions if a not in {'start','complete'}]
    result['allowed_actions'] = actions
    return result


def capture_new_tasks(data, previous_ids):
    for task in data['care_tasks']:
        if task['id'] in previous_ids:
            continue
        if not task.get('elder_id'):
            continue
        elder = next((e for e in data['elders'] if e['id'] == task['elder_id']), {})
        data.setdefault('task_display_snapshots', {}).setdefault(task['id'], {
            'elder_name': elder.get('name', ''),
            'bed_label': bed_label(data, elder.get('bed_id')),
            'admission_id': task.get('admission_id') or elder.get('current_admission_id'),
            'assigned_to': task.get('assigned_to'),
            'assignee_name': next((u.get('display_name', '') for u in data['users'] if u['id']==task.get('assigned_to')), ''),
            'shift_id': task.get('shift_id'),
            'shift_name': next((s.get('name', '') for s in data['shifts'] if s['id']==task.get('shift_id')), ''),
        })
