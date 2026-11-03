"""Record selection for human-reviewed family updates, with server-owned evidence."""
from datetime import datetime, time, timedelta, timezone
import hashlib
import json

from app.schemas.family import SummaryCreate
from app.services import family_service as family
from app.services.elder_workspace_service import TransactionStore
from app.services.listing_service import page
from app.services.report_service import stamp
from app.services.workflow import DomainError, current_staff, find, now, parse_time, replayable

CHINA = timezone(timedelta(hours=8))


def recipients(data, elder_id, admission_id):
    ids = {b['family_id'] for b in family.rows(data, 'binding')
           if b['elder_id'] == elder_id and b['admission_id'] == admission_id
           and 'summary' in b.get('scopes', []) and family.effective(data, b)}
    # Preserve the existing explicit synthetic demo-account projection.
    for user in data['users']:
        if user.get('role') == 'family' and user.get('active', True):
            if any(b['elder_id'] == elder_id for b in family.demo_bindings(data, user['id'])):
                ids.add(user['id'])
    return [{'id': u['id'], 'display_name': u.get('display_name', '家属')}
            for u in data['users'] if u['id'] in ids]


def current_stay(data, elder_id, required=True):
    elder = find(data, 'elders', elder_id, 'elder_not_found')
    stay = next((s for s in data['admissions'] if s['id'] == elder.get('current_admission_id')
                 and s['elder_id'] == elder_id and s['status'] in {'active', 'out'}), None)
    if stay:
        family.admission(data, elder_id, stay['id'])
    elif required:
        raise DomainError('summary_current_admission_required')
    return elder, stay


def period(start, end):
    if any(value is not None and (value.tzinfo is None or value.utcoffset() is None) for value in (start, end)):
        raise DomainError('summary_period_invalid', 422)
    instant = parse_time(now())
    upper = end or instant
    lower = start or datetime.combine(upper.astimezone(CHINA).date(), time.min, tzinfo=CHINA)
    if not lower < upper <= instant:
        raise DomainError('summary_period_invalid', 422)
    return lower, upper


def workspace(store, elder_id, user_id, role, start=None, end=None, limit=50, offset=0):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    elder, stay = current_stay(data, elder_id, required=False)
    lower, upper = period(start, end)
    candidates = []
    for record in data['care_records']:
        if not stay or record['elder_id'] != elder_id or record.get('admission_id') != stay['id']:
            continue
        at = stamp(record.get('happened_at') or record.get('created_at'))
        if at is not None and not lower <= at < upper:
            continue
        fragments = [line[:1000] for line in record.get('observations', []) if line.strip()]
        reason = ('记录时间待核实' if at is None else '记录尚未正式确认' if record.get('status') not in {'confirmed', 'corrected'}
                  else '尚无可核对的正式观察内容' if not fragments else None)
        candidates.append({'record_id': record['id'], 'revision': record.get('revision', 1),
                           'happened_at': at.isoformat() if at else None, 'recorded_at': record.get('recorded_at') or record.get('created_at'),
                           'public_fragments': fragments, 'suggested_quote': fragments[0] if fragments else '',
                           'selectable': reason is None, 'unavailable_reason': reason})
    candidates.sort(key=lambda r: (stamp(r['recorded_at']) or datetime.min.replace(tzinfo=timezone.utc), r['record_id']), reverse=True)
    audience = recipients(data, elder_id, stay['id']) if stay else []
    return {**page(candidates, limit, offset), 'elder': {'id': elder_id, 'name': elder['name']},
            'current_admission_id': stay['id'] if stay else None,
            'context_notice': None if stay else '该老人暂无有效入住，无法创建或发布本次简报。',
            'period_start': lower.isoformat(), 'period_end': upper.isoformat(),
            'recipients': audience, 'recipient_count': len(audience), 'can_publish': bool(audience),
            'audience_label': '发布后对当前有效授权家属可见', 'max_sources': 10, 'max_text_length': 2000}


def resolve(data, payload):
    _, stay = current_stay(data, payload.elder_id)
    lower, upper = period(payload.period_start, payload.period_end)
    evidence = []
    for selection in payload.selections:
        record = find(data, 'care_records', selection.record_id, 'record_not_found')
        at = stamp(record.get('happened_at') or record.get('created_at'))
        if record['elder_id'] != payload.elder_id or record.get('admission_id') != stay['id']:
            raise DomainError('summary_evidence_admission_mismatch', 422)
        if at is None or not lower <= at < upper:
            raise DomainError('summary_evidence_outside_period', 422)
        fragments = [line for line in record.get('observations', []) if line.strip()]
        quote = selection.public_quote or (fragments[0][:1000] if fragments else '')
        if not quote:
            raise DomainError('summary_selection_changed')
        evidence.append({'record_id': record['id'], 'revision': record.get('revision', 1), 'field': 'observations', 'quote': quote})
    text = payload.text or '\n'.join(e['quote'] for e in evidence)
    if len(text) > 2000:
        raise DomainError('summary_text_too_long', 422)
    request = SummaryCreate(elder_id=payload.elder_id, admission_id=stay['id'],
        period_start=lower, period_end=upper, text=text, evidence=evidence)
    family.evidence_service._evidence(data, payload.elder_id, request.evidence)
    context = {'elder_id': payload.elder_id, 'admission_id': stay['id'], 'admission_revision': stay.get('revision', 1),
               'period_start': lower.isoformat(), 'period_end': upper.isoformat(), 'evidence': evidence, 'text': request.text}
    token = hashlib.sha256(json.dumps(context, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return request, token


def preview(store, payload, user_id, role):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    if not payload.public_quotes_confirmed:
        raise DomainError('summary_public_quotes_need_confirmation', 422)
    request, token = resolve(data, payload)
    audience = recipients(data, payload.elder_id, request.admission_id)
    return {'preview': True, 'context_token': token,
            'family_preview': {k: v for k, v in request.model_dump(mode='json').items() if k not in {'admission_id', 'evidence'}},
            'evidence_context': {'admission_id': request.admission_id, 'evidence': request.model_dump(mode='json')['evidence']},
            'recipients': audience, 'recipient_count': len(audience), 'can_publish': bool(audience),
            'audience_label': '发布后对当前有效授权家属可见', 'timezone': 'Asia/Shanghai'}


def create(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            if not payload.public_quotes_confirmed:
                raise DomainError('summary_public_quotes_need_confirmation', 422)
            request, token = resolve(data, payload)
            if token != payload.expected_context_token:
                raise DomainError('summary_selection_changed')
            return family.create_summary(TransactionStore(data), request, user_id, role)
        return replayable(data, user_id, 'create_selected_family_summary', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)
