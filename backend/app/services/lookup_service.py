"""Small authorized option projections; selection does not authorize a write."""
from app.services.care_scope_service import elder_ids
from app.services.incident_service import access as incident_access
from app.services.listing_service import page
from app.services.presentation_service import bed_label, shift_context, incident_display, empty_state
from app.services.workflow import DomainError, current_staff, find


def options(store, kind, user_id, role, q='', elder_id=None, shift_id=None, status=None, limit=50, offset=0):
    data = store.read()
    current_staff(data, user_id, role)
    rows = []
    if kind == 'elders':
        scope = elder_ids(data, user_id, role)
        rows = [{'id': e['id'], 'label': e['name'], 'elder_name': e['name'],
                 'state_label': {'active': '在院', 'out': '外出', 'discharged': '已离院'}.get(e.get('status', 'active'), '状态待核实'),
                 'bed_label': bed_label(data, e.get('bed_id')), 'status': e.get('status', 'active')}
                for e in data['elders'] if e['id'] in scope]
    elif kind == 'staff':
        members = None
        if shift_id:
            shift = find(data, 'shifts', shift_id, 'shift_not_found')
            members = set(shift.get('caregiver_ids', []))
        rows = [{'id': u['id'], 'label': u['display_name'], 'display_name': u['display_name'], 'role': u['role']}
                for u in data['users'] if u.get('active', True)
                and u['role'] in {'admin', 'supervisor', 'caregiver', 'nurse'}
                and (members is None or u['id'] in members)]
    elif kind == 'shifts':
        for s in data['shifts']:
            item = shift_context(s)
            rows.append({key: item.get(key) for key in ('id', 'name', 'start_at', 'end_at', 'status', 'state_label', 'timezone')}
                        | {'label': item['display_label']})
    elif kind == 'incidents':
        for incident in data['incidents']:
            if elder_id and incident['elder_id'] != elder_id:
                continue
            try:
                incident_access(data, incident, user_id, role)
            except DomainError:
                continue
            description = incident.get('description') or ''
            display = incident_display(data, incident)
            rows.append({'id': incident['id'], 'label': display['display_label'],
                         'description': description, 'elder_id': incident['elder_id'],
                         **display,
                         'occurred_at': incident.get('occurred_at'), 'status': incident['status'],
                         'severity': incident.get('severity')})
    else:
        raise DomainError('lookup_kind_invalid', 422)
    query = q.strip().casefold()
    rows = [r for r in rows if (not status or r.get('status') == status)
            and (not query or any(query in str(r.get(k) or '').casefold()
                                  for k in ('label', 'description', 'bed_label', 'elder_name', 'name', 'start_at')))]
    rows.sort(key=lambda r: (r['label'].casefold(), r['id']))
    return {**page(rows, limit, offset, {'q': q, 'elder_id': elder_id, 'shift_id': shift_id, 'status': status}),
            'empty_state': empty_state(len(rows), offset)}
