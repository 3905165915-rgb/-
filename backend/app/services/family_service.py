"""Scoped, expiring family access. Internal evidence never enters family views.

The pre-existing family_cases collection is a tagged union (kind). No new store
collection or implicit migration; legacy untagged cases remain untouched.
"""
import copy
import hashlib
import json
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
    # Demo selection is computed on each request; never create or broaden a
    # formal family authorization merely by opening the selection page.
    demo_binding = next((row for row in demo_bindings(data, user_id) if row['id'] == binding_id), None)
    if demo_binding is not None and scope in demo_binding['scopes']:
        return demo_binding
    binding = case(data, binding_id, 'binding')
    if binding['family_id'] != user_id or scope not in binding['scopes'] or not effective(data, binding):
        raise DomainError('family_access_not_authorized', 403)
    return binding


def safe_binding(data, binding):
    elder = find(data, 'elders', binding['elder_id'], 'elder_not_found')
    return {**{key: binding[key] for key in ('id', 'elder_id', 'admission_id', 'scopes', 'expires_at')},
            'elder_name': elder['name'], **({'demo_access': True} if binding.get('demo_access') is True else {})}


def demo_bindings(data, user_id):
    """Virtual selection entries for the explicitly enabled demo family account.

    All elders can be selected, including new/not-yet-admitted elders. No
    admission or consent record is fabricated. Only already-published family
    content is readable, across stays for demonstration purposes.
    """
    from app.core.config import settings
    user = account(data, user_id)
    if (not settings.demo_family_all_elders or settings.app_env.lower() not in {'demo', 'development', 'test'}
            or user.get('demo_login_enabled') is not True):
        return []
    expires = (parse_time(now()) + timedelta(days=1)).isoformat()
    result = []
    for elder in data['elders']:
        digest = hashlib.sha256(json.dumps([user_id, elder['id']], ensure_ascii=False).encode()).hexdigest()[:24]
        result.append({'id': 'DEMO-FAMILY-' + digest, 'kind': 'binding', 'family_id': user_id,
                       'elder_id': elder['id'], 'admission_id': elder.get('current_admission_id'),
                       'scopes': ['summary', 'feedback'], 'expires_at': expires, 'demo_access': True})
    return result


def in_family_scope(binding, item):
    return (item['elder_id'] == binding['elder_id'] and
            (binding.get('demo_access') is True or item.get('admission_id') == binding['admission_id']))


def my_bindings(store, user_id):
    data = store.read()
    account(data, user_id)
    demo = demo_bindings(data, user_id)
    if demo:
        return [safe_binding(data, row) for row in demo]
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


def create_summary(store, payload, user_id, role, key=None, generation=None,
                   _action='create_family_summary', _fingerprint_payload=None):
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
            if generation is not None:
                item['generation'] = copy.deepcopy(generation)
            data['family_cases'].append(item)
            audit(data, 'create_family_summary', item['id'], user_id, elder_id=item['elder_id'])
            return copy.deepcopy(item)
        return replayable(data, user_id, _action, key,
                          _fingerprint_payload if _fingerprint_payload is not None else payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def suggest_summary(store, payload, user_id, role, key=None):
    from time import perf_counter
    from app.services.ai_service import AIProviderError, get_ai_provider
    from app.services.ai_outputs import validate_citations
    from app.schemas.family import SummaryCreate
    data = store.read()
    current_staff(data, user_id, role, management=True)
    admission(data, payload.elder_id, payload.admission_id)
    if not payload.public_quotes_confirmed:
        raise DomainError('summary_public_quotes_need_confirmation', 422)
    if not payload.period_start < payload.period_end <= parse_time(now()):
        raise DomainError('summary_period_invalid', 422)
    request_body = payload.model_dump(mode='json')
    if key and any(r['user_id'] == user_id and r['action'] == 'suggest_family_summary' and r['key'] == key
                   for r in data['idempotency_keys']):
        return replayable(data, user_id, 'suggest_family_summary', key, request_body, lambda: None)
    evidence = evidence_service._evidence(data, payload.elder_id, payload.evidence)
    for source in evidence:
        record = find(data, 'care_records', source['record_id'], 'record_not_found')
        observed = parse_time(record.get('happened_at') or record['created_at'])
        if record.get('admission_id') != payload.admission_id or not payload.period_start <= observed < payload.period_end:
            raise DomainError('summary_evidence_outside_current_stay_or_period', 422)
    # Only explicitly approved public quotes enter the model, not full internal
    # narratives, medical records, account details, other elders or attachments.
    sources = [{'source_id': f'public-{i + 1}', 'text': source['quote']} for i, source in enumerate(evidence)]
    provider = get_ai_provider()
    started = perf_counter()
    try:
        output = validate_citations(provider.summarize(sources), sources, 'summary')
    except DomainError:
        raise
    except (ValueError, TypeError, KeyError) as exc:
        raise AIProviderError('family_summary_output_invalid') from exc
    text = '\n'.join(point['text'] for point in output['points'])
    request = SummaryCreate(elder_id=payload.elder_id, admission_id=payload.admission_id,
                            period_start=payload.period_start, period_end=payload.period_end,
                            evidence=payload.evidence, text=text)
    # create_summary revalidates the live evidence under the write lock after AI.
    return create_summary(store, request, user_id, role, key, generation={
        'provider': provider.name, 'prompt_version': 'public-quotes-summary-v1', 'points': output['points'],
        'elapsed_ms': round((perf_counter() - started) * 1000), 'original_text': text,
        'status': 'draft', 'public_quotes_confirmed_by': user_id},
        _action='suggest_family_summary', _fingerprint_payload=request_body)


def edit_summary(store, summary_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = case(data, summary_id, 'summary')
            version(item, payload.expected_revision)
            if item['status'] != 'draft':
                raise DomainError('summary_transition_invalid')
            item.setdefault('edits', []).append({'before': item['text'], 'by': user_id, 'at': now(), 'reason': payload.reason})
            item.update(text=payload.text, revision=item['revision'] + 1)
            audit(data, 'edit_family_summary', summary_id, user_id, elder_id=item['elder_id'])
            return copy.deepcopy(item)
        return replayable(data, user_id, 'edit_family_summary', key, {'id': summary_id, **payload.model_dump()}, operation)
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
            if in_family_scope(binding, row)
            and row['status'] == 'published' and evidence_service.sources_current(data, row)][offset:offset + limit]


def handovers(store, binding_id, user_id, limit=100, offset=0):
    """Expose only a reviewed public summary under the binding's current admission."""
    data = store.read()
    binding = authorize(data, binding_id, user_id, 'summary')
    public = summaries(store, binding_id, user_id, limit=100000, offset=0)
    selected = public[offset:offset + limit]
    return [{'id': summary['id'], 'elder_id': binding['elder_id'], 'summary': summary['text'],
             'tasks': [], 'period_start': summary['period_start'], 'period_end': summary['period_end']}
            for summary in selected]


def family_timeline(store, binding_id, user_id, limit=100, offset=0):
    """Only publish-reviewed summaries and explicitly shared, linked photos."""
    data = store.read()
    binding = authorize(data, binding_id, user_id, 'summary')
    published = [row for row in reversed(rows(data, 'summary'))
                 if in_family_scope(binding, row)
                 and row['status'] == 'published'
                 and evidence_service.sources_current(data, row)]
    published.sort(key=lambda row: parse_time(row['period_end']), reverse=True)
    events = []
    for item in published:
        source_records = {source['record_id'] for source in item['evidence']}
        photos = []
        for photo in data['attachments']:
            if (not in_family_scope(binding, photo) or
                photo.get('status') != 'approved' or
                photo.get('family_visible') is not True or
                not any(link.get('target_type') == 'record' and link.get('target_id') in source_records
                        for link in photo.get('links', []))):
                continue
            photos.append({'id': photo['id'], 'caption': photo['caption'],
                           'occurred_at': photo['occurred_at'],
                           'content_path': f"/family/me/bindings/{binding_id}/photos/{photo['id']}/content"})
        events.append({
            'id': item['id'], 'elder_id': item['elder_id'],
            'happened_at': item['period_end'], 'period_start': item['period_start'],
            'period_end': item['period_end'], 'title': '照护近况', 'text': item['text'],
            'published_at': item['reviewed_at'], 'photos': photos, 'kind': 'published_summary',
        })
    return {'elder_id': binding['elder_id'], 'elder_name': next(
        row['name'] for row in data['elders'] if row['id'] == binding['elder_id']),
        'items': events[offset:offset + limit], 'total': len(events)}


def family_photo(store, binding_id, attachment_id, user_id):
    data = store.read()
    binding = authorize(data, binding_id, user_id, 'summary')
    item = find(data, 'attachments', attachment_id, 'attachment_not_found')
    if (not in_family_scope(binding, item) or
        item.get('status') != 'approved' or item.get('family_visible') is not True):
        raise DomainError('family_photo_not_published', 404)
    published = [row for row in rows(data, 'summary')
        if in_family_scope(binding, row)
        and row['status'] == 'published' and evidence_service.sources_current(data, row)]
    source_records = {source['record_id'] for row in published for source in row['evidence']}
    if not any(link.get('target_type') == 'record' and link.get('target_id') in source_records
               for link in item.get('links', [])):
        raise DomainError('family_photo_not_published', 404)
    from app.services import attachment_service
    path = attachment_service.file_path(store, item)
    if not path.is_file():
        raise DomainError('attachment_file_missing', 404)
    return path


def family_insight(store, binding_id, user_id):
    from time import perf_counter
    from app.services.ai_service import AIProviderError, get_ai_provider
    from app.services.ai_outputs import validate_citations

    timeline = family_timeline(store, binding_id, user_id, limit=30)
    sources = [{'source_id': item['id'], 'text': item['text']} for item in timeline['items']]
    if not sources:
        return {'elder_id': timeline['elder_id'], 'points': [], 'provider': 'none',
                'model_status': 'no_public_updates', 'elapsed_ms': 0}
    provider = get_ai_provider()
    started = perf_counter()
    try:
        output = validate_citations(provider.family_insight(sources), sources, 'summary')
    except (ValueError, TypeError, KeyError) as exc:
        raise AIProviderError('family_insight_output_invalid') from exc
    current = family_timeline(store, binding_id, user_id, limit=30)
    if [(r['id'], r['text']) for r in current['items']] != [(r['id'], r['text']) for r in timeline['items']]:
        raise DomainError('family_updates_changed', 409)
    return {'elder_id': timeline['elder_id'], 'points': output['points'],
            'provider': provider.name, 'model_status': 'demo' if provider.name == 'mock' else 'available',
            'elapsed_ms': round((perf_counter() - started) * 1000),
            'source_ids': [source['source_id'] for source in sources]}


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
