"""Human-confirmed care memories; no model output becomes effective by itself."""
from __future__ import annotations

import copy
from pydantic import ValidationError

from app.schemas.memory import MemoryContent, MemoryCreateRequest, MemoryFromDraftRequest, MemoryRefusalRequest, MemoryRevisionRequest, MemoryReviewRequest
from app.services.workflow import DomainError, audit, current_staff, editable, find, identifier, now, parse_time, replayable
from app.storage.json_store import JsonStore


TERMINAL = {'rejected', 'retired'}


def _staff(role):
    if role not in {'admin', 'supervisor', 'caregiver', 'nurse'}:
        raise DomainError('staff_required', 403)


def _source(data, elder_id, payload: MemoryContent):
    record = find(data, 'care_records', payload.source_record_id, 'record_not_found')
    if record['elder_id'] != elder_id:
        raise DomainError('memory_source_elder_mismatch', 422)
    if record.get('status') not in {'confirmed', 'corrected'}:
        raise DomainError('memory_requires_confirmed_record', 422)
    if record.get('revision', 1) != payload.source_revision:
        raise DomainError('memory_source_revision_changed')
    # Raw text is immutable, including mistakes. A corrected record must be cited
    # through its current observations so an old quote cannot silently undo a correction.
    if payload.source_field == 'raw_text' and (record.get('revision', 1) != 1 or record['status'] == 'corrected'):
        raise DomainError('corrected_source_requires_observations', 422)
    texts = [record['raw_text']] if payload.source_field == 'raw_text' else record['observations']
    text = next((text for text in texts if payload.source_quote in text), None)
    if text is None:
        raise DomainError('memory_quote_not_in_current_source', 422)
    return {
        'record_id': record['id'], 'revision': record.get('revision', 1),
        'field': payload.source_field, 'quote': payload.source_quote,
        'snapshot_text': text, 'record_status': record['status'], 'captured_at': now(),
    }


def _content(data, elder_id, payload: MemoryContent):
    start = payload.valid_from.isoformat() if payload.valid_from else now()
    for value in (payload.expires_at, payload.review_due_at):
        if value is not None and value <= parse_time(start):
            raise DomainError('invalid_memory_time_window', 422)
    return {
        'content': payload.content, 'category': payload.category, 'scenes': list(payload.scenes),
        'attributed_to': payload.attributed_to, 'source': _source(data, elder_id, payload),
        'valid_from': start,
        'expires_at': payload.expires_at.isoformat() if payload.expires_at else None,
        'review_due_at': payload.review_due_at.isoformat() if payload.review_due_at else None,
    }


def _source_current(data, item):
    provenance = item.get('candidate_source') or {}
    if provenance.get('impression_id'):
        report = next((r for r in data['elder_impressions'] if r['id'] == provenance['impression_id']), None)
        point = next((p for p in (report or {}).get('points', []) if p['id'] == provenance.get('point_id')), None)
        if (not report or report['elder_id'] != item['elder_id'] or not point or
                point['status'] != 'confirmed' or point['revision'] != provenance.get('point_revision')):
            return False
        for citation in provenance.get('citations', []):
            record = next((r for r in data['care_records'] if r['id'] == citation['source_id']), None)
            if (not record or record['elder_id'] != item['elder_id'] or
                    record.get('status') not in {'confirmed', 'corrected'} or
                    record.get('revision', 1) != provenance.get('source_versions', {}).get(record['id']) or
                    not any(citation['quote'] in text for text in record.get('observations', []))):
                return False
    source = item['source']
    record = next((row for row in data['care_records'] if row['id'] == source['record_id']), None)
    if not record or record['elder_id'] != item['elder_id'] or record.get('revision', 1) != source['revision']:
        return False
    if record.get('status') not in {'confirmed', 'corrected'}:
        return False
    if source['field'] == 'raw_text':
        return record.get('revision', 1) == 1 and record['status'] != 'corrected' and source['snapshot_text'] == record['raw_text']
    return source['snapshot_text'] in record['observations'] and source['quote'] in source['snapshot_text']


def _view(data, item, at=None):
    at = at or now()
    instant = parse_time(at)
    current = _source_current(data, item)
    reasons = []
    if item['status'] != 'confirmed':
        reasons.append('not_confirmed')
    if not current:
        reasons.append('source_changed')
    if parse_time(item['valid_from']) > instant:
        reasons.append('not_yet_effective')
    if item['expires_at'] and parse_time(item['expires_at']) <= instant:
        reasons.append('expired')
    if item['category'] == 'observation':
        reasons.append('observation_only')
    elder = next((row for row in data['elders'] if row['id'] == item['elder_id']), None)
    if not elder or elder.get('status') == 'discharged':
        reasons.append('elder_inactive')
    review_reasons = []
    events = [row for row in data['audit_logs'] if row['object_id'] == item['id']]
    last_review = max((i for i, event in enumerate(events) if event['action'] in {
        'memory_confirm', 'memory_keep', 'memory_resume', 'revise_memory'}), default=-1)
    refusals = [event for event in events[last_review + 1:] if event['action'] == 'report_memory_refusal']
    # Only current evidence is counted; corrected observations stay in audit history.
    current_refusals = []
    for event in refusals:
        source = event['refusal_source']
        record = next((r for r in data['care_records'] if r['id'] == source['record_id']), None)
        if record and record.get('revision', 1) == source['revision']:
            current_refusals.append(event)
    count = len({event['refusal_source']['record_id'] for event in current_refusals})
    due = bool(item['review_due_at'] and parse_time(item['review_due_at']) <= instant)
    # A completed human review resolves the due reminder without rewriting its historical date.
    last_revision = max((i for i, event in enumerate(events) if event['action'] == 'revise_memory'), default=-1)
    if due and not any(event['action'] in {'memory_keep', 'memory_resume'} and
                       parse_time(event['created_at']) >= parse_time(item['review_due_at']) for event in events[last_revision + 1:]):
        review_reasons.append('review_due')
    if count >= 3:
        review_reasons.append('repeated_refusal_reported')
    if not current:
        review_reasons.append('source_changed')
    if item['status'] == 'review_required':
        review_reasons.append('explicit_review_required')
    result = copy.deepcopy({key: value for key, value in item.items() if key != 'history'})
    result.update(effective=not reasons, source_current=current, blocked_reasons=reasons,
                  review_due=due, refusal_count=count, review_triggered=count >= 3,
                  review_state='pending' if review_reasons else 'not_required', review_reasons=review_reasons)
    return result


def _snapshot(item):
    return copy.deepcopy({key: value for key, value in item.items() if key != 'history'})


def _change(data, item, before, action, reason, user_id):
    item['revision'] += 1
    item['updated_at'] = now()
    change = {
        'previous_revision': before['revision'], 'revision': item['revision'],
        'action': action, 'reason': reason, 'created_by': user_id, 'created_at': item['updated_at'],
        'before': before, 'after': _snapshot(item),
    }
    item['history'].append(change)
    audit(data, action, item['id'], user_id, elder_id=item['elder_id'],
          record_id=item['source']['record_id'], detail=reason, memory_change=change)
    from app.services.change_review_service import reconcile
    reconcile(data, user_id, memory_id=item['id'])


def create(store: JsonStore, payload: MemoryCreateRequest, user_id: str, role: str, key=None):
    _staff(role)
    def mutate(data):
        current_staff(data, user_id, role)
        def operation():
            item = _create_candidate(data, payload, user_id)
            return _view(data, item)
        return replayable(data, user_id, 'create_memory', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def _create_candidate(data, payload: MemoryCreateRequest, user_id, candidate_source=None):
    from app.services.care_scope_service import require_elder_access
    actor = current_staff(data, user_id)
    require_elder_access(data, payload.elder_id, user_id, actor['role'])
    elder = find(data, 'elders', payload.elder_id, 'elder_not_found')
    if elder.get('status') == 'discharged':
        raise DomainError('elder_inactive')
    item = {
        'id': identifier('MEM'), 'elder_id': payload.elder_id, **_content(data, payload.elder_id, payload),
        'status': 'candidate', 'revision': 1, 'created_by': user_id, 'created_at': now(),
        'updated_at': now(), 'confirmed_by': None, 'confirmed_at': None, 'history': [],
        'candidate_source': candidate_source,
    }
    data['care_memories'].append(item)
    audit(data, 'create_memory', item['id'], user_id, elder_id=item['elder_id'],
          record_id=item['source']['record_id'], detail='提交个性化信息候选', after=_snapshot(item))
    return item


def create_from_draft(store, payload: MemoryFromDraftRequest, user_id, role, key=None):
    _staff(role)
    def mutate(data):
        current_staff(data, user_id, role)
        draft = find(data, 'ai_drafts', payload.draft_id, 'draft_not_found')
        editable(data, draft, user_id, role)
        def operation():
            if draft['status'] != 'confirmed' or draft.get('generation_kind') != 'context_record':
                raise DomainError('memory_requires_confirmed_context_draft')
            candidates = draft.get('memory_candidates', [])
            if payload.candidate_index >= len(candidates):
                raise DomainError('memory_candidate_not_found', 404)
            if any((row.get('candidate_source') or {}).get('draft_id') == draft['id'] and
                   row['candidate_source'].get('candidate_index') == payload.candidate_index for row in data['care_memories']):
                raise DomainError('memory_candidate_already_submitted')
            record = next((row for row in data['care_records'] if row.get('source_draft_id') == draft['id']), None)
            if record is None:
                raise DomainError('confirmed_draft_has_no_record')
            if record['elder_id'] != draft['elder_id']:
                raise DomainError('memory_source_elder_mismatch', 422)
            candidate = candidates[payload.candidate_index]
            try:
                request = MemoryCreateRequest(
                    elder_id=draft['elder_id'], content=candidate['content'], category=candidate['category'],
                    scenes=candidate['scenes'], attributed_to=candidate['attributed_to'],
                    source_record_id=record['id'], source_revision=payload.expected_record_revision,
                    source_field='observations', source_quote=candidate['evidence_text'],
                    valid_from=payload.valid_from, expires_at=payload.expires_at, review_due_at=payload.review_due_at,
                )
            except ValidationError as exc:
                raise DomainError('invalid_memory_candidate_scope_or_expiry', 422) from exc
            item = _create_candidate(data, request, user_id, candidate_source={
                'draft_id': draft['id'], 'candidate_index': payload.candidate_index, 'provider': draft['provider'],
            })
            return _view(data, item)
        return replayable(data, user_id, 'memory_from_draft', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def listing(store, elder_id, status=None, scene=None, limit=100, offset=0):
    data = store.read()
    find(data, 'elders', elder_id, 'elder_not_found')
    items = [row for row in data['care_memories'] if row['elder_id'] == elder_id
             and (status is None or row['status'] == status) and (scene is None or scene in row['scenes'])]
    at = now()
    return [_view(data, row, at) for row in sorted(items, key=lambda row: (row['updated_at'], row['id']), reverse=True)[offset:offset+limit]]


def detail(store, memory_id):
    return view_from_data(store.read(), memory_id)


def view_from_data(data, memory_id, at=None):
    return _view(data, find(data, 'care_memories', memory_id, 'memory_not_found'), at)


def history(store, memory_id, limit=100, offset=0):
    item = find(store.read(), 'care_memories', memory_id, 'memory_not_found')
    return copy.deepcopy(item['history'][offset:offset+limit])


def context(store, elder_id, scene):
    return context_from_data(store.read(), elder_id, scene)


def context_from_data(data, elder_id, scene):
    find(data, 'elders', elder_id, 'elder_not_found')
    at = now()
    memories = [_view(data, row, at) for row in data['care_memories']
                if row['elder_id'] == elder_id and scene in row['scenes']]
    return {'elder_id': elder_id, 'scene': scene, 'as_of': at,
            'memories': sorted([row for row in memories if row['effective']], key=lambda row: row['id'])}


def revise(store, memory_id, payload: MemoryRevisionRequest, user_id, role, key=None):
    _staff(role)
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'care_memories', memory_id, 'memory_not_found')
        editable(data, item, user_id, role)
        def operation():
            if item['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if item['status'] in TERMINAL:
                raise DomainError('memory_is_terminal')
            before = _snapshot(item)
            item.update(_content(data, item['elder_id'], payload), status='candidate', confirmed_by=None, confirmed_at=None,
                        candidate_source=None)  # The new human revision has its own source; history retains old provenance.
            _change(data, item, before, 'revise_memory', payload.reason, user_id)
            return _view(data, item)
        return replayable(data, user_id, 'revise_memory', key, {'memory_id': memory_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def review(store, memory_id, payload: MemoryReviewRequest, user_id, role, key=None):
    if role not in {'admin', 'supervisor'}:
        raise DomainError('management_required', 403)
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        item = find(data, 'care_memories', memory_id, 'memory_not_found')
        def operation():
            if item['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            allowed = {
                'confirm': {'candidate', 'review_required'}, 'request_review': {'confirmed'},
                'reject': {'candidate', 'review_required'}, 'retire': {'confirmed', 'review_required', 'suspended'},
                'keep': {'confirmed', 'review_required'}, 'suspend': {'confirmed', 'review_required'},
                'resume': {'suspended'},
            }
            if item['status'] not in allowed[payload.action]:
                raise DomainError('invalid_memory_transition')
            if payload.action in {'confirm', 'keep', 'resume'}:
                current = _view(data, item)
                if not current['source_current']:
                    raise DomainError('memory_source_revision_changed')
                if 'expired' in current['blocked_reasons'] or 'elder_inactive' in current['blocked_reasons']:
                    raise DomainError('memory_not_confirmable')
            before = _snapshot(item)
            item['status'] = {'confirm': 'confirmed', 'request_review': 'review_required',
                              'reject': 'rejected', 'retire': 'retired', 'keep': 'confirmed',
                              'suspend': 'suspended', 'resume': 'confirmed'}[payload.action]
            if payload.action in {'confirm', 'keep', 'resume'}:
                item.update(confirmed_by=user_id, confirmed_at=now())
            _change(data, item, before, 'memory_' + payload.action, payload.reason, user_id)
            return _view(data, item)
        return replayable(data, user_id, 'review_memory', key, {'memory_id': memory_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def report_refusal(store, memory_id, payload: MemoryRefusalRequest, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'care_memories', memory_id, 'memory_not_found')
        def operation():
            if item['status'] != 'confirmed':
                raise DomainError('memory_not_confirmed')
            record = find(data, 'care_records', payload.record_id, 'record_not_found')
            if role in {'caregiver', 'nurse'} and record.get('created_by') != user_id:
                if not record.get('shift_id'):
                    raise DomainError('refusal_evidence_not_accessible', 403)
                shift = find(data, 'shifts', record['shift_id'], 'shift_not_found')
                if user_id not in shift['caregiver_ids']:
                    raise DomainError('refusal_evidence_not_accessible', 403)
            if record['elder_id'] != item['elder_id']:
                raise DomainError('memory_source_elder_mismatch', 422)
            source = _source(data, item['elder_id'], MemoryContent(
                content=item['content'], category='observation', scenes=item['scenes'],
                source_record_id=record['id'], source_revision=payload.record_revision,
                source_field=payload.source_field, source_quote=payload.source_quote))
            # One source record is one observation, even if retried with a fresh key.
            if not any(row['action'] == 'report_memory_refusal' and row['object_id'] == memory_id and
                       row['refusal_source']['record_id'] == record['id'] and
                       row['refusal_source']['revision'] == payload.record_revision for row in data['audit_logs']):
                audit(data, 'report_memory_refusal', memory_id, user_id, elder_id=item['elder_id'],
                      actor_role=role, detail=payload.note, refusal_source=source,
                      happened_at=record.get('happened_at') or record['created_at'])
            return _view(data, item)
        return replayable(data, user_id, 'report_memory_refusal', key,
                          {'memory_id': memory_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def invalidate_record_source(data, record_id, user_id, reason):
    """Called within the record-correction transaction; never changes the source snapshot."""
    for item in data['care_memories']:
        if item['source']['record_id'] != record_id or item['status'] in TERMINAL:
            continue
        before = _snapshot(item)
        if item['status'] != 'suspended':
            item['status'] = 'review_required'
        _change(data, item, before, 'memory_source_changed', reason, user_id)
