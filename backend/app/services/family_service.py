"""Scoped, expiring family access. Internal evidence never enters family views.

The pre-existing family_cases collection is a tagged union (kind). No new store
collection or implicit migration; legacy untagged cases remain untouched.
"""
import copy
from datetime import timedelta

from app.services import assessment_service as evidence_service
from app.services.facility_service import care_eligible, version
from app.services.passwords import hash_password
from app.services.staff_service import staff_view
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, parse_time, replayable


def account(data, user_id):
    user = find(data, 'users', user_id, 'family_account_not_found')
    if user['role'] != 'family' or not user.get('active', True):
        raise DomainError('family_account_unavailable', 403)
    return user


def create_account(store, payload, user_id, role):
    encoded = hash_password(payload.password.get_secret_value())
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        if any(row['username'].casefold() == payload.username.casefold() for row in data['users']):
            raise DomainError('username_taken')
        item = {'id': identifier('FAMILY'), 'username': payload.username, 'display_name': payload.display_name,
                'role': 'family', 'active': True, 'password_hash': encoded, 'token_version': 0,
                'revision': 1, 'created_at': now()}
        data['users'].append(item)
        audit(data, 'create_family_account', item['id'], user_id)
        return staff_view(item)
    return store.mutate(mutate)


def update_account(store, target_id, payload, user_id, role, password=False):
    encoded = hash_password(payload.password.get_secret_value()) if password else None
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        target = find(data, 'users', target_id, 'family_account_not_found')
        if target['role'] != 'family':
            raise DomainError('family_account_not_found', 404)
        version(target, payload.expected_revision)
        if password:
            target['password_hash'] = encoded
        else:
            target['active'] = payload.active
        target.update(token_version=target.get('token_version', 0) + 1,
                      revision=target.get('revision', 1) + 1, updated_at=now())
        audit(data, 'reset_family_password' if password else 'update_family_account', target_id, user_id, detail=payload.reason)
        return staff_view(target)
    return store.mutate(mutate)


def rows(data, kind):
    return [row for row in data['family_cases'] if row.get('kind') == kind]


def case(data, item_id, kind):
    row = find(data, 'family_cases', item_id, 'family_case_not_found')
    if row.get('kind') != kind:
        raise DomainError('family_case_not_found', 404)
    return row


def admission(data, elder_id, admission_id):
    elder = care_eligible(data, elder_id)
    stay = find(data, 'admissions', admission_id, 'admission_not_found')
    if elder.get('current_admission_id') != admission_id or stay['elder_id'] != elder_id or stay['status'] not in {'active', 'out'}:
        raise DomainError('family_admission_not_current')
    return elder


def effective(data, binding, at=None):
    if binding['status'] != 'active' or parse_time(binding['expires_at']) <= parse_time(at or now()):
        return False
    try:
        account(data, binding['family_id'])
        admission(data, binding['elder_id'], binding['admission_id'])
    except DomainError:
        return False
    return True


def authorize(data, binding_id, user_id, scope):
    account(data, user_id)
    binding = case(data, binding_id, 'binding')
    if binding['family_id'] != user_id or scope not in binding['scopes'] or not effective(data, binding):
        raise DomainError('family_access_not_authorized', 403)
    return binding


def safe_binding(data, binding):
    elder = find(data, 'elders', binding['elder_id'], 'elder_not_found')
    return {**{key: binding[key] for key in ('id', 'elder_id', 'admission_id', 'scopes', 'expires_at')},
            'elder_name': elder['name']}


def my_bindings(store, user_id):
    data = store.read()
    account(data, user_id)
    return [safe_binding(data, row) for row in rows(data, 'binding') if row['family_id'] == user_id and effective(data, row)]


def create_binding(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            account(data, payload.family_id)
            admission(data, payload.elder_id, payload.admission_id)
            instant = parse_time(now())
            if not instant < payload.expires_at <= instant + timedelta(days=366):
                raise DomainError('binding_expiry_must_be_future_within_366_days', 422)
            if len(set(payload.scopes)) != len(payload.scopes):
                raise DomainError('binding_scopes_must_be_unique', 422)
            if any(row['family_id'] == payload.family_id and row['elder_id'] == payload.elder_id and effective(data, row)
                   for row in rows(data, 'binding')):
                raise DomainError('family_binding_already_active')
            item = {'id': identifier('BINDING'), 'kind': 'binding', **payload.model_dump(mode='json'),
                    'status': 'active', 'revision': 1, 'created_by': user_id, 'created_at': now()}
            data['family_cases'].append(item)
            audit(data, 'create_family_binding', item['id'], user_id, elder_id=item['elder_id'])
            return copy.deepcopy(item)
        return replayable(data, user_id, 'create_family_binding', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def revoke(store, binding_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = case(data, binding_id, 'binding')
            version(item, payload.expected_revision)
            if item['status'] != 'active':
                raise DomainError('binding_already_revoked')
            item.update(status='revoked', revision=item['revision'] + 1, revoked_by=user_id, revoked_at=now(), reason=payload.reason)
            audit(data, 'revoke_family_binding', binding_id, user_id, elder_id=item['elder_id'], detail=payload.reason)
            return copy.deepcopy(item)
        return replayable(data, user_id, 'revoke_family_binding', key, {'id': binding_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def create_summary(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            admission(data, payload.elder_id, payload.admission_id)
            if not payload.period_start < payload.period_end <= parse_time(now()):
                raise DomainError('summary_period_invalid', 422)
            evidence = evidence_service._evidence(data, payload.elder_id, payload.evidence)
            for source in evidence:
                record = find(data, 'care_records', source['record_id'], 'record_not_found')
                observed = parse_time(record.get('happened_at') or record['created_at'])
                if not payload.period_start <= observed < payload.period_end:
                    raise DomainError('summary_evidence_outside_period', 422)
                # Unknown legacy stays must not be assumed to belong to this stay.
                if record.get('admission_id') != payload.admission_id:
                    raise DomainError('summary_evidence_admission_mismatch', 422)
            item = {'id': identifier('SUMMARY'), 'kind': 'summary', **payload.model_dump(mode='json', exclude={'evidence'}),
                    'evidence': evidence, 'status': 'draft', 'revision': 1, 'created_by': user_id, 'created_at': now()}
            data['family_cases'].append(item)
            audit(data, 'create_family_summary', item['id'], user_id, elder_id=item['elder_id'])
            return copy.deepcopy(item)
        return replayable(data, user_id, 'create_family_summary', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def review_summary(store, summary_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = case(data, summary_id, 'summary')
            version(item, payload.expected_revision)
            required = 'published' if payload.action == 'withdraw' else 'draft'
            if item['status'] != required:
                raise DomainError('summary_transition_invalid')
            if payload.action == 'publish':
                admission(data, item['elder_id'], item['admission_id'])
                if not evidence_service.sources_current(data, item):
                    raise DomainError('summary_evidence_changed')
            item.update(status={'publish': 'published', 'reject': 'rejected', 'withdraw': 'withdrawn'}[payload.action],
                        revision=item['revision'] + 1, reviewed_by=user_id, reviewed_at=now(), review_reason=payload.reason)
            audit(data, 'review_family_summary', item['id'], user_id, elder_id=item['elder_id'], decision=payload.action)
            return copy.deepcopy(item)
        return replayable(data, user_id, 'review_family_summary', key, {'id': summary_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def summaries(store, binding_id, user_id, limit=100, offset=0):
    data = store.read()
    binding = authorize(data, binding_id, user_id, 'summary')
    return [{field: row[field] for field in ('id', 'elder_id', 'period_start', 'period_end', 'text', 'revision', 'reviewed_at')}
            for row in reversed(rows(data, 'summary'))
            if row['elder_id'] == binding['elder_id'] and row['admission_id'] == binding['admission_id']
            and row['status'] == 'published' and evidence_service.sources_current(data, row)][offset:offset + limit]


def feedback_view(item):
    return {key: item.get(key) for key in ('id', 'binding_id', 'elder_id', 'text', 'status', 'revision', 'created_at', 'reply', 'replied_at')}


def feedback(store, payload, user_id, key=None):
    def mutate(data):
        binding = authorize(data, payload.binding_id, user_id, 'feedback')  # BEFORE cached replay
        def operation():
            item = {'id': identifier('FEEDBACK'), 'kind': 'feedback', **payload.model_dump(), 'family_id': user_id,
                    'elder_id': binding['elder_id'], 'admission_id': binding['admission_id'], 'status': 'open',
                    'revision': 1, 'created_at': now()}
            data['family_cases'].append(item)
            audit(data, 'create_family_feedback', item['id'], user_id, elder_id=item['elder_id'])
            return feedback_view(item)
        return replayable(data, user_id, 'create_family_feedback', key, payload.model_dump(), operation)
    return store.mutate(mutate)


def my_feedback(store, binding_id, user_id, limit=100, offset=0):
    data = store.read()
    authorize(data, binding_id, user_id, 'feedback')
    return [feedback_view(row) for row in reversed(rows(data, 'feedback'))
            if row['binding_id'] == binding_id and row['family_id'] == user_id][offset:offset + limit]


def reply(store, feedback_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = case(data, feedback_id, 'feedback')
            version(item, payload.expected_revision)
            if item['status'] != 'open':
                raise DomainError('feedback_already_closed')
            item.update(status='closed', revision=item['revision'] + 1, reply=payload.reply,
                        replied_at=now(), replied_by=user_id, internal_reason=payload.reason)
            audit(data, 'reply_family_feedback', item['id'], user_id, elder_id=item['elder_id'])
            return copy.deepcopy(item)
        return replayable(data, user_id, 'reply_family_feedback', key, {'id': feedback_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
