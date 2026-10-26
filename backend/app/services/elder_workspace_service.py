"""Incremental, durable organising jobs and one-decision elder workspace.

Only formal records are evidence. Model output never grants permission and never
modifies assessments, medicine, care plans or confirmed memories on its own.
"""
from __future__ import annotations

import copy
import re
from datetime import timedelta, timezone

from app.services.workflow import (DomainError, audit, current_staff, find,
                                   identifier, now, parse_time, replayable)
from app.services.facility_service import care_eligible, care_state
from app.services.care_scope_service import require_elder_access

SIGNALS = re.compile(r'喜欢|不喜欢|习惯|愿意|不愿|拒绝|沟通|听戏|活动|午休|偏好|更容易|需要帮助|明天|后天|跟进|提醒|询问|复核|复查')
ACTION_WORDS = {'activity_invitation': ('询问', '参加', '活动'),
                'preference_check': ('询问', '是否', '愿意')}


class TransactionStore:
    """Reuse established services under the caller's single file transaction."""
    def __init__(self, data):
        self.data = data

    def read(self):
        return copy.deepcopy(self.data)

    def mutate(self, fn):
        return fn(self.data)


def _number(value):
    if value.isdecimal():
        return int(value)
    digits = {'零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
              '六': 6, '七': 7, '八': 8, '九': 9}
    if value in digits:
        return digits[value]
    if value.count('十') == 1:
        tens, units = value.split('十')
        return (digits.get(tens, 1) if tens else 1) * 10 + (digits[units] if units in digits else 0)
    raise ValueError('Ambiguous time')


def _followup_due(quote, record):
    """Explicit clock only; relative days are anchored to the record event date."""
    china = timezone(timedelta(hours=8))
    dates = re.findall(r'20\d{2}-\d{2}-\d{2}|今天|明天|后天', quote)
    clocks = re.findall(r'(?:(上午|下午|晚上|中午)\s*)?([0-9零一二两三四五六七八九十]{1,3})(?:[：:](\d{2})|点(?:(半|[0-9零一二两三四五六七八九十]{1,3}分))?)', quote)
    if len(dates) != 1 or len(clocks) != 1:
        raise ValueError('An explicit date and one clock are required')
    base = parse_time(record.get('happened_at') or record['created_at']).astimezone(china)
    day = (base + timedelta(days={'今天': 0, '明天': 1, '后天': 2}[dates[0]])).date() if dates[0] in {'今天','明天','后天'} else parse_time(dates[0]).date()
    period, hour, minute, chinese_minute = clocks[0]
    hour = _number(hour)
    minute = int(minute) if minute else (30 if chinese_minute == '半' else _number(chinese_minute[:-1]) if chinese_minute else 0)
    if period in {'下午','晚上'} and 1 <= hour < 12:
        hour += 12
    elif period == '上午' and hour == 12:
        hour = 0
    elif period == '中午' and hour not in {11, 12, 13}:
        raise ValueError('Ambiguous noon')
    if not period and '点' in quote and hour <= 12:
        raise ValueError('A Chinese clock needs an explicit period')
    if not 0 <= hour < 24 or not 0 <= minute < 60:
        raise ValueError('Invalid clock')
    return base.replace(year=day.year, month=day.month, day=day.day, hour=hour, minute=minute, second=0, microsecond=0)


def _scenes(point):
    text = point['text'] + ' '.join(c['quote'] for c in point['citations'])
    if point['category'] == 'communication':
        return ['communication']
    scenes = [scene for scene, words in [('activity', ('活动','听戏','阅读','听剧')),
              ('dining', ('进食','用餐','吃饭','口味')), ('bathing', ('洗澡','沐浴')),
              ('rest', ('午休','睡觉','休息'))] if any(word in text for word in words)]
    return scenes or ['other']


def access(data, elder_id, user_id, role, management=False):
    current_staff(data, user_id, role, management=management)
    require_elder_access(data, elder_id, user_id, role)
    return find(data, 'elders', elder_id, 'elder_not_found')


def enqueue_record(data, record_id, user_id):
    record = next((row for row in data['care_records'] if row['id'] == record_id), None)
    if not record or record.get('status') not in {'confirmed', 'corrected'}:
        return
    version = record.get('revision', 1)
    if any(job['record_id'] == record_id and job['record_revision'] == version for job in data['care_jobs']):
        return
    stamp = now()
    data['care_jobs'].append({'id': identifier('JOB'), 'elder_id': record['elder_id'],
        'record_id': record_id, 'record_revision': version, 'created_by': user_id,
        'status': 'queued', 'attempts': 0, 'created_at': stamp, 'updated_at': stamp,
        'not_before': (parse_time(stamp) + timedelta(seconds=3)).isoformat(),
        'result': None, 'error_code': None})


def save_record(store, elder_id, payload, user_id, role, key):
    from app.schemas.api import ManualRecordRequest
    from app.services import record_service
    result = record_service.manual(store, ManualRecordRequest(elder_id=elder_id,
        raw_text=payload.text, observations=[payload.text], task_candidates=[]), user_id, role, key)
    return {**result, 'organising': {'status': 'queued',
        'message': '记录已保存，系统正在后台整理；原始记录不会等待AI。'}}


def _cited_sources_current(data, report, point):
    elder = find(data, 'elders', report['elder_id'], 'elder_not_found')
    versions = {s['source_id']: s['revision'] for s in report['sources']}
    for citation in point['citations']:
        record = next((r for r in data['care_records'] if r['id'] == citation['source_id']), None)
        if not record or record['elder_id'] != report['elder_id'] or record.get('status') not in {'confirmed', 'corrected'}:
            return False
        if record.get('admission_id') != elder.get('current_admission_id'):
            return False
        if record.get('revision', 1) != versions.get(record['id']):
            return False
        if not any(citation['quote'] in text for text in record.get('observations', [])):
            return False
    return True


def understanding(store, elder_id, user_id, role):
    from app.services import memory_service
    data = store.read()
    access(data, elder_id, user_id, role)
    memories = [memory_service._view(data, row) for row in data['care_memories'] if row['elder_id'] == elder_id]
    reports = [r for r in data['elder_impressions'] if r['elder_id'] == elder_id
               and ('admission_id' not in r or r['admission_id'] == find(data, 'elders', elder_id, 'elder_not_found').get('current_admission_id'))]
    report = reports[-1] if reports else None
    observations = []
    if report:
        for point in report['points']:
            if point['status'] == 'rejected':
                continue
            memory = next((m for m in memories if (m.get('impression_origin') or {}).get('impression_id') == report['id']
                           and (m.get('impression_origin') or {}).get('point_id') == point['id']), None)
            if memory and memory['effective']:
                continue
            current = _cited_sources_current(data, report, point)
            observations.append({**copy.deepcopy(point), 'report_id': report['id'],
                'source_current': current, 'can_adopt': current and point['kind'] == 'trend'
                and point['category'] != 'attention' and not memory,
                'evidence': [{**c, 'happened_at': next(s['happened_at'] for s in report['sources']
                             if s['source_id'] == c['source_id'])} for c in point['citations']],
                'label': '近期观察，尚待核实' if current else '依据已变化，需要重新核实'})
    return {'elder_id': elder_id, 'confirmed': [m for m in memories if m['effective']],
            'needs_review': [m for m in memories if m['status'] not in {'retired', 'rejected'}
                             and (not m['source_current'] or m['review_state'] == 'pending')],
            'observations': observations, 'as_of': now(),
            'notice': '近期观察根据正式记录整理，不能替代已确认照护要求；本人当次意愿优先。'}


def decide(store, elder_id, report_id, point_id, payload, user_id, role, key=None):
    from app.schemas.memory import MemoryCreateRequest
    from app.services import impression_service, memory_service
    def mutate(data):
        access(data, elder_id, user_id, role, management=True)
        care_eligible(data, elder_id)
        report = find(data, 'elder_impressions', report_id, 'impression_not_found')
        if report['elder_id'] != elder_id:
            raise DomainError('impression_not_found', 404)
        point = next((p for p in report['points'] if p['id'] == point_id), None)
        if not point:
            raise DomainError('impression_point_not_found', 404)
        def operation():
            existing = impression_service._point_memory(data, report_id, point_id, elder_id)
            if existing:
                if payload.decision == 'adopt' and (payload.content is None or payload.content == existing['content']):
                    return {'memory': memory_service._view(data, existing), 'decision': 'adopt'}
                raise DomainError('impression_memory_already_created')
            if point['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            if payload.decision == 'adopt' and not _cited_sources_current(data, report, point):
                raise DomainError('impression_sources_changed')
            if payload.decision == 'adopt' and (point['kind'] != 'trend' or point['category'] == 'attention'):
                raise DomainError('impression_not_long_term_preference', 422)
            point['reviews'].append({'status': point['status'], 'revision': point['revision'],
                                      'note': point.get('review_note')})
            point.update(status='confirmed' if payload.decision == 'adopt' else 'rejected',
                         revision=point['revision'] + 1, reviewed_by=user_id, reviewed_at=now(), review_note=payload.note)
            memory = None
            if payload.decision == 'adopt':
                citation = point['citations'][0]
                source = next(s for s in report['sources'] if s['source_id'] == citation['source_id'])
                scenes = _scenes(point)
                request = MemoryCreateRequest(elder_id=elder_id, content=payload.content or point['text'],
                    category='communication' if point['category'] == 'communication' else 'stable_preference',
                    scenes=scenes, attributed_to=point['expressor'] if point['expressor'] in {'elder','family','staff'} else 'unknown',
                    source_record_id=source['source_id'], source_revision=source['revision'],
                    source_field='observations', source_quote=citation['quote'])
                memory = memory_service._create_candidate(data, request, user_id, candidate_source={
                    'impression_id': report_id, 'point_id': point_id, 'point_revision': point['revision'],
                    'citations': copy.deepcopy(point['citations']),
                    'source_versions': {s['source_id']: s['revision'] for s in report['sources']}})
                memory['impression_origin'] = {'impression_id': report_id, 'point_id': point_id}
                memory['understanding_group'] = 'communication' if point['category'] == 'communication' else (
                    'habit' if point['category'] in {'habit', 'routine'} else 'preference')
                before = memory_service._snapshot(memory)
                memory.update(status='confirmed', confirmed_by=user_id, confirmed_at=now())
                memory_service._change(data, memory, before, 'memory_confirm', payload.note, user_id)
            audit(data, 'understanding_decision', report_id, user_id, elder_id=elder_id,
                  point_id=point_id, decision=payload.decision, detail=payload.note)
            return {'memory': memory_service._view(data, memory) if memory else None, 'decision': payload.decision}
        return replayable(data, user_id, 'understanding_decision', key,
                          {'elder_id': elder_id, 'report_id': report_id, 'point_id': point_id,
                           **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def jobs(store, elder_id, user_id, role):
    data = store.read()
    access(data, elder_id, user_id, role)
    return {'elder_id': elder_id, 'items': [copy.deepcopy(j) for j in reversed(data['care_jobs'])
            if j['elder_id'] == elder_id][:20], 'as_of': now()}


def retry_job(store, elder_id, job_id, user_id, role):
    def mutate(data):
        access(data, elder_id, user_id, role)
        item = find(data, 'care_jobs', job_id, 'job_not_found')
        if item['elder_id'] != elder_id:
            raise DomainError('job_not_found', 404)
        if item['status'] != 'failed':
            raise DomainError('job_not_failed')
        item.update(status='queued', not_before=now(), updated_at=now(), error_code=None)
        audit(data, 'retry_care_job', item['id'], user_id, elder_id=elder_id)
        return copy.deepcopy(item)
    return store.mutate(mutate)


def get_rule(store, elder_id, user_id, role):
    data = store.read()
    access(data, elder_id, user_id, role, management=True)
    item = next((r for r in data['automation_rules'] if r['elder_id'] == elder_id and r['kind'] == 'followup'), None)
    return copy.deepcopy(item) if item else {'elder_id': elder_id, 'revision': 0, 'enabled': False, 'permitted_actions': []}


def resolve_followups(store, elder_id, job_id, payload, user_id, role):
    def mutate(data):
        access(data, elder_id, user_id, role, management=True)
        job = find(data, 'care_jobs', job_id, 'job_not_found')
        if job['elder_id'] != elder_id:
            raise DomainError('job_not_found', 404)
        if job['status'] != 'completed' or not (job.get('result') or {}).get('unresolved_followups'):
            raise DomainError('no_unresolved_followups')
        if not job.get('followup_reviewed_at'):
            job.update(followup_reviewed_at=now(), followup_reviewed_by=user_id, followup_review_note=payload.reason)
            audit(data, 'resolve_record_followups', job_id, user_id, elder_id=elder_id, detail=payload.reason)
        return copy.deepcopy(job)
    return store.mutate(mutate)


def set_rule(store, elder_id, payload, user_id, role):
    def mutate(data):
        access(data, elder_id, user_id, role, management=True)
        row = next((r for r in data['automation_rules'] if r['elder_id'] == elder_id and r['kind'] == 'followup'), None)
        revision = row['revision'] if row else 0
        if payload.expected_revision != revision:
            raise DomainError('stale_revision')
        if not row:
            row = {'id': identifier('RULE'), 'elder_id': elder_id, 'kind': 'followup'}
            data['automation_rules'].append(row)
        row.update(payload.model_dump(exclude={'expected_revision'}), revision=revision + 1,
                   approved_by=user_id, approved_at=now(),
                   admission_id=(care_eligible(data, elder_id) if payload.enabled else find(data, 'elders', elder_id, 'elder_not_found')).get('current_admission_id'))
        audit(data, 'authorize_ordinary_followups', row['id'], user_id, elder_id=elder_id,
              detail=payload.reason, enabled=payload.enabled, permitted_actions=payload.permitted_actions)
        return copy.deepcopy(row)
    return store.mutate(mutate)


def _automatic_followups(data, record, suggestions):
    """Model can locate an exact clause; rules verify time, person and purpose."""
    from app.schemas.api import TaskCreateRequest
    from app.services.task_service import create_from_data
    elder = care_eligible(data, record['elder_id'])
    rule = next((r for r in data['automation_rules'] if r['elder_id'] == record['elder_id']
                 and r['kind'] == 'followup' and r['enabled']), None)
    if not rule or rule.get('admission_id') != elder.get('current_admission_id'):
        return [], len(suggestions)
    approver = current_staff(data, rule['approved_by'], management=True)
    created, incomplete = [], 0
    for suggestion in suggestions:
        quote = suggestion.get('quote', '')
        action = suggestion.get('action')
        if (not quote or not any(quote in t for t in record.get('observations', []))
                or action not in rule['permitted_actions']
                or not all(word in quote for word in ACTION_WORDS.get(action, ()))):
            incomplete += 1
            continue
        # Model may only locate a complete sentence, never omit its condition or
        # negation. The source object, clock and staffing are checked by rules.
        sentences = [part.strip() for text in record.get('observations', []) for part in re.split(r'[。；;\n]', text) if part.strip()]
        complete = quote.strip().rstrip('。；;') in sentences
        people = [p for p in data['users'] if p.get('active', True) and p['role'] in {'caregiver','supervisor','admin'}
                  and p.get('display_name') and re.search(r'由\s*' + re.escape(p['display_name']) + r'(?=询问|负责|在|于|[，,、:：\s])', quote)]
        other_elder = any(e['id'] != record['elder_id'] and e.get('name') and e['name'] in quote for e in data['elders'])
        if not complete or other_elder or len(people) != 1 or re.search(r'取消|不再|无需|不要|用药|服药|治疗|复查|诊断|护理等级|风险|若|如果|必要时|可能|再看看|视情况|已完成|已经|已询问', quote):
            incomplete += 1
            continue
        try:
            due = _followup_due(quote, record)
            person = people[0]
            require_elder_access(data, record['elder_id'], person['id'], person['role'])
            shifts = [s for s in data['shifts'] if s.get('status') != 'closed' and person['id'] in s['caregiver_ids']
                      and parse_time(s['start_at']) <= due < parse_time(s['end_at'])]
            if len(shifts) != 1 or due <= parse_time(now()):
                incomplete += 1
                continue
            duplicates = [t for t in data['care_tasks'] if t['elder_id'] == record['elder_id']
                          and t.get('assigned_to') == person['id'] and t.get('due_at')
                          and parse_time(t['due_at']) == due and t['status'] != 'cancelled'
                          and (t.get('automatic_action') == action or t.get('title') == quote)]
            if duplicates:
                continue
            task = create_from_data(data, TaskCreateRequest(elder_id=record['elder_id'], title=quote,
                shift_id=shifts[0]['id'], assigned_to=person['id'], due_at=due,
                completion_criteria='询问并记录本人当次意愿及回应；尊重本人选择', source_type='record',
                source_id=record['id'], source_revision=record.get('revision', 1)), rule['approved_by'], approver['role'])
            saved = next(t for t in data['care_tasks'] if t['id'] == task['id'])
            saved.update(automatic_action=action, automation_rule_id=rule['id'], automation_rule_revision=rule['revision'])
            created.append(task['id'])
            audit(data, 'automatically_schedule_followup', task['id'], rule['approved_by'],
                  elder_id=record['elder_id'], record_id=record['id'], rule_id=rule['id'])
        except (ValueError, DomainError):
            incomplete += 1
    return created, incomplete


def process_next(store, force=False):
    """Claim once; model outside lock; recheck scope and source before committing."""
    from app.services.ai_service import get_ai_provider
    from app.services import impression_service
    instant = now()
    if not any(j['status'] == 'queued' and (force or parse_time(j['not_before']) <= parse_time(instant)) for j in store.read()['care_jobs']):
        return False
    def claim(data):
        processing = {j['elder_id'] for j in data['care_jobs'] if j['status'] == 'processing'}
        eligible = [j for j in data['care_jobs'] if j['status'] == 'queued' and j['elder_id'] not in processing
                    and (force or parse_time(j['not_before']) <= parse_time(instant))]
        if not eligible:
            return None
        elder_id = eligible[0]['elder_id']
        selected = [j for j in eligible if j['elder_id'] == elder_id][:30]
        token = identifier('CLAIM')
        for job in selected:
            job.update(status='processing', attempts=job['attempts'] + 1, updated_at=instant, claim_token=token)
        return copy.deepcopy(selected)
    selected = store.mutate(claim)
    if not selected:
        return False
    try:
        data = store.read()
        elder_id = selected[0]['elder_id']
        actor_id = selected[-1]['created_by']
        actor = current_staff(data, actor_id)
        access(data, elder_id, actor_id, actor['role'])
        elder = care_eligible(data, elder_id)
        state = care_state(elder)
        changed = [r for r in data['care_records'] if any(j['record_id'] == r['id'] and
                   j['record_revision'] == r.get('revision', 1) for j in selected)
                   and r.get('admission_id') == elder.get('current_admission_id')]
        relevant = any(SIGNALS.search('\n'.join(r.get('observations', []))) for r in changed)
        records = [r for r in data['care_records'] if r['elder_id'] == elder_id
                   and r.get('admission_id') == elder.get('current_admission_id')
                   and r.get('status') in {'confirmed','corrected'} and r.get('observations')
                   and parse_time(r.get('happened_at') or r['created_at']) <= parse_time(instant)]
        records.sort(key=lambda r: (parse_time(r.get('happened_at') or r['created_at']), r['id']))
        recent = records[-30:]
        sources = [{'source_id': r['id'], 'revision': r.get('revision', 1),
            'text': '\n'.join(r['observations']), 'happened_at': r.get('happened_at') or r['created_at'],
            'recorded_at': r['created_at'], 'simulated': '【模拟长期照护】' in r.get('raw_text','')}
            for r in recent]
        # Textual duplicates of the same event/date count once, never handovers
        # or summaries. Recurring events on distinct days remain distinct.
        unique = {}
        for source in sources:
            day = parse_time(source['happened_at']).astimezone(timezone(timedelta(hours=8))).date().isoformat()
            unique.setdefault((day, source['text']), source)
        sources = list(unique.values())
        if sum(len(s['text']) for s in sources) > 14000:
            raise DomainError('job_sources_too_large', 422)
        points, followups = [], []
        if relevant and sources:
            provider = get_ai_provider()
            points = impression_service._validate(provider.impression(copy.deepcopy(sources)), sources)
            changed_sources = [s for s in sources if any(r['id'] == s['source_id'] for r in changed)]
            followups = provider.ordinary_followups(copy.deepcopy(changed_sources)).get('items', [])
            if not isinstance(followups, list) or len(followups) > 10:
                raise ValueError('Invalid followups')
        def commit(current):
            for claimed in selected:
                live = find(current, 'care_jobs', claimed['id'], 'job_not_found')
                if live['status'] != 'processing' or live.get('claim_token') != claimed['claim_token']:
                    raise DomainError('job_claim_changed')
            access(current, elder_id, actor_id, actor['role'])
            if care_state(care_eligible(current, elder_id)) != state:
                raise DomainError('job_context_changed')
            for source in sources:
                row = find(current, 'care_records', source['source_id'], 'record_not_found')
                if row.get('revision', 1) != source['revision'] or '\n'.join(row['observations']) != source['text']:
                    raise DomainError('job_sources_changed')
            report_id = None
            if relevant and sources:
                stamp = now()
                for index, point in enumerate(points):
                    point.update(id=f'point-{index+1}', status='candidate', revision=1,
                                 reviewed_by=None, reviewed_at=None, review_note=None, reviews=[])
                _, _, fingerprint = impression_service._snapshot(current, elder_id, actor_id, actor['role'])
                report_id = identifier('IMP')
                current['elder_impressions'].append({'id': report_id, 'elder_id': elder_id,
                    'admission_id': elder.get('current_admission_id'),
                    'created_at': stamp, 'created_by': actor_id, 'provider': provider.name,
                    'model_status': 'demo' if provider.name == 'mock' else 'available',
                    'source_fingerprint': fingerprint, 'sources': sources, 'points': points,
                    'review_due_at': (parse_time(stamp) + timedelta(days=30)).isoformat(),
                    'coverage': {'record_count': len(sources), 'from': sources[0]['happened_at'],
                    'to': sources[-1]['happened_at'], 'batch_count': 1,
                    'simulated_count': sum(s['simulated'] for s in sources),
                    'available_records': len(records), 'excluded_records': len(records)-len(sources),
                    'notice': '自动整理仅阅读当前入住最近30条正式观察；同日同文事件去重，不复读全部历史。'},
                    'automatic': True})
            created, incomplete = [], 0
            for record in changed:
                relevant_followups = [f for f in followups if isinstance(f, dict) and f.get('record_id') == record['id']]
                ids, missing = _automatic_followups(current, record, relevant_followups)
                created.extend(ids)
                incomplete += missing
            for job in current['care_jobs']:
                if any(j['id'] == job['id'] for j in selected):
                    job.update(status='completed', updated_at=now(), result={'report_id': report_id,
                        'created_task_ids': created, 'unresolved_followups': incomplete,
                        'message': ('已整理近期观察' if report_id else '记录已保存，无需模型重新整理')
                        + (f'，已安排{len(created)}项跟进' if created else '')
                        + (f'，{incomplete}项跟进待明确或授权' if incomplete else '')})
        store.mutate(commit)
    except Exception as exc:
        def fail(data):
            for job in data['care_jobs']:
                if any(j['id'] == job['id'] and j.get('claim_token') == job.get('claim_token') for j in selected) and job['status'] == 'processing':
                    job.update(status='failed', updated_at=now(), error_code=getattr(exc, 'code', 'organising_unavailable'))
        store.mutate(fail)
    return True


def recover_jobs(store):
    if not any(job['status'] == 'processing' for job in store.read()['care_jobs']):
        return
    def recover(data):
        for job in data['care_jobs']:
            if job['status'] == 'processing':
                job.update(status='queued', claim_token=None, not_before=now(), updated_at=now(), error_code='interrupted_requeued')
    store.mutate(recover)


def save_assessment(store, elder_id, payload, user_id, role, key=None):
    from app.schemas.planning import AssessmentCreate, AssessmentAnswers, AssessmentReview
    from app.services import assessment_service
    def mutate(data):
        access(data, elder_id, user_id, role, management=payload.action == 'confirm')
        if payload.elder_id != elder_id:
            raise DomainError('assessment_elder_mismatch', 422)
        # Existing service rules execute on this transaction, so a failed
        # confirmation cannot leave half of a compound save behind.
        nested = TransactionStore(data)
        def operation():
            raw = payload.model_dump(mode='json', exclude={'action','assessment_id','expected_revision'})
            if payload.assessment_id:
                previous = find(data, 'assessments', payload.assessment_id, 'assessment_not_found')
                if previous['elder_id'] != elder_id:
                    raise DomainError('assessment_elder_mismatch', 422)
                if payload.expected_revision is None:
                    raise DomainError('stale_revision')
                item = assessment_service.update_answers(nested, previous['id'], AssessmentAnswers(
                    expected_revision=payload.expected_revision, scores=payload.scores,
                    item_sources=payload.item_sources, direct_observations=payload.direct_observations), user_id, role)
                if (payload.assessed_at > parse_time(now()) or payload.review_due_at <= parse_time(now())
                        or payload.review_due_at <= payload.assessed_at):
                    raise DomainError('invalid_assessment_times', 422)
                row = find(data, 'assessments', item['id'], 'assessment_not_found')
                before = {field: row[field] for field in ('note', 'assessed_at', 'review_due_at')}
                row.update(note=payload.note, assessed_at=payload.assessed_at.isoformat(),
                           review_due_at=payload.review_due_at.isoformat())
                audit(data, 'update_assessment_details', row['id'], user_id, elder_id=elder_id,
                      before=before, after={field: row[field] for field in before})
                item = assessment_service.view(data, row)
            else:
                elder = care_eligible(data, elder_id)
                predecessor = next((r for r in reversed(data['assessments']) if r['elder_id'] == elder_id
                    and r.get('admission_id') == elder.get('current_admission_id')
                    and r['status'] in {'confirmed','retired'}), None)
                raw['supersedes_id'] = predecessor['id'] if predecessor else None
                item = assessment_service.create(nested, AssessmentCreate.model_validate(raw), user_id, role)
            if payload.action == 'confirm':
                item = assessment_service.review(nested, item['id'], AssessmentReview(
                    expected_revision=item['revision'], action='confirm', reason=payload.note,
                    care_level_label='ADL计分已人工核对，未认定护理等级',
                    care_level_basis='本次仅确认逐项观察与量表计分，不作为收费、补贴或护理等级认定'), user_id, role)
            elif payload.action == 'submit':
                if item['status'] == 'pending_observation':
                    raise DomainError('assessment_incomplete', 422)
                row = find(data, 'assessments', item['id'], 'assessment_not_found')
                row.update(submitted_for_review=True, submitted_at=now(), submitted_by=user_id)
                audit(data, 'submit_assessment', row['id'], user_id, elder_id=elder_id,
                      detail='评估已提交主管在老人档案内确认')
                item = assessment_service.view(data, row)
            return item
        return replayable(data, user_id, 'save_elder_assessment', key,
            {'elder_id': elder_id, **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


def plan_rules(store, elder_id, user_id, role):
    data = store.read()
    access(data, elder_id, user_id, role, management=True)
    return {'items': [copy.deepcopy(r) for r in data['automation_rules']
                      if r['elder_id'] == elder_id and r['kind'] == 'plan']}


def set_plan_rule(store, elder_id, payload, user_id, role):
    from app.services import plan_service
    def mutate(data):
        access(data, elder_id, user_id, role, management=True)
        row = next((r for r in data['automation_rules'] if r['kind'] == 'plan'
                    and r['elder_id'] == elder_id and r['plan_id'] == payload.plan_id
                    and r['shift_id'] == payload.shift_id), None)
        if not payload.enabled and row:
            if row['revision'] != payload.expected_revision:
                raise DomainError('stale_revision')
            row.update(enabled=False, revision=row['revision'] + 1, approved_by=user_id,
                       approved_at=now(), reason=payload.reason, error_code=None)
            audit(data, 'revoke_plan_schedule', row['id'], user_id, elder_id=elder_id, detail=payload.reason)
            return copy.deepcopy(row)
        plan = find(data, 'care_plans', payload.plan_id, 'plan_not_found')
        if plan['elder_id'] != elder_id or plan['status'] != 'active':
            raise DomainError('plan_not_effective_for_generation')
        from app.services.workflow import active_staff, open_shift
        open_shift(data, payload.shift_id, user_id, role)
        shift = find(data, 'shifts', payload.shift_id, 'shift_not_found')
        active_staff(data, payload.assigned_to)
        if payload.assigned_to not in shift['caregiver_ids']:
            raise DomainError('assignee_not_in_shift', 422)
        row = next((r for r in data['automation_rules'] if r['kind'] == 'plan'
                    and r['elder_id'] == elder_id and r['plan_id'] == plan['id']
                    and r['shift_id'] == shift['id']), None)
        revision = row['revision'] if row else 0
        if payload.expected_revision != revision:
            raise DomainError('stale_revision')
        if not row:
            row = {'id': identifier('RULE'), 'kind': 'plan', 'elder_id': elder_id}
            data['automation_rules'].append(row)
        row.update(payload.model_dump(exclude={'expected_revision'}), revision=revision + 1,
                   plan_revision=plan['revision'], approved_by=user_id, approved_at=now(),
                   last_run_at=None, error_code=None)
        audit(data, 'authorize_plan_schedule', row['id'], user_id, elder_id=elder_id,
              detail=payload.reason, plan_id=plan['id'], shift_id=shift['id'])
        return copy.deepcopy(row)
    return store.mutate(mutate)


def run_plan_rules(store):
    from app.schemas.planning import PlanGenerate
    from app.services import plan_service
    data = store.read()
    stamp = now()
    for rule in data['automation_rules']:
        if rule['kind'] != 'plan' or not rule['enabled']:
            continue
        if rule.get('last_run_at') and parse_time(stamp) - parse_time(rule['last_run_at']) < timedelta(minutes=1):
            continue
        def schedule(current):
            authorized = find(current, 'automation_rules', rule['id'], 'automation_rule_not_found')
            if not authorized['enabled'] or authorized['revision'] != rule['revision']:
                return
            actor = current_staff(current, rule['approved_by'], management=True)
            access(current, rule['elder_id'], actor['id'], actor['role'], management=True)
            plan = find(current, 'care_plans', rule['plan_id'], 'plan_not_found')
            if plan['revision'] != rule['plan_revision'] or plan['status'] != 'active':
                raise DomainError('authorized_plan_changed')
            shift = find(current, 'shifts', rule['shift_id'], 'shift_not_found')
            if parse_time(shift['end_at']) <= parse_time(stamp):
                raise DomainError('authorized_shift_ended')
            # Only the specifically authorised real shift is eligible. Never
            # invent staffing or silently reauthorise a new plan version.
            start = max(plan_service.local_date(shift['start_at']), plan_service.local_date(stamp))
            end = plan_service.local_date(shift['end_at'])
            for offset in range(min((end-start).days + 1, 3)):
                day = start + timedelta(days=offset)
                if plan_service.reasons(current, plan, stamp, day):
                    raise DomainError('plan_not_effective_for_generation')
                plan_service.generate(TransactionStore(current), rule['plan_id'], PlanGenerate(expected_revision=rule['plan_revision'],
                    service_date=day, shift_id=rule['shift_id'], assigned_to=rule['assigned_to']),
                    actor['id'], actor['role'], key=f'auto-plan:{rule["id"]}:{rule["revision"]}:{day}')
            authorized.update(last_run_at=stamp, error_code=None)
        try:
            store.mutate(schedule)
            continue
        except DomainError as exc:
            error = exc.code
        def update(current):
            row = next((r for r in current['automation_rules'] if r['id'] == rule['id']), None)
            if row and row['revision'] == rule['revision']:
                row.update(last_run_at=stamp, error_code=error)
        store.mutate(update)


def decisions(store, user_id, role):
    from app.services import assessment_service, memory_service
    data = store.read()
    current_staff(data, user_id, role, management=True)
    names = {e['id']: e.get('name', e['id']) for e in data['elders']}
    items = []
    def append(elder_id, reason, kind, object_id, evidence=None):
        items.append({'elder_id': elder_id, 'elder_name': names.get(elder_id, elder_id),
                      'reason': reason, 'kind': kind, 'object_id': object_id,
                      'evidence': copy.deepcopy(evidence or []), 'path': '/elders/' + elder_id})
    for item in data['assessments']:
        if item['status'] == 'draft' and item.get('submitted_for_review'):
            append(item['elder_id'], '评估已补齐，等待主管确认', 'assessment', item['id'])
        elif item['status'] == 'confirmed' and assessment_service.view(data, item)['current']['review_due']:
            append(item['elder_id'], '评估已到复评时间', 'assessment', item['id'])
    for item in data['care_memories']:
        view = memory_service._view(data, item)
        if item['status'] not in {'rejected','retired','suspended'} and view['review_state'] == 'pending':
            append(item['elder_id'], '已确认信息的依据或近期情况需要重新核实', 'memory', item['id'])
    latest = {}
    for report in data['elder_impressions']:
        latest[report['elder_id']] = report
    for elder_id, report in latest.items():
        for point in report['points']:
            if point['status'] == 'candidate' and point['kind'] in {'trend','conflict'}:
                if _cited_sources_current(data, report, point):
                    append(elder_id, point['text'], 'understanding', report['id'] + ':' + point['id'], point['citations'])
    for item in data['care_advice']:
        if item['status'] == 'adopted' and item['feedback'] and (not item['reviews'] or item['reviews'][-1].get('feedback_id') != item['feedback'][-1]['id']):
            append(item['elder_id'], '个性化安排已有执行反馈，可以复核是否继续或调整', 'care_advice', item['id'])
    for job in data['care_jobs']:
        if job['status'] == 'failed':
            append(job['elder_id'], '记录已保存，后台整理失败，可重试或人工办理', 'organising', job['id'])
        elif job.get('result') and job['result'].get('unresolved_followups') and not job.get('followup_reviewed_at'):
            append(job['elder_id'], '记录中的跟进事项缺少明确安排或授权，请核对原文', 'followup', job['record_id'])
    for rule in data['automation_rules']:
        if rule.get('enabled') and rule.get('error_code'):
            append(rule['elder_id'], '授权排期暂未执行，请核对计划版本、评估和班次', 'plan', rule['id'])
    groups = {}
    for task in data['care_tasks']:
        group = task.get('source_advice_id') or (str(task.get('source_plan_id')) + ':' + str(task.get('plan_item_key')) if task.get('source_plan_id') else None)
        if group:
            groups.setdefault((task['elder_id'], group), []).append(task)
        if task['status'] not in {'completed','cancelled','not_done'} and not task.get('assigned_to'):
            append(task['elder_id'], '待执行事项尚无明确接续人员：' + task['title'], 'task', task['id'])
    for (elder_id, _), tasks in groups.items():
        recent = sorted(tasks, key=lambda t: t['created_at'])[-2:]
        if len(recent) == 2 and all(t['status'] == 'not_done' for t in recent):
            append(elder_id, '同一安排连续未执行，请核对本人意愿并决定调整：' + recent[-1]['title'], 'task', recent[-1]['id'])
    items = list({(item['kind'], item['object_id']): item for item in items}.values())
    return {'items': items, 'total': len(items), 'as_of': now()}
