"""Versioned human ADL assessments, not automated clinical or subsidy decisions."""
import copy

from pydantic import ValidationError

from app.services.facility_service import care_eligible, version
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, parse_time, replayable


# Common ten-item, 0-100 Barthel convention. This is a separately versioned demo
# configuration, not GB/T 42195 or an official local long-term-care classification.
ITEMS = [
    ('feeding', '进食', [(0, '不能独立完成'), (5, '需要部分帮助'), (10, '可独立完成')]),
    ('bathing', '洗澡', [(0, '需要帮助'), (5, '可独立完成')]),
    ('grooming', '修饰', [(0, '需要帮助'), (5, '可独立完成')]),
    ('dressing', '穿衣', [(0, '不能独立完成'), (5, '需要部分帮助'), (10, '可独立完成')]),
    ('bowels', '大便控制', [(0, '失禁或依赖帮助'), (5, '偶有失控'), (10, '可控制')]),
    ('bladder', '小便控制', [(0, '失禁或依赖帮助'), (5, '偶有失控'), (10, '可控制')]),
    ('toilet', '如厕', [(0, '依赖帮助'), (5, '需要部分帮助'), (10, '可独立完成')]),
    ('transfer', '床椅转移', [(0, '不能完成'), (5, '需要大量帮助'), (10, '需要少量帮助'), (15, '可独立完成')]),
    ('mobility', '平地移动', [(0, '不能完成'), (5, '可独立使用轮椅'), (10, '需要他人帮助行走'), (15, '可独立行走')]),
    ('stairs', '上下楼梯', [(0, '不能完成'), (5, '需要帮助'), (10, '可独立完成')]),
]


def templates():
    return [{'id': 'barthel_basic_v1', 'name': 'Barthel ADL基础计分（演示配置）', 'version': 1,
             'max_score': 100, 'automatic_care_level': False,
             'reference_url': 'https://www.sralab.org/rehabilitation-measures/barthel-index',
             'reference_checked_on': '2026-10-20',
             'notice': '条目描述为界面摘要，使用前须由机构确认评估操作规范；不替代GB/T 42195、医疗诊断或长护险认定。',
             'items': [{'key': key, 'label': label, 'options': [{'score': score, 'label': text} for score, text in choices]}
                       for key, label, choices in ITEMS]}]


def prefill(store, payload, user_id, role):
    from datetime import timedelta
    from app.schemas.planning import AssessmentPrefillOutput
    from app.services.ai_service import AIProviderError, get_ai_provider

    data = store.read()
    current_staff(data, user_id, role)
    from app.services.care_scope_service import require_elder_access
    from app.services.facility_service import care_state
    require_elder_access(data, payload.elder_id, user_id, role)
    elder = care_eligible(data, payload.elder_id)
    initial_state = care_state(elder)
    instant = parse_time(now())
    cutoff = instant - timedelta(days=payload.lookback_days)
    records = [row for row in data['care_records'] if row['elder_id'] == payload.elder_id
               and row.get('admission_id') == elder.get('current_admission_id')
               and row.get('status') in {'confirmed', 'corrected'} and row.get('observations')
               and cutoff <= parse_time(row.get('happened_at') or row['created_at']) <= instant]
    records.sort(key=lambda row: (parse_time(row.get('happened_at') or row['created_at']), row['id']))
    selected = records[-30:]
    sources = [{'record_id': row['id'], 'revision': row.get('revision', 1),
                'happened_at': row.get('happened_at') or row['created_at'],
                'text': '\n'.join(row['observations'])} for row in selected]
    if sum(len(source['text']) for source in sources) > 14000:
        raise DomainError('assessment_prefill_scope_too_large', 422)
    latest = next((row for row in reversed(data['assessments']) if row['elder_id'] == payload.elder_id
                   and row.get('admission_id') == elder.get('current_admission_id')
                   and row['status'] in {'confirmed', 'retired'}), None)
    previous = None if not latest else {'id': latest['id'], 'assessed_at': latest['assessed_at'],
        'revision': latest['revision'], 'status': latest['status'], 'scores': latest['scores'],
        'total_score': latest['total_score'], 'note': latest['note']}
    provider = get_ai_provider()
    raw = provider.assessment_prefill(sources, templates()[0]['items'], previous) if sources else {
        'items': [{'item_key': key, 'score': None, 'citations': [],
                   'question': f'本次请观察并说明老人{label}时需要哪些帮助。'} for key, label, _ in ITEMS]}
    try:
        result = AssessmentPrefillOutput.model_validate(raw)
        lookup = {row['record_id']: row for row in sources}
        keys = {key for key, _, _ in ITEMS}
        values = {item.item_key: item for item in result.items}
        if set(values) != keys or len(values) != len(result.items):
            raise ValueError('Incomplete assessment prefill')
        choices = {key: {score for score, _ in options} for key, _, options in ITEMS}
        for item in result.items:
            if item.score is not None and (item.score not in choices[item.item_key] or not item.citations or item.conflict):
                raise ValueError('Unsupported prefilled score')
            for evidence in item.citations:
                source = lookup.get(evidence.record_id)
                if not source or evidence.revision != source['revision'] or evidence.field != 'observations' or evidence.quote not in source['text']:
                    raise ValueError('Unverifiable assessment evidence')
            if item.score is None and item.citations and not item.conflict:
                raise ValueError('An unanswered item cannot claim a proposed answer')
            if item.conflict and len({e.record_id for e in item.citations}) < 2:
                raise ValueError('A conflict requires distinct source records')
        # Slow model work cannot outlive permissions or a changed source.
        current = store.read()
        current_staff(current, user_id, role)
        require_elder_access(current, payload.elder_id, user_id, role)
        if care_state(care_eligible(current, payload.elder_id)) != initial_state:
            raise DomainError('assessment_prefill_context_changed')
        for source in sources:
            record = find(current, 'care_records', source['record_id'], 'record_not_found')
            if (record.get('revision', 1) != source['revision'] or record.get('status') not in {'confirmed', 'corrected'}
                    or '\n'.join(record['observations']) != source['text']):
                raise DomainError('assessment_prefill_context_changed')
        return {'elder_id': payload.elder_id, 'as_of': instant.isoformat(),
                'lookback_days': payload.lookback_days, 'provider': provider.name,
                'model_status': 'demo' if provider.name == 'mock' else 'available',
                'items': [item.model_dump(mode='json') for item in result.items],
                'previous': previous,
                'coverage': {'included_records': len(sources), 'available_records': len(records),
                             'excluded_records': len(records) - len(sources),
                             'notice': '模型预填仅供本次核对；旧结果不自动视为当前观察，缺少依据的项目保持待观察。'}}
    except DomainError:
        raise
    except (ValidationError, ValueError, TypeError, KeyError) as exc:
        raise AIProviderError('Invalid assessment prefill or evidence') from exc


def _evidence(data, elder_id, values):
    result = []
    for value in values:
        record = find(data, 'care_records', value.record_id, 'record_not_found')
        if record['elder_id'] != elder_id:
            raise DomainError('assessment_evidence_elder_mismatch', 422)
        if record.get('revision', 1) != value.revision or record.get('status') not in {'confirmed', 'corrected'}:
            raise DomainError('assessment_evidence_not_current')
        if value.field == 'raw_text' and (record.get('revision', 1) != 1 or record['status'] == 'corrected'):
            raise DomainError('corrected_source_requires_observations', 422)
        texts = [record['raw_text']] if value.field == 'raw_text' else record['observations']
        text = next((text for text in texts if value.quote in text), None)
        if text is None:
            raise DomainError('assessment_evidence_quote_not_found', 422)
        result.append({**value.model_dump(), 'snapshot_text': text})
    return result


def sources_current(data, item):
    for source in item['evidence']:
        if source.get('source_type') == 'direct_observation':
            if not source.get('snapshot_text') or source.get('quote') != source.get('snapshot_text'):
                return False
            continue
        record = next((row for row in data['care_records'] if row['id'] == source['record_id']), None)
        if not record or record['elder_id'] != item['elder_id'] or record.get('revision', 1) != source['revision']:
            return False
        if record.get('status') not in {'confirmed', 'corrected'}:
            return False
        if source['field'] == 'raw_text':
            if record.get('revision', 1) != 1 or record['status'] == 'corrected':
                return False
            texts = [record['raw_text']]
        else:
            texts = record['observations']
        if source['snapshot_text'] not in texts or source['quote'] not in source['snapshot_text']:
            return False
    return bool(item['evidence'] or item.get('direct_observations'))


def _normalized_answers(data, payload, user_id):
    allowed = {name: {score for score, _ in choices} for name, _, choices in ITEMS}
    if not set(payload.scores).issubset(allowed):
        raise DomainError('invalid_assessment_scores', 422)
    if any(score is not None and score not in allowed[name] for name, score in payload.scores.items()):
        raise DomainError('invalid_assessment_scores', 422)
    if not set(payload.item_sources).issubset(allowed) or not set(payload.direct_observations).issubset(allowed):
        raise DomainError('invalid_assessment_item', 422)
    evidence = []
    for key, citations in payload.item_sources.items():
        for row in _evidence(data, payload.elder_id, citations):
            evidence.append({**row, 'item_key': key})
    # Older clients supplied one or more general citations for the whole
    # assessment. Preserve their semantics while newer clients link evidence
    # to an individual item.
    for row in _evidence(data, payload.elder_id, payload.evidence):
        evidence.append({**row, 'item_key': None})
    for row in evidence:
        record = find(data, 'care_records', row['record_id'], 'record_not_found')
        if record.get('admission_id') != find(data, 'elders', payload.elder_id, 'elder_not_found').get('current_admission_id'):
            raise DomainError('assessment_evidence_admission_changed')
    stamp = now()
    for key, text in payload.direct_observations.items():
        evidence.append({'item_key': key, 'source_type': 'direct_observation', 'quote': text,
                         'snapshot_text': text, 'observed_by': user_id, 'observed_at': stamp})
    scores = {key: value for key, value in payload.scores.items() if value is not None}
    for key in scores:
        supported = any(row.get('item_key') in {None, key} for row in evidence)
        if not supported:
            raise DomainError('assessment_item_evidence_required', 422)
    complete = set(scores) == set(allowed)
    total = sum(scores.values()) if complete else None
    return scores, evidence, complete, total


def reasons(data, item, at=None):
    at = at or now()
    result = []
    elder = next((row for row in data['elders'] if row['id'] == item['elder_id']), None)
    if item['status'] != 'confirmed':
        result.append('assessment_not_confirmed')
    if not elder or elder.get('status', 'active') not in {'active', 'out'}:
        result.append('elder_not_in_care')
    if not elder or elder.get('current_admission_id') != item.get('admission_id'):
        result.append('assessment_admission_changed')
    if parse_time(item['review_due_at']) <= parse_time(at):
        result.append('assessment_review_due')
    if parse_time(item['assessed_at']) > parse_time(at):
        result.append('assessment_not_yet_observed')
    if not sources_current(data, item):
        result.append('assessment_evidence_changed')
    return result


def view(data, item):
    result = copy.deepcopy(item)
    blocked = reasons(data, item)
    result['current'] = {'effective': not blocked, 'blocked_reasons': blocked,
                         'review_due': 'assessment_review_due' in blocked, 'sources_current': sources_current(data, item)}
    return result


def access(item, user_id, role):
    if item['status'] in {'draft', 'pending_observation', 'rejected'} and role == 'caregiver' and item['created_by'] != user_id:
        raise DomainError('assessment_draft_not_yours', 403)


def get(store, assessment_id, user_id, role):
    data = store.read()
    item = find(data, 'assessments', assessment_id, 'assessment_not_found')
    access(item, user_id, role)
    return view(data, item)


def listing(store, user_id, role, elder_id=None, limit=100, offset=0):
    data = store.read()
    from app.services.care_scope_service import elder_ids
    scope = elder_ids(data, user_id, role) if role == 'caregiver' else None
    rows = []
    for item in reversed(data['assessments']):
        if scope is not None and item['elder_id'] not in scope:
            continue
        if elder_id and item['elder_id'] != elder_id:
            continue
        try:
            access(item, user_id, role)
        except DomainError:
            continue
        rows.append(view(data, item))
    return rows[offset:offset + limit]


def create(store, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role)
        from app.services.care_scope_service import require_elder_access
        require_elder_access(data, payload.elder_id, user_id, role)
        def operation():
            elder = care_eligible(data, payload.elder_id)
            at = now()
            if payload.assessed_at > parse_time(at) or payload.review_due_at <= parse_time(at) or payload.review_due_at <= payload.assessed_at:
                raise DomainError('invalid_assessment_times', 422)
            scores, evidence, complete, total_score = _normalized_answers(data, payload, user_id)
            if payload.supersedes_id:
                previous = find(data, 'assessments', payload.supersedes_id, 'assessment_not_found')
                if (previous['elder_id'] != elder['id'] or previous.get('admission_id') != elder.get('current_admission_id')
                        or previous['status'] not in {'confirmed', 'retired'}):
                    raise DomainError('invalid_assessment_predecessor')
            item = {'id': identifier('ASM'), **payload.model_dump(mode='json'), 'scores': scores,
                    'admission_id': elder.get('current_admission_id'), 'template_snapshot': templates()[0],
                    'total_score': total_score, 'evidence': evidence,
                    'status': 'draft' if complete else 'pending_observation', 'revision': 1,
                    'created_by': user_id, 'created_at': at,
                    'confirmed_by': None, 'confirmed_at': None, 'care_level_label': None, 'care_level_basis': None,
                    'events': []}
            data['assessments'].append(item)
            audit(data, 'create_assessment', item['id'], user_id, elder_id=elder['id'],
                  detail='保存评估' if complete else '保存待补充评估')
            return view(data, item)
        return replayable(data, user_id, 'create_assessment', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def update_answers(store, assessment_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role)
        item = find(data, 'assessments', assessment_id, 'assessment_not_found')
        access(item, user_id, role)
        from app.services.care_scope_service import require_elder_access
        require_elder_access(data, item['elder_id'], user_id, role)
        def operation():
            if item.get('admission_id') != care_eligible(data, item['elder_id']).get('current_admission_id'):
                raise DomainError('assessment_admission_changed')
            if item['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if item['status'] not in {'draft', 'pending_observation'}:
                raise DomainError('assessment_not_editable')
            body = {field: getattr(payload, field) for field in ('scores', 'item_sources', 'direct_observations')}
            from types import SimpleNamespace
            merged = SimpleNamespace(**body, elder_id=item['elder_id'], evidence=[])
            scores, evidence, complete, total_score = _normalized_answers(data, merged, user_id)
            before = {'scores': copy.deepcopy(item['scores']), 'evidence': copy.deepcopy(item['evidence']),
                      'status': item['status'], 'total_score': item['total_score']}
            item.update(scores=scores, evidence=evidence, total_score=total_score,
                        item_sources=payload.model_dump(mode='json')['item_sources'],
                        direct_observations=body['direct_observations'],
                        status='draft' if complete else 'pending_observation',
                        submitted_for_review=False,
                        revision=item['revision'] + 1, updated_at=now())
            audit(data, 'update_assessment', item['id'], user_id, elder_id=item['elder_id'],
                  detail='更新评估' if complete else '更新待补充评估', before=before,
                  after={'scores': scores, 'status': item['status'], 'total_score': total_score})
            return view(data, item)
        return replayable(data, user_id, 'update_assessment', key,
                          {'assessment_id': assessment_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def review(store, assessment_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'assessments', assessment_id, 'assessment_not_found')
            version(item, payload.expected_revision)
            at = now()
            if payload.action == 'confirm':
                if item['status'] == 'pending_observation':
                    raise DomainError('assessment_incomplete', 422)
                if item['status'] != 'draft':
                    raise DomainError('assessment_not_draft')
                blocked = [code for code in reasons(data, item, at) if code != 'assessment_not_confirmed']
                if blocked:
                    raise DomainError('assessment_basis_not_current')
                heads = [row for row in data['assessments'] if row['id'] != item['id'] and row['elder_id'] == item['elder_id']
                         and row.get('admission_id') == item.get('admission_id') and row['status'] in {'confirmed', 'retired'}]
                if heads and (len(heads) != 1 or heads[0]['id'] != item['supersedes_id']):
                    raise DomainError('assessment_supersession_required')
                if item['supersedes_id']:
                    old = find(data, 'assessments', item['supersedes_id'], 'assessment_not_found')
                    if old['status'] not in {'confirmed', 'retired'}:
                        raise DomainError('assessment_predecessor_changed')
                    old.update(status='superseded', revision=old['revision'] + 1)
                    old['events'].append({'action': 'superseded', 'at': at, 'by': user_id, 'successor_id': item['id']})
                    audit(data, 'supersede_assessment', old['id'], user_id, elder_id=old['elder_id'], detail=payload.reason)
                item.update(status='confirmed', confirmed_by=user_id, confirmed_at=at,
                            care_level_label=payload.care_level_label, care_level_basis=payload.care_level_basis)
            elif payload.action == 'reject':
                if item['status'] != 'draft':
                    raise DomainError('assessment_not_draft')
                item['status'] = 'rejected'
            else:
                if item['status'] != 'confirmed':
                    raise DomainError('assessment_not_confirmed')
                item['status'] = 'retired'
            item['revision'] += 1
            item['events'].append({'action': payload.action, 'at': at, 'by': user_id, 'reason': payload.reason})
            audit(data, 'review_assessment', item['id'], user_id, elder_id=item['elder_id'],
                  detail=payload.reason, decision=payload.action)
            return view(data, item)
        return replayable(data, user_id, 'review_assessment', key, {'assessment_id': assessment_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
