"""Single JSON transaction for elder identity, bed occupancy and admission history."""
import copy

from app.models.entities import Elder
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, replayable

TERMINAL_TASKS = {'completed', 'cancelled'}


def version(item, expected):
    if item.get('revision', 1) != expected:
        raise DomainError('stale_revision')


def care_eligible(data, elder_id):
    elder = find(data, 'elders', elder_id, 'elder_not_found')
    if elder.get('status', 'active') not in {'active', 'out'}:
        raise DomainError('elder_not_in_care')
    return elder


def care_state(elder):
    """Bumps at every lifecycle operation, including discharge/readmission to same bed."""
    return {'status': elder.get('status', 'active'), 'bed_id': elder.get('bed_id'),
            'current_admission_id': elder.get('current_admission_id'),
            'care_state_version': elder.get('care_state_version', 0)}


def create_elder(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            at = now()
            item = {'id': identifier('ELDER'), **payload.model_dump(), 'status': 'pending',
                    'bed_id': None, 'current_admission_id': None, 'revision': 1,
                    'care_state_version': 0, 'created_at': at, 'updated_at': at}
            data['elders'].append(item)
            audit(data, 'create_elder', item['id'], user_id, elder_id=item['id'], detail='建立待入住老人档案')
            return Elder.model_validate(item).model_dump()
        return replayable(data, user_id, 'create_elder', key, payload.model_dump(), operation)
    return store.mutate(mutate)


def update_elder(store, elder_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'elders', elder_id, 'elder_not_found')
            version(item, payload.expected_revision)
            changes = payload.model_dump(exclude_unset=True, exclude={'expected_revision', 'reason'})
            if not changes:
                raise DomainError('no_profile_changes', 422)
            before = {field: item.get(field) for field in changes}
            item.update(changes, revision=item.get('revision', 1) + 1, updated_at=now())
            audit(data, 'update_elder', elder_id, user_id, elder_id=elder_id,
                  detail=payload.reason, before=before, after=changes)
            return Elder.model_validate(item).model_dump()
        return replayable(data, user_id, 'update_elder', key, {'elder_id': elder_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def bed_view(data, bed):
    """Derive availability from all current links; never offer an inconsistent bed."""
    bed_id = bed['id']
    elders = [row for row in data['elders'] if row.get('bed_id') == bed_id and row.get('status', 'active') in {'active', 'out'}]
    admissions = [row for row in data['admissions'] if row.get('bed_id') == bed_id and row.get('status') in {'active', 'out'}]
    occupant_ids = {row['id'] for row in elders} | {row['elder_id'] for row in admissions}
    if bed.get('elder_id'):
        occupant_ids.add(bed['elder_id'])
    enabled = bed.get('enabled', bed.get('status') != 'inactive')
    conflict = len(occupant_ids) > 1 or len(admissions) > 1
    if occupant_ids:
        elder = next((row for row in elders if row['id'] in occupant_ids), None)
        conflict = conflict or elder is None or not enabled
        if elder and admissions:
            conflict = conflict or any(row['elder_id'] != elder['id'] or row['status'] != elder.get('status', 'active')
                                       or elder.get('current_admission_id') != row['id'] for row in admissions)
        if elder and elder.get('current_admission_id') and not any(row['id'] == elder['current_admission_id'] for row in admissions):
            conflict = True
        if elder:
            conflict = conflict or any(row['id'] != bed_id and row.get('elder_id') == elder['id'] for row in data['beds'])
            conflict = conflict or len(_open_admissions(data, elder['id'])) > 1
    # A legacy occupied marker without an identifiable occupant is unsafe to allocate.
    conflict = conflict or (bed.get('status') == 'occupied' and not occupant_ids)
    return {'id': bed_id, 'room': bed.get('room', ''), 'label': bed.get('label', bed.get('room', bed_id)),
            'enabled': enabled, 'revision': bed.get('revision', 1),
            'status': 'conflict' if conflict else ('occupied' if occupant_ids else ('available' if enabled else 'inactive')),
            'elder_id': next(iter(occupant_ids)) if len(occupant_ids) == 1 else None,
            'occupant_ids': sorted(occupant_ids), 'created_at': bed.get('created_at'), 'updated_at': bed.get('updated_at')}


def list_beds(store, status=None, limit=100, offset=0):
    data = store.read()
    rows = [bed_view(data, bed) for bed in data['beds']]
    return [row for row in rows if status is None or row['status'] == status][offset:offset + limit]


def _unique_bed(data, room, label, exclude=None):
    if any(row['id'] != exclude and row.get('room', '').casefold() == room.casefold()
           and row.get('label', row.get('room', row['id'])).casefold() == label.casefold() for row in data['beds']):
        raise DomainError('duplicate_room_bed_label')


def create_bed(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            _unique_bed(data, payload.room, payload.label)
            at = now()
            item = {'id': identifier('BED'), **payload.model_dump(), 'enabled': True, 'status': 'available',
                    'elder_id': None, 'revision': 1, 'created_at': at, 'updated_at': at}
            data['beds'].append(item)
            audit(data, 'create_bed', item['id'], user_id, detail='建立床位')
            return bed_view(data, item)
        return replayable(data, user_id, 'create_bed', key, payload.model_dump(), operation)
    return store.mutate(mutate)


def update_bed(store, bed_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'beds', bed_id, 'bed_not_found')
            version(item, payload.expected_revision)
            view = bed_view(data, item)
            if view['status'] == 'conflict':
                raise DomainError('bed_relation_inconsistent')
            changes = payload.model_dump(exclude_unset=True, exclude={'expected_revision', 'reason'})
            if not changes:
                raise DomainError('no_bed_changes', 422)
            if changes.get('enabled') is False and view['status'] == 'occupied':
                raise DomainError('occupied_bed_cannot_disable')
            _unique_bed(data, changes.get('room', view['room']), changes.get('label', view['label']), bed_id)
            before = {field: view.get(field) for field in changes}
            item.setdefault('enabled', view['enabled'])
            item.update(changes, revision=item.get('revision', 1) + 1, updated_at=now())
            item['status'] = 'occupied' if view['elder_id'] else ('available' if item.get('enabled', True) else 'inactive')
            audit(data, 'update_bed', bed_id, user_id, detail=payload.reason, before=before, after=changes)
            return bed_view(data, item)
        return replayable(data, user_id, 'update_bed', key, {'bed_id': bed_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def _bed(data, bed_id, expected=None, allow_elder=None):
    bed = find(data, 'beds', bed_id, 'bed_not_found')
    if expected is not None:
        version(bed, expected)
    view = bed_view(data, bed)
    if view['status'] == 'conflict':
        raise DomainError('bed_relation_inconsistent')
    if not view['enabled']:
        raise DomainError('bed_inactive')
    if view['elder_id'] is not None and view['elder_id'] != allow_elder:
        raise DomainError('bed_occupied')
    return bed


def _set_bed(bed, elder_id, at):
    bed.update(elder_id=elder_id, status='occupied' if elder_id else 'available',
               revision=bed.get('revision', 1) + 1, updated_at=at)


def _open_admissions(data, elder_id):
    return [row for row in data['admissions'] if row.get('elder_id') == elder_id and row.get('status') in {'active', 'out'}]


def admission_history(store, elder_id, limit=100, offset=0):
    data = store.read()
    elder = find(data, 'elders', elder_id, 'elder_not_found')
    return {'elder_id': elder_id, 'elder_revision': elder.get('revision', 1), 'status': elder.get('status', 'active'),
            'needs_legacy_registration': elder.get('status', 'active') in {'active', 'out'} and not _open_admissions(data, elder_id),
            'admissions': [row for row in reversed(data['admissions']) if row['elder_id'] == elder_id][offset:offset + limit]}


def admit(store, elder_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            elder = find(data, 'elders', elder_id, 'elder_not_found')
            version(elder, payload.expected_elder_revision)
            if _open_admissions(data, elder_id) or elder.get('current_admission_id'):
                raise DomainError('elder_already_admitted')
            legacy = payload.kind == 'legacy_registration'
            status = elder.get('status', 'active')
            if legacy:
                if status not in {'active', 'out'}:
                    raise DomainError('legacy_registration_requires_in_care_elder')
                if elder.get('bed_id') not in {None, payload.bed_id}:
                    raise DomainError('legacy_registration_must_keep_existing_bed')
            elif status not in {'pending', 'discharged'}:
                raise DomainError('existing_in_care_elder_requires_legacy_registration')
            if not legacy and elder.get('bed_id'):
                raise DomainError('elder_bed_relation_inconsistent')
            bed = _bed(data, payload.bed_id, payload.expected_bed_revision, elder_id if legacy else None)
            at = now()
            action = 'legacy_registration' if legacy else 'admit'
            admission_id = identifier('ADM')
            item = {'id': admission_id, 'elder_id': elder_id, 'bed_id': bed['id'],
                    'status': status if legacy else 'active', 'revision': 1, 'kind': action,
                    'admitted_at': None if legacy else at, 'registered_at': at,
                    'discharged_at': None, 'created_by': user_id,
                    'bed_stays': [{'bed_id': bed['id'], 'room': bed.get('room'), 'label': bed.get('label', bed.get('room')),
                                   'started_at': None if legacy else at, 'registered_at': at, 'ended_at': None}],
                    'events': [{'action': action, 'at': at, 'actor_id': user_id, 'reason': payload.reason,
                                'from_bed_id': None, 'to_bed_id': bed['id'], 'status': status if legacy else 'active'}]}
            data['admissions'].append(item)
            elder.update(status=item['status'], bed_id=bed['id'], current_admission_id=admission_id,
                         revision=elder.get('revision', 1) + 1, care_state_version=elder.get('care_state_version', 0) + 1,
                         updated_at=at)
            _set_bed(bed, elder_id, at)
            audit(data, 'admission_' + action, admission_id, user_id, elder_id=elder_id,
                  detail=payload.reason, after={'elder_id': elder_id, 'bed_id': bed['id'], 'status': item['status']})
            return {'elder': Elder.model_validate(elder).model_dump(), 'admission': copy.deepcopy(item), 'bed': bed_view(data, bed)}
        return replayable(data, user_id, 'admit_elder', key, {'elder_id': elder_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def admission_action(store, admission_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'admissions', admission_id, 'admission_not_found')
            elder = find(data, 'elders', item['elder_id'], 'elder_not_found')
            version(item, payload.expected_revision)
            version(elder, payload.expected_elder_revision)
            if item['status'] == 'discharged':
                raise DomainError('admission_is_closed')
            if (elder.get('current_admission_id') != admission_id or elder.get('bed_id') != item['bed_id']
                    or elder.get('status') != item['status'] or len(_open_admissions(data, elder['id'])) != 1):
                raise DomainError('admission_relation_inconsistent')
            bed = _bed(data, item['bed_id'], allow_elder=elder['id'])
            action, at = payload.action, now()
            before = {'bed_id': item['bed_id'], 'status': item['status']}
            target = None
            if action == 'transfer':
                if item['status'] != 'active':
                    raise DomainError('return_before_bed_transfer')
                if payload.bed_id == item['bed_id']:
                    raise DomainError('different_bed_required', 422)
                target = _bed(data, payload.bed_id, payload.expected_bed_revision)
                item['bed_stays'][-1]['ended_at'] = at
                item['bed_stays'].append({'bed_id': target['id'], 'room': target.get('room'),
                                           'label': target.get('label', target.get('room')),
                                           'started_at': at, 'registered_at': at, 'ended_at': None})
                _set_bed(bed, None, at)
                _set_bed(target, elder['id'], at)
                item['bed_id'] = elder['bed_id'] = target['id']
            elif action == 'out':
                if item['status'] != 'active':
                    raise DomainError('elder_already_out')
                item['status'] = elder['status'] = 'out'
            elif action == 'return':
                if item['status'] != 'out':
                    raise DomainError('elder_is_not_out')
                item['status'] = elder['status'] = 'active'
            else:
                outstanding = [row['id'] for row in data['care_tasks'] if row['elder_id'] == elder['id'] and row['status'] not in TERMINAL_TASKS]
                if outstanding:
                    raise DomainError('resolve_outstanding_tasks_before_discharge')
                item.update(status='discharged', discharged_at=at)
                item['bed_stays'][-1]['ended_at'] = at
                elder.update(status='discharged', bed_id=None, current_admission_id=None)
                _set_bed(bed, None, at)
            item['revision'] += 1
            elder.update(revision=elder.get('revision', 1) + 1,
                         care_state_version=elder.get('care_state_version', 0) + 1, updated_at=at)
            event = {'action': action, 'at': at, 'actor_id': user_id, 'reason': payload.reason,
                     'from_bed_id': before['bed_id'], 'to_bed_id': elder.get('bed_id'), 'status': item['status']}
            item['events'].append(event)
            audit(data, 'admission_' + action, admission_id, user_id, elder_id=elder['id'],
                  detail=payload.reason, before=before, after=event)
            return {'elder': Elder.model_validate(elder).model_dump(), 'admission': copy.deepcopy(item),
                    'bed': bed_view(data, target or bed)}
        return replayable(data, user_id, 'admission_action', key, {'admission_id': admission_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
