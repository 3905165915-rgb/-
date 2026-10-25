"""Versioned human ADL assessments, not automated clinical or subsidy decisions."""
import copy

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
    return bool(item['evidence'])


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
    if item['status'] in {'draft', 'rejected'} and role == 'caregiver' and item['created_by'] != user_id:
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
            allowed = {name: {score for score, _ in choices} for name, _, choices in ITEMS}
            if set(payload.scores) != set(allowed) or any(score not in allowed[name] for name, score in payload.scores.items()):
                raise DomainError('invalid_assessment_scores', 422)
            if payload.supersedes_id:
                previous = find(data, 'assessments', payload.supersedes_id, 'assessment_not_found')
                if (previous['elder_id'] != elder['id'] or previous.get('admission_id') != elder.get('current_admission_id')
                        or previous['status'] not in {'confirmed', 'retired'}):
                    raise DomainError('invalid_assessment_predecessor')
            item = {'id': identifier('ASM'), **payload.model_dump(mode='json'),
                    'admission_id': elder.get('current_admission_id'), 'template_snapshot': templates()[0],
                    'total_score': sum(payload.scores.values()), 'evidence': _evidence(data, elder['id'], payload.evidence),
                    'status': 'draft', 'revision': 1, 'created_by': user_id, 'created_at': at,
                    'confirmed_by': None, 'confirmed_at': None, 'care_level_label': None, 'care_level_basis': None,
                    'events': []}
            data['assessments'].append(item)
            audit(data, 'create_assessment', item['id'], user_id, elder_id=elder['id'], detail='人工提交ADL评估草稿')
            return view(data, item)
        return replayable(data, user_id, 'create_assessment', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def review(store, assessment_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        def operation():
            item = find(data, 'assessments', assessment_id, 'assessment_not_found')
            version(item, payload.expected_revision)
            at = now()
            if payload.action == 'confirm':
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
