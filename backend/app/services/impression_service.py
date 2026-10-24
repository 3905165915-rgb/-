"""Longitudinal impressions: grounded suggestions, never automatic care orders."""
from __future__ import annotations

import copy
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone

from pydantic import ValidationError

from app.schemas.impression import ImpressionOutput
from app.services.ai_service import AIProviderError, MockAIProvider, get_ai_provider
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, parse_time, replayable

MAX_RECORDS = 240
MAX_CHARACTERS = 160000
BATCH_RECORDS = 24
BATCH_CHARACTERS = 14000
DEMO_MARKER = '【模拟长期照护】'


def _snapshot(data, elder_id, user_id, role):
    current_staff(data, user_id, role)
    elder = find(data, 'elders', elder_id, 'elder_not_found')
    rows = []
    for record in data['care_records']:
        if record['elder_id'] != elder_id or record.get('status') not in {'confirmed', 'corrected'}:
            continue
        # Always use current observations, not an obsolete immutable raw narrative.
        texts = record.get('observations', [])
        if not texts or not any(text.strip() for text in texts):
            continue
        rows.append({
            'source_id': record['id'], 'revision': record.get('revision', 1),
            'happened_at': record.get('happened_at') or record['created_at'],
            'recorded_at': record['created_at'], 'text': '\n'.join(texts),
            'simulated': DEMO_MARKER in record.get('raw_text', ''),
        })
    rows.sort(key=lambda row: (parse_time(row['happened_at']), row['source_id']))
    fingerprint = hashlib.sha256(json.dumps({'elder': {
        'id': elder['id'], 'revision': elder.get('revision', 1), 'status': elder.get('status'),
    }, 'sources': rows}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return elder, rows, fingerprint


def _batches(sources):
    batch, size = [], 0
    for source in sources:
        length = len(source['text'])
        if length > BATCH_CHARACTERS:
            raise DomainError('impression_record_too_long', 422)
        if batch and (len(batch) >= BATCH_RECORDS or size + length > BATCH_CHARACTERS):
            yield batch
            batch, size = [], 0
        batch.append(source)
        size += length
    if batch:
        yield batch


def _validate(output, sources):
    try:
        points = ImpressionOutput.model_validate(output).model_dump()['points']
        lookup = {source['source_id']: source for source in sources}
        for point in points:
            seen = set()
            for citation in point['citations']:
                source = lookup.get(citation['source_id'])
                if not source or citation['quote'] not in source['text']:
                    raise ValueError('Ungrounded impression evidence')
                key = (citation['source_id'], citation['quote'])
                if key in seen:
                    raise ValueError('Duplicate citation')
                seen.add(key)
            days = {parse_time(lookup[c['source_id']]['happened_at']).astimezone(timezone(timedelta(hours=8))).date()
                    for c in point['citations']}
            # Three separate days is a presentation threshold, NOT statistical proof.
            if point['kind'] == 'trend' and len(days) < 3:
                point['kind'] = 'observation'
            point['supporting_days'] = len(days)
            point['supporting_records'] = len({c['source_id'] for c in point['citations']})
        return points
    except (ValidationError, ValueError, TypeError, KeyError) as exc:
        raise AIProviderError('Invalid longitudinal impression or source evidence') from exc


def _point_memory(data, report_id, point_id, elder_id):
    # The immutable creation link survives a human revision. Its active evidence
    # may change independently, but the same point must never create two memories.
    return next((m for m in data['care_memories'] if m['elder_id'] == elder_id and
        (m.get('impression_origin') or m.get('candidate_source') or {}).get('impression_id') == report_id and
        (m.get('impression_origin') or m.get('candidate_source') or {}).get('point_id') == point_id), None)


def _view(data, report, user_id, role):
    _, sources, fingerprint = _snapshot(data, report['elder_id'], user_id, role)
    result = copy.deepcopy(report)
    result['source_current'] = fingerprint == report['source_fingerprint']
    result['new_record_count'] = len({r['source_id'] for r in sources} - {r['source_id'] for r in report['sources']})
    result['review_due'] = parse_time(now()) >= parse_time(report['review_due_at'])
    result['needs_review'] = (not result['source_current'] or result['review_due'] or
                              any(p['status'] == 'candidate' for p in report['points']))
    actors = {u['id']: u.get('display_name', '工作人员') for u in data['users']}
    for point in result['points']:
        point['reviewed_by_name'] = actors.get(point.get('reviewed_by'))
        memory = _point_memory(data, report['id'], point['id'], report['elder_id'])
        if memory:
            from app.services.memory_service import _view as memory_view
            current = memory_view(data, memory)
            point['care_memory'] = {k: current[k] for k in ('id', 'status', 'effective')}
    return result


def listing(store, elder_id, user_id, role):
    data = store.read()
    _snapshot(data, elder_id, user_id, role)
    reports = [r for r in data['elder_impressions'] if r['elder_id'] == elder_id]
    reports.sort(key=lambda r: r['created_at'], reverse=True)
    latest = _view(data, reports[0], user_id, role) if reports else None
    return {'latest': latest, 'history': [{
        'id': r['id'], 'created_at': r['created_at'], 'record_count': r['coverage']['record_count'],
    } for r in reports[:30]]}


def detail(store, elder_id, report_id, user_id, role):
    data = store.read()
    report = find(data, 'elder_impressions', report_id, 'impression_not_found')
    if report['elder_id'] != elder_id:
        raise DomainError('impression_not_found', 404)
    return _view(data, report, user_id, role)


def generate(store, elder_id, user_id, role):
    data = store.read()
    elder, sources, fingerprint = _snapshot(data, elder_id, user_id, role)
    if elder.get('status') == 'discharged':
        raise DomainError('elder_inactive', 409)
    if not sources:
        raise DomainError('impression_no_records', 422)
    if len(sources) > MAX_RECORDS or sum(len(s['text']) for s in sources) > MAX_CHARACTERS:
        raise DomainError('impression_history_too_large', 422)
    provider = get_ai_provider()
    existing = next((r for r in reversed(data['elder_impressions']) if r['elder_id'] == elder_id and
                     r['provider'] == provider.name and
                     r['source_fingerprint'] == fingerprint and not _view(data, r, user_id, role)['review_due']), None)
    if existing:
        return _view(data, existing, user_id, role)
    batches = list(_batches(sources))
    candidates = []
    # Calls deliberately run outside the write lock. No mock fallback on failure.
    def analyze(batch):
        return _validate(provider.impression(batch), batch)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for points in pool.map(analyze, batches):
            candidates.extend(points)
    if len(batches) > 1:
        # Carry verbatim evidence into the merge, still validate against originals.
        points = _validate(provider.impression(sources, candidates=candidates), sources)
    else:
        points = candidates
    stamp = now()
    for index, point in enumerate(points):
        point.update(id=f'point-{index + 1}', status='candidate', revision=1,
                     reviewed_by=None, reviewed_at=None, review_note=None, reviews=[])
    report = {
        'id': identifier('IMP'), 'elder_id': elder_id, 'created_at': stamp, 'created_by': user_id,
        'provider': provider.name, 'model_status': 'demo' if isinstance(provider, MockAIProvider) else 'available',
        'source_fingerprint': fingerprint, 'sources': sources, 'points': points,
        'review_due_at': (parse_time(stamp) + timedelta(days=30)).isoformat(),
        'coverage': {'record_count': len(sources), 'from': sources[0]['happened_at'],
                     'to': sources[-1]['happened_at'], 'batch_count': len(batches),
                     'simulated_count': sum(s['simulated'] for s in sources)},
    }
    def save(current):
        _, _, fresh = _snapshot(current, elder_id, user_id, role)
        if fresh != fingerprint:
            raise DomainError('impression_sources_changed')
        # Simultaneous retries share one version even across browsers.
        previous = next((r for r in reversed(current['elder_impressions']) if r['elder_id'] == elder_id and
                         r['provider'] == provider.name and
                         r['source_fingerprint'] == fingerprint and
                         parse_time(r['review_due_at']) > parse_time(now())), None)
        if previous:
            return _view(current, previous, user_id, role)
        current['elder_impressions'].append(report)
        audit(current, 'generate_elder_impression', report['id'], user_id, elder_id=elder_id,
              record_count=len(sources), provider=provider.name)
        return _view(current, report, user_id, role)
    return store.mutate(save)


def review(store, elder_id, report_id, point_id, payload, user_id, role):
    def update(data):
        current_staff(data, user_id, role, management=True)
        report = find(data, 'elder_impressions', report_id, 'impression_not_found')
        if report['elder_id'] != elder_id:
            raise DomainError('impression_not_found', 404)
        point = next((p for p in report['points'] if p['id'] == point_id), None)
        if point is None:
            raise DomainError('impression_point_not_found', 404)
        if point['status'] == payload.decision and point.get('review_note') == payload.note:
            return _view(data, report, user_id, role)
        if point['revision'] != payload.expected_revision:
            raise DomainError('stale_revision')
        if payload.decision == 'confirmed':
            if not _view(data, report, user_id, role)['source_current']:
                raise DomainError('impression_sources_changed')
            latest = next(r for r in reversed(data['elder_impressions']) if r['elder_id'] == elder_id)
            if latest['id'] != report_id or parse_time(report['review_due_at']) <= parse_time(now()):
                raise DomainError('impression_historical_review')
        point['reviews'].append({'status': point['status'], 'revision': point['revision'],
                                  'reviewed_by': point.get('reviewed_by'), 'reviewed_at': point.get('reviewed_at'),
                                  'note': point.get('review_note')})
        point.update(status=payload.decision, revision=point['revision'] + 1,
                     reviewed_by=user_id, reviewed_at=now(), review_note=payload.note)
        audit(data, 'review_elder_impression', report_id, user_id, elder_id=elder_id,
              point_id=point_id, decision=payload.decision, note=payload.note)
        return _view(data, report, user_id, role)
    return store.mutate(update)


def activate_memory(store, elder_id, report_id, point_id, payload, user_id, role, key=None):
    """Promote a reviewed life preference atomically; never execute a model action."""
    from app.schemas.memory import MemoryCreateRequest
    from app.services import memory_service

    def mutate(data):
        current_staff(data, user_id, role, management=True)
        report = find(data, 'elder_impressions', report_id, 'impression_not_found')
        if report['elder_id'] != elder_id:
            raise DomainError('impression_not_found', 404)
        point = next((p for p in report['points'] if p['id'] == point_id), None)
        if point is None:
            raise DomainError('impression_point_not_found', 404)

        def operation():
            previous = _point_memory(data, report_id, point_id, elder_id)
            if previous:
                # An uncertain duplicate may read its receipt, never silently
                # change or reactivate an existing care instruction.
                origin = previous.get('impression_origin') or previous.get('candidate_source') or {}
                if origin.get('activation_request') != payload.model_dump(mode='json'):
                    raise DomainError('impression_memory_already_created')
                return memory_service._view(data, previous)
            if point['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            latest = next(r for r in reversed(data['elder_impressions']) if r['elder_id'] == elder_id)
            if latest['id'] != report_id or parse_time(report['review_due_at']) <= parse_time(now()):
                raise DomainError('impression_historical_review')
            if not _view(data, report, user_id, role)['source_current']:
                raise DomainError('impression_sources_changed')
            if point['status'] != 'confirmed':
                raise DomainError('impression_point_requires_review', 422)
            if (point['kind'] != 'trend' or point['category'] == 'attention' or
                    payload.category not in {'stable_preference', 'communication'}):
                raise DomainError('impression_not_long_term_preference', 422)
            citation = next((c for c in point['citations'] if c['source_id'] == payload.source_record_id and
                             c['quote'] == payload.source_quote), None)
            source = next((s for s in report['sources'] if s['source_id'] == payload.source_record_id), None)
            if (citation is None or source is None or payload.source_field != 'observations' or
                    source['revision'] != payload.source_revision):
                raise DomainError('impression_memory_evidence_mismatch', 422)
            request = MemoryCreateRequest(elder_id=elder_id, **payload.model_dump(exclude={'expected_revision', 'reason'}))
            memory = memory_service._create_candidate(data, request, user_id, candidate_source={
                'impression_id': report_id, 'point_id': point_id, 'point_revision': point['revision'],
                'citations': copy.deepcopy(point['citations']),
                'source_versions': {c['source_id']: next(s['revision'] for s in report['sources']
                    if s['source_id'] == c['source_id']) for c in point['citations']},
                'activation_request': payload.model_dump(mode='json'),
            })
            memory['impression_origin'] = {
                'impression_id': report_id, 'point_id': point_id,
                'activation_request': payload.model_dump(mode='json'),
            }
            before = memory_service._snapshot(memory)
            memory.update(status='confirmed', confirmed_by=user_id, confirmed_at=now())
            memory_service._change(data, memory, before, 'memory_confirm', payload.reason, user_id)
            audit(data, 'activate_impression_memory', memory['id'], user_id, elder_id=elder_id,
                  impression_id=report_id, point_id=point_id, detail=payload.reason)
            return memory_service._view(data, memory)
        return replayable(data, user_id, 'activate_impression_memory', key,
            {'elder_id': elder_id, 'report_id': report_id, 'point_id': point_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)
