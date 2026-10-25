"""Human-classified incident workflow with immutable submissions and separate review."""
import copy

from app.services import assessment_service as evidence_service
from app.services.facility_service import version
from app.services.family_service import admission
from app.services.workflow import DomainError, active_staff, audit, current_staff, find, identifier, now, parse_time, replayable


def evidence(data, item, sources):
    result = evidence_service._evidence(data, item['elder_id'], sources)
    for source in result:
        record = find(data, 'care_records', source['record_id'], 'record_not_found')
        if record.get('admission_id') != item['admission_id']:
            raise DomainError('incident_evidence_admission_mismatch', 422)
    return result


def access(data, item, user_id, role):
    if role in {'admin', 'supervisor'} or item['created_by'] == user_id:
        return
    if any(row['incident_id'] == item['id'] and row['assigned_to'] == user_id for row in data['rectifications']):
        return
    raise DomainError('incident_not_assigned_or_reported_by_you', 403)


def rectification(data, item_id):
    row = find(data, 'rectifications', item_id, 'rectification_not_found')
    incident = find(data, 'incidents', row['incident_id'], 'incident_not_found')
    return row, incident


def view(data, item):
    current = evidence_service.sources_current(data, item)
    result = copy.deepcopy(item)
    result['evidence_current'] = current
    result['rectification'] = None
    rect = next((r for r in data['rectifications'] if r['incident_id'] == item['id']), None)
    if rect:
        result['rectification'] = copy.deepcopy(rect)
        result['rectification']['overdue'] = rect['status'] != 'closed' and parse_time(rect['due_at']) < parse_time(now())
        pending = rect['submissions'][-1] if rect['submissions'] else None
        result['rectification']['submission_current'] = bool(pending and current and
            pending['incident_revision'] == item['revision'] and evidence_service.sources_current(data, pending))
    return result


def listing(store, user_id, role, elder_id=None, limit=100, offset=0):
    data = store.read()
    current_staff(data, user_id, role)
    result = []
    for row in reversed(data['incidents']):
        if elder_id is not None and row['elder_id'] != elder_id:
            continue
        try:
            access(data, row, user_id, role)
        except DomainError:
            continue
        result.append(view(data, row))
    return result[offset:offset + limit]


def get(store, item_id, user_id, role):
    data = store.read()
    current_staff(data, user_id, role)
    row = find(data, 'incidents', item_id, 'incident_not_found')
    access(data, row, user_id, role)
    return view(data, row)


def create(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role)
        from app.services.care_scope_service import require_elder_access
        require_elder_access(data, payload.elder_id, user_id, role)
        def operation():
            admission(data, payload.elder_id, payload.admission_id)
            if payload.occurred_at > parse_time(now()):
                raise DomainError('incident_occurrence_in_future', 422)
            item = {'id': identifier('INCIDENT'), **payload.model_dump(mode='json', exclude={'evidence'}),
                    'status': 'reported', 'revision': 1, 'created_by': user_id, 'created_at': now(), 'history': []}
            item['evidence'] = evidence(data, item, payload.evidence)
            data['incidents'].append(item)
            audit(data, 'report_incident', item['id'], user_id, elder_id=item['elder_id'], detail='人工上报待主管判断')
            return view(data, item)
        return replayable(data, user_id, 'report_incident', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def prepare(store, payload, user_id, role):
    from time import perf_counter
    from app.services.care_scope_service import require_elder_access
    from app.services.ai_service import AIProviderError, get_ai_provider
    from app.services.ai_outputs import validate_citations
    data = store.read()
    require_elder_access(data, payload.elder_id, user_id, role)
    sources = [{'source_id': 'description', 'text': payload.description}]
    if payload.immediate_action:
        sources.append({'source_id': 'immediate_action', 'text': payload.immediate_action})
    provider = get_ai_provider()
    start = perf_counter()
    try:
        output = validate_citations(provider.summarize(sources), sources, 'summary')
    except DomainError:
        raise
    except (ValueError, TypeError, KeyError) as exc:
        raise AIProviderError('incident_preparation_output_invalid') from exc
    require_elder_access(store.read(), payload.elder_id, user_id, role)
    return {'facts_draft': output['points'], 'missing': [name for name, value in (
        ('发生时间', payload.occurred_at), ('已采取措施', payload.immediate_action)) if value is None],
        'provider': provider.name, 'elapsed_ms': round((perf_counter() - start) * 1000),
        'status': 'draft', 'warning': '仅辅助整理原文，不能据此认定事件、等级、责任或医疗处置；人工上报无需等待本功能。'}


def triage(store, item_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'incidents', item_id, 'incident_not_found')
            version(item, payload.expected_revision)
            if item['status'] == 'closed':
                raise DomainError('reopen_incident_before_changes')
            active_staff(data, payload.assigned_to)
            if payload.due_at <= parse_time(now()):
                raise DomainError('rectification_due_must_be_future', 422)
            sources = evidence(data, item, payload.evidence)
            item['history'].append({'by': user_id, 'at': now(), 'action': 'triage', 'reason': payload.reason,
                                    'before': {k: copy.deepcopy(v) for k, v in item.items() if k != 'history'}})
            item.update(category=payload.category, severity=payload.severity,
                        classification_basis=payload.classification_basis, evidence=sources,
                        status='rectifying', revision=item['revision'] + 1, classified_by=user_id, classified_at=now())
            rect = next((r for r in data['rectifications'] if r['incident_id'] == item_id), None)
            if rect:
                rect['history'].append({'action': 'retriage', 'at': now(), 'by': user_id,
                                        'before': {k: copy.deepcopy(v) for k, v in rect.items() if k != 'history'}})
                rect['revision'] += 1
            else:
                rect = {'id': identifier('RECTIFY'), 'incident_id': item_id, 'elder_id': item['elder_id'],
                        'revision': 1, 'created_at': now(), 'submissions': [], 'reviews': [], 'history': []}
                data['rectifications'].append(rect)
            rect.update(status='assigned', assigned_to=payload.assigned_to, due_at=payload.due_at.isoformat(),
                        corrective_plan=payload.corrective_plan, updated_at=now())
            audit(data, 'triage_incident', item_id, user_id, elder_id=item['elder_id'], rectification_id=rect['id'], detail=payload.reason)
            return view(data, item)
        return replayable(data, user_id, 'triage_incident', key, {'id': item_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def assign(store, rect_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            rect, item = rectification(data, rect_id)
            version(rect, payload.expected_revision)
            if rect['status'] == 'closed':
                raise DomainError('rectification_closed')
            active_staff(data, payload.assigned_to)
            if payload.due_at <= parse_time(now()):
                raise DomainError('rectification_due_must_be_future', 422)
            rect['history'].append({'action': 'assign', 'at': now(), 'by': user_id, 'reason': payload.reason,
                                    'previous_assignee': rect['assigned_to'], 'previous_due_at': rect['due_at']})
            rect.update(assigned_to=payload.assigned_to, due_at=payload.due_at.isoformat(),
                        status='assigned', revision=rect['revision'] + 1, updated_at=now())
            audit(data, 'assign_rectification', item['id'], user_id, elder_id=item['elder_id'], detail=payload.reason)
            return view(data, item)
        return replayable(data, user_id, 'assign_rectification', key, {'id': rect_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def submit(store, rect_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role)
        rect, item = rectification(data, rect_id)
        # Responsibility is checked before a retry can return old submissions.
        if rect['assigned_to'] != user_id:
            raise DomainError('only_rectification_assignee_can_submit', 403)
        def operation():
            version(rect, payload.expected_revision)
            version(item, payload.expected_incident_revision)
            if rect['status'] not in {'assigned', 'awaiting_review'}:
                raise DomainError('rectification_closed')
            if not evidence_service.sources_current(data, item):
                raise DomainError('incident_evidence_changed_retriage_required')
            sources = evidence(data, item, payload.evidence)
            rect['submissions'].append({'id': identifier('SUBMIT'), 'elder_id': item['elder_id'], 'by': user_id,
                'at': now(), 'incident_revision': item['revision'], 'result': payload.result, 'evidence': sources})
            rect.update(status='awaiting_review', revision=rect['revision'] + 1, updated_at=now())
            audit(data, 'submit_rectification', item['id'], user_id, elder_id=item['elder_id'])
            return view(data, item)
        return replayable(data, user_id, 'submit_rectification', key, {'id': rect_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def review(store, rect_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            rect, item = rectification(data, rect_id)
            version(rect, payload.expected_revision)
            version(item, payload.expected_incident_revision)
            if rect['status'] != 'awaiting_review':
                raise DomainError('rectification_not_awaiting_review')
            submission = rect['submissions'][-1]
            if submission['by'] == user_id:
                raise DomainError('independent_rectification_reviewer_required', 403)
            if payload.decision == 'accept':
                if (submission['incident_revision'] != item['revision'] or
                        not evidence_service.sources_current(data, item) or not evidence_service.sources_current(data, submission)):
                    raise DomainError('rectification_sources_changed')
            rect['reviews'].append({'by': user_id, 'at': now(), 'decision': payload.decision,
                                    'note': payload.note, 'submission_id': submission['id']})
            rect.update(status='closed' if payload.decision == 'accept' else 'assigned',
                        revision=rect['revision'] + 1, updated_at=now())
            if payload.decision == 'accept':
                item.update(status='closed', revision=item['revision'] + 1, closed_at=now(), closed_by=user_id)
            audit(data, 'review_rectification', item['id'], user_id, elder_id=item['elder_id'], decision=payload.decision)
            return view(data, item)
        return replayable(data, user_id, 'review_rectification', key, {'id': rect_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def reopen(store, item_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'incidents', item_id, 'incident_not_found')
            version(item, payload.expected_revision)
            rect = next((r for r in data['rectifications'] if r['incident_id'] == item_id), None)
            if item['status'] != 'closed' or rect is None:
                raise DomainError('incident_not_closed')
            version(rect, payload.expected_rectification_revision)
            # Closed responsibility may have been disabled since closure.
            active_staff(data, payload.assigned_to)
            if payload.due_at <= parse_time(now()):
                raise DomainError('rectification_due_must_be_future', 422)
            rect['history'].append({'action': 'reopen', 'at': now(), 'by': user_id, 'reason': payload.reason})
            rect.update(status='assigned', assigned_to=payload.assigned_to, due_at=payload.due_at.isoformat(),
                        revision=rect['revision'] + 1, updated_at=now())
            item.update(status='rectifying', revision=item['revision'] + 1, closed_at=None, closed_by=None)
            audit(data, 'reopen_incident', item_id, user_id, elder_id=item['elder_id'], detail=payload.reason)
            return view(data, item)
        return replayable(data, user_id, 'reopen_incident', key, {'id': item_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
