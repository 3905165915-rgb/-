"""Incremental, durable organising jobs and one-decision elder workspace.

Only formal records are evidence. Model output never grants permission and never
modifies assessments, medicine, care plans or confirmed memories on its own.
"""
from __future__ import annotations

import copy
import re
from datetime import timedelta, timezone

from app.services.workflow import (DomainError, audit, current_staff, find,
                                   identifier, now, open_shift, parse_time, replayable)
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
    quote = re.sub(r'今晚|今早|明晚|明早', lambda m: {
        '今晚': '今天晚上', '今早': '今天上午', '明晚': '明天晚上', '明早': '明天上午'}[m.group()], quote)
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
    if (period == '上午' and hour > 12) or (period == '晚上' and hour == 12):
        raise ValueError('Clock conflicts with the stated period')
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


def time_proposal(quote, record):
    """Keep source, interpretation and unresolved fields distinct from assignment."""
    result = {'original_expression': quote, 'anchor_at': record.get('happened_at') or record['created_at'],
              'timezone': 'Asia/Shanghai', 'suggested_at': None, 'missing': [], 'conflicts': [],
              'semantics': 'deadline' if re.search(r'之前|前完成|截止', quote) else 'service_time'}
    try:
        result['suggested_at'] = _followup_due(quote, record).isoformat()
    except (ValueError, TypeError):
        if re.search(r'上午\s*(?:1[3-9]|2[0-3])(?:点|[:：])|晚上\s*(?:12|十二)点', quote):
            result['conflicts'].append('时段与钟点含义需重新核对')
        if len(re.findall(r'20\d{2}-\d{2}-\d{2}|今天|明天|后天|今晚|今早|明晚|明早', quote)) != 1:
            result['missing'].append('请确认具体日期')
        result['missing'].append('请确认明确时段及时间')
    return result


def preference_window(text, record):
    """Date-limited wishes retain their source date, independent of entry time.

    An unspecified temporary period is not silently promoted into a permanent
    characteristic. Clients can supply the expiry in the existing decision.
    """
    base = parse_time(record.get('happened_at') or record['created_at']).astimezone(timezone(timedelta(hours=8)))
    dates = re.findall(r'今天|今晚|明天|明晚|后天|20\d{2}-\d{2}-\d{2}', text)
    if len(set(dates)) == 1:
        token = dates[0]
        offset = {'今天': 0, '今晚': 0, '明天': 1, '明晚': 1, '后天': 2}.get(token)
        start = ((base + timedelta(days=offset)).replace(hour=0, minute=0, second=0, microsecond=0)
                 if offset is not None else parse_time(token).replace(tzinfo=base.tzinfo))
        return {'valid_from': start.isoformat(), 'expires_at': (start+timedelta(days=1)).isoformat(),
                'needs_time_confirmation': False, 'timezone': 'Asia/Shanghai'}
    temporary = bool(re.search(r'暂时|本次|这次|现在|本周|下周|本月', text)) or bool(dates)
    return {'valid_from': base.isoformat() if temporary else None, 'expires_at': None,
            'needs_time_confirmation': temporary, 'timezone': 'Asia/Shanghai'}


def _memory_window(text, record, expires_at=None):
    window = preference_window(text, record)
    if window['needs_time_confirmation'] and expires_at is None:
        raise DomainError('memory_applicability_time_required', 422)
    return {'valid_from': parse_time(window['valid_from']) if window['valid_from'] else None,
            'expires_at': expires_at or (parse_time(window['expires_at']) if window['expires_at'] else None)}


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
    if any(job.get('kind') != 'inline' and job['record_id'] == record_id and job['record_revision'] == version for job in data['care_jobs']):
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
    from app.services.ai_service import AIProviderError
    if payload.background:
        from app.services.record_job_service import save_background
        return save_background(store, elder_id, payload, user_id, role, key)
    result = record_service.manual(store, ManualRecordRequest(elder_id=elder_id,
        raw_text=payload.text, observations=[payload.text], shift_id=payload.shift_id,
        happened_at=payload.happened_at, attachment_ids=payload.attachment_ids,
        task_candidates=[]), user_id, role, key, queue_analysis=False)
    record = result['record']
    existing = next((row for row in store.read()['record_analyses'] if row['record_id'] == record['id']
                     and row['record_revision'] == record.get('revision', 1)), None)
    if existing:
        return inline_record_envelope(store, record['id'], existing)
    try:
        analysis = analyze_record(store, record['id'], user_id, role, scene=payload.scene)
    except (AIProviderError, ValueError, TypeError, KeyError) as exc:
        analysis = persist_analysis_failure(store, record['id'], user_id, role, analysis_failure_code(exc))
    return inline_record_envelope(store, record['id'], analysis)


def inline_record_envelope(store, record_id, analysis):
    record = next(row for row in store.read()['care_records'] if row['id'] == record_id)
    result = {'record': copy.deepcopy(record), 'analysis_status': analysis['status'],
              'analysis': analysis_view(analysis) if analysis['status'] in {'ready', 'confirmed'} else None}
    if analysis['status'] == 'failed':
        code = analysis.get('error_code', 'analysis_unavailable')
        messages = {
            'analysis_timeout': '分析等待超时，原记录已保存，可重试此记录。',
            'analysis_rate_limited': '分析服务暂时繁忙，原记录已保存，请稍后重试。',
            'analysis_configuration': '分析服务配置异常，原记录已保存，请联系管理员。',
            'analysis_invalid_output': '分析结果未通过原文核验，原记录已保存，可重试。',
            'analysis_unavailable': '分析暂不可用，原记录已保存，可重试此记录。',
        }
        result['analysis_error'] = {'code': code if code in messages else 'analysis_unavailable',
                                    'message': messages.get(code, messages['analysis_unavailable'])}
    return result


def analysis_failure_code(exc):
    import httpx
    code = 'analysis_unavailable'
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, httpx.TimeoutException):
            return 'analysis_timeout'
        if isinstance(exc, httpx.HTTPStatusError):
            if exc.response.status_code in {401, 403}:
                return 'analysis_configuration'
            if exc.response.status_code == 429:
                return 'analysis_rate_limited'
        if isinstance(exc, (ValueError, TypeError, KeyError)):
            code = 'analysis_invalid_output'
        exc = exc.__cause__
    return code


def analysis_view(analysis):
    from app.services.candidate_service import groups
    result = {key: copy.deepcopy(value) for key, value in analysis.items()
              if key not in {'source_text', 'source_fingerprint', 'created_by', 'error_code'}}
    result['preference_groups'] = groups(result.get('preference_suggestions', []))
    return result


def _record_analysis_data(data, record_id, user_id, role):
    current_staff(data, user_id, role)
    record = find(data, 'care_records', record_id, 'record_not_found')
    access(data, record['elder_id'], user_id, role)
    elder = care_eligible(data, record['elder_id'])
    if record.get('status') not in {'confirmed', 'corrected'}:
        raise DomainError('record_not_confirmed')
    if record.get('admission_id') != elder.get('current_admission_id'):
        raise DomainError('record_admission_changed')
    if record.get('shift_id'):
        shift = find(data, 'shifts', record['shift_id'], 'shift_not_found')
        if role in {'caregiver', 'nurse'} and user_id not in shift.get('caregiver_ids', []):
            raise DomainError('not_a_shift_member', 403)
    return record, elder


def _assert_inline_claim(data, claim):
    if claim is None:
        return
    live = next((j for j in data['care_jobs'] if j['id'] == claim['id']), None)
    if (data.get('demo_batch_id') != claim.get('batch_id') or not live
            or live['status'] != 'processing' or live.get('claim_token') != claim.get('claim_token')):
        raise DomainError('job_claim_changed', 409)


def persist_analysis_failure(store, record_id, user_id, role, error_code='analysis_unavailable', claim=None):
    def mutate(data):
        _assert_inline_claim(data, claim)
        record, _ = _record_analysis_data(data, record_id, user_id, role)
        revision = record.get('revision', 1)
        existing = next((row for row in data['record_analyses'] if row['record_id'] == record_id
                         and row['record_revision'] == revision and row['status'] != 'confirmed'), None)
        if existing:
            existing.update(status='failed', error_code=error_code, updated_at=now(),
                            source_text='\n'.join(record.get('observations') or [record['raw_text']]))
            return copy.deepcopy(existing)
        analysis = {'id': identifier('ANALYSIS'), 'record_id': record_id, 'record_revision': revision,
                    'source_text': '\n'.join(record.get('observations') or [record['raw_text']]),
                    'status': 'failed', 'provider': 'unavailable',
                    'error_code': error_code, 'created_by': user_id,
                    'created_at': now(), 'updated_at': now()}
        data['record_analyses'].append(analysis)
        audit(data, 'analyze_record_failed', record_id, user_id, elder_id=record['elder_id'],
              record_id=record_id, queue_record_job=False)
        return copy.deepcopy(analysis)
    return store.mutate(mutate)


def analyze_record(store, record_id, user_id, role, scene=None, claim=None):
    from app.services.ai_service import get_ai_provider
    snapshot = store.read()
    record, elder = _record_analysis_data(snapshot, record_id, user_id, role)
    revision = record.get('revision', 1)
    source_text = '\n'.join(record.get('observations') or [record['raw_text']])
    provider = get_ai_provider()
    draft = provider.extract(record['elder_id'], record.get('shift_id'), source_text)
    source_field = 'observations'
    quote = (draft.observations[0] if draft.observations else source_text)
    evidence = {'source_field': source_field, 'quote': quote}
    from app.services.personal_profile_service import presentation_text
    preference_suggestions = []
    candidates = draft.preference_candidates
    for candidate in candidates:
        evidence_text = candidate['evidence_text']
        if evidence_text not in source_text:
            raise ValueError('Preference quote is not in the current record')
        # Keep metadata for older clients; it is never an adoption threshold.
        explicit = bool(re.search(r'每天|每日|每周|每星期|每月|经常|总是|一直|长期', evidence_text))
        one_time = bool(re.search(r'今天|这次|本次|现在|暂时', evidence_text))
        preference_suggestions.append({'id': identifier('PREF'),
            'content': presentation_text(candidate['content'], elder.get('name')),
            'group': candidate.get('group', 'preference'),
            'frequency': 'explicit' if explicit else ('one_time' if one_time else 'ambiguous'),
            'attributed_to': candidate.get('attributed_to', 'unknown'), 'evidence_text': evidence_text,
            'applicability': preference_window(candidate['content']+' '+evidence_text, record)})
    observations = [{'id': identifier('OBS'), 'text': value,
                     'citation': {'source_field': source_field, 'quote': value}}
                    for value in draft.observations]
    suggestions = []
    for candidate in draft.task_candidates:
        suggestions.append({'id': identifier('SUG'), 'title': candidate.get('title', ''),
            'evidence_text': candidate.get('evidence_text') or source_text,
            'condition': candidate.get('condition'), 'due_text': candidate.get('due_text'),
            'time_proposal': time_proposal(candidate.get('evidence_text') or source_text, record)})
    analysis = {'id': identifier('ANALYSIS'), 'record_id': record_id, 'record_revision': revision,
        'status': 'ready', 'scene': {'value': scene, 'citation': evidence if scene else None},
        'observations': observations, 'task_suggestions': suggestions,
        'preference_suggestions': preference_suggestions, 'provider': draft.provider,
        'created_by': user_id, 'created_at': now(), 'source_text': source_text,
        'source_fingerprint': __import__('hashlib').sha256(source_text.encode()).hexdigest()}
    def commit(data):
        _assert_inline_claim(data, claim)
        if data.get('demo_batch_id') != snapshot.get('demo_batch_id'):
            raise DomainError('demo_batch_changed', 409)
        current_staff(data, user_id, role)
        live, live_elder = _record_analysis_data(data, record_id, user_id, role)
        if (live.get('revision', 1) != revision or
                '\n'.join(live.get('observations') or [live['raw_text']]) != source_text):
            raise DomainError('record_changed_during_ai_call')
        if live_elder.get('current_admission_id') != elder.get('current_admission_id'):
            raise DomainError('record_admission_changed')
        if any(c['quote'] not in (live.get(c['source_field']) if c['source_field'] == 'raw_text' else '\n'.join(live.get('observations', [])))
               for c in [e['citation'] for e in observations]):
            raise DomainError('analysis_source_changed')
        data['record_analyses'] = [row for row in data['record_analyses']
                                   if not (row['record_id'] == record_id and row['record_revision'] == revision
                                           and row['status'] != 'confirmed')]
        data['record_analyses'].append(copy.deepcopy(analysis))
        audit(data, 'analyze_record', record_id, user_id, elder_id=live['elder_id'], record_id=record_id,
              provider=draft.provider, queue_record_job=False)
        return copy.deepcopy(analysis)
    return store.mutate(commit)


def retry_record_analysis(store, elder_id, record_id, user_id, role):
    data = store.read()
    record, _ = _record_analysis_data(data, record_id, user_id, role)
    if record['elder_id'] != elder_id:
        raise DomainError('record_not_found', 404)
    latest = next((row for row in reversed(data['record_analyses']) if row['record_id'] == record_id
                   and row['record_revision'] == record.get('revision', 1) and row['status'] == 'ready'), None)
    if latest:
        return inline_record_envelope(store, record_id, latest)
    from app.services.ai_service import AIProviderError
    try:
        analysis = analyze_record(store, record_id, user_id, role)
    except (AIProviderError, ValueError, TypeError, KeyError) as exc:
        analysis = persist_analysis_failure(store, record_id, user_id, role, analysis_failure_code(exc))
    return inline_record_envelope(store, record_id, analysis)


def confirm_record_analysis(store, elder_id, record_id, analysis_id, payload, user_id, role, key=None):
    from app.models.entities import CareRecord
    from app.schemas.api import TaskCandidate
    from app.schemas.memory import MemoryCreateRequest
    from app.services import memory_service, record_service
    from app.services.workflow import active_staff
    def mutate(data):
        record, elder = _record_analysis_data(data, record_id, user_id, role)
        if record['elder_id'] != elder_id:
            raise DomainError('record_not_found', 404)
        analysis = find(data, 'record_analyses', analysis_id, 'record_analysis_not_found')
        if analysis['record_id'] != record_id:
            raise DomainError('record_analysis_not_found', 404)
        def operation():
            if record.get('revision', 1) != payload.expected_revision or analysis['record_revision'] != payload.expected_revision:
                raise DomainError('stale_record_analysis')
            if analysis.get('status') != 'ready':
                raise DomainError('record_analysis_not_ready')
            current_source = '\n'.join(record.get('observations') or [record['raw_text']])
            if analysis.get('source_text') != current_source:
                raise DomainError('analysis_source_changed')
            if analysis.get('source_fingerprint') != __import__('hashlib').sha256(current_source.encode()).hexdigest():
                raise DomainError('analysis_source_changed')
            tasks_by_id = {row['id']: row for row in analysis.get('task_suggestions', [])}
            preferences_by_id = {row['id']: row for row in analysis.get('preference_suggestions', [])}
            created_tasks, created_memories = [], []
            for accepted in payload.accepted_tasks:
                suggestion = tasks_by_id.get(accepted.suggestion_id)
                if not suggestion or suggestion['evidence_text'] not in current_source:
                    raise DomainError('analysis_suggestion_source_invalid', 422)
                due = accepted.due_at
                proposal = suggestion.get('time_proposal') or time_proposal(suggestion['evidence_text'], record)
                suggested = proposal.get('suggested_at')
                proposed_final = accepted.scheduled_at if proposal.get('semantics') == 'service_time' else due
                # Legacy clients may only provide a deadline; record this as an explicit adjustment.
                if suggested and proposed_final != parse_time(suggested) and not accepted.time_change_reason:
                    raise DomainError('task_time_change_reason_required', 422)
                if due <= parse_time(now()):
                    raise DomainError('task_due_must_be_future', 422)
                shift = find(data, 'shifts', accepted.shift_id, 'shift_not_found')
                open_shift(data, shift['id'], user_id, role)
                if shift['status'] != 'open' or accepted.assigned_to not in shift['caregiver_ids']:
                    raise DomainError('assignee_not_in_open_shift', 422)
                if not parse_time(shift['start_at']) <= due < parse_time(shift['end_at']):
                    raise DomainError('task_due_outside_shift', 422)
                if accepted.scheduled_at and (accepted.scheduled_at > due or not parse_time(shift['start_at']) <= accepted.scheduled_at < parse_time(shift['end_at'])):
                    raise DomainError('task_service_time_invalid', 422)
                active_staff(data, accepted.assigned_to)
                from app.services.care_scope_service import require_elder_access
                assigned = find(data, 'users', accepted.assigned_to, 'assignee_not_found')
                require_elder_access(data, elder_id, accepted.assigned_to, assigned['role'])
                duplicate = next((row for row in data['care_tasks'] if row['elder_id'] == elder_id
                    and row.get('assigned_to') == accepted.assigned_to and row.get('due_at')
                    and row.get('status') not in {'completed', 'cancelled'}
                    and row['title'] == accepted.title and parse_time(row['due_at']) == due), None)
                if duplicate:
                    created_tasks.append(copy.deepcopy(duplicate))
                    continue
                # Assignment belongs to the reviewed follow-up shift; the source
                # record keeps its original shift and is never rewritten.
                task_record = CareRecord.model_validate({**record, 'shift_id': accepted.shift_id})
                task = record_service.create_tasks(data, task_record, [TaskCandidate(
                    title=accepted.title, due_at=due, assigned_to=accepted.assigned_to,
                    condition=suggestion.get('condition'), due_text=suggestion.get('due_text')).model_dump(mode='json')],
                    user_id, role)[0]
                saved = next(row for row in data['care_tasks'] if row['id'] == task.id)
                saved['shift_id'] = accepted.shift_id
                saved['completion_criteria'] = accepted.completion_criteria
                saved['suggestion_id'] = accepted.suggestion_id
                saved['time_confirmation'] = {**proposal, 'final_due_at': due.isoformat(),
                    'final_scheduled_at': accepted.scheduled_at.isoformat() if accepted.scheduled_at else None,
                    'change_reason': accepted.time_change_reason, 'confirmed_by': user_id, 'confirmed_at': now()}
                if accepted.scheduled_at:
                    if accepted.scheduled_at > due or not parse_time(shift['start_at']) <= accepted.scheduled_at < parse_time(shift['end_at']):
                        raise DomainError('task_service_time_invalid', 422)
                    saved['scheduled_at'] = accepted.scheduled_at.isoformat()
                created_tasks.append(copy.deepcopy(saved))
            for decision in payload.preference_decisions:
                suggestion = preferences_by_id.get(decision.suggestion_id)
                if not suggestion or suggestion['evidence_text'] not in current_source:
                    raise DomainError('analysis_suggestion_source_invalid', 422)
                suggestion['human_decision'] = {'decision': decision.decision,
                    'original_content': suggestion['content'], 'final_content': decision.content or suggestion['content'],
                    'edited': bool(decision.content and decision.content != suggestion['content']),
                    'by': user_id, 'at': now(), 'source_revision': record.get('revision', 1)}
                if decision.decision != 'adopt':
                    continue
                request = MemoryCreateRequest(elder_id=elder_id,
                    content=decision.content or suggestion['content'],
                    category='communication' if suggestion.get('group') == 'communication' else 'stable_preference',
                    scenes=[analysis.get('scene', {}).get('value') or 'other'],
                    attributed_to=suggestion['attributed_to'], source_record_id=record_id,
                    source_revision=payload.expected_revision, source_field='observations',
                    source_quote=suggestion['evidence_text'],
                    **_memory_window(suggestion['content']+' '+suggestion['evidence_text'], record, decision.expires_at))
                memory = memory_service._create_candidate(data, request, user_id, candidate_source={
                    'inline_analysis_id': analysis_id, 'frequency': suggestion['frequency'],
                    'evidence_kind': 'single_person_self_report' if suggestion['attributed_to'] == 'elder' else 'single_record'})
                before = memory_service._snapshot(memory)
                memory.update(status='confirmed', confirmed_by=user_id, confirmed_at=now())
                memory_service._change(data, memory, before, 'memory_confirm', '提交人核对后加入个人印象', user_id)
                from app.services.personal_profile_service import set_presentation, presentation_text
                memory['understanding_group'] = suggestion.get('group', 'preference')
                set_presentation(memory, presentation_text(memory['content'], elder.get('name')), analysis['provider'], user_id)
                created_memories.append(memory_service._view(data, memory))
            analysis.update(status='confirmed', confirmed_by=user_id, confirmed_at=now(), updated_at=now())
            audit(data, 'confirm_record_analysis', analysis_id, user_id, elder_id=elder_id,
                  record_id=record_id, detail='提交人核对即时分析结果', queue_record_job=False)
            return {'record': copy.deepcopy(record), 'analysis': analysis_view(analysis),
                    'tasks': created_tasks, 'memories': created_memories}
        return replayable(data, user_id, 'confirm_record_analysis', key,
            {'elder_id': elder_id, 'record_id': record_id, 'analysis_id': analysis_id,
             **payload.model_dump(mode='json')}, operation)
    return store.mutate(mutate)


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
    from app.services.personal_profile_service import presentation, presentation_text
    data = store.read()
    access(data, elder_id, user_id, role)
    elder_name = find(data, 'elders', elder_id, 'elder_not_found').get('name')
    memories = [memory_service._view(data, row) for row in data['care_memories'] if row['elder_id'] == elder_id]
    reports = [r for r in data['elder_impressions'] if r['elder_id'] == elder_id
               and ('admission_id' not in r or r['admission_id'] == find(data, 'elders', elder_id, 'elder_not_found').get('current_admission_id'))]
    report = reports[-1] if reports else None
    observations = []
    unchanged = []
    if report:
        from app.services.candidate_service import previously_rejected, confirmed_match
        for point in report['points']:
            if point['status'] == 'rejected' or previously_rejected(reports, report, point):
                continue
            memory = next((m for m in memories if (m.get('impression_origin') or {}).get('impression_id') == report['id']
                           and (m.get('impression_origin') or {}).get('point_id') == point['id']), None)
            if memory and memory['effective']:
                continue
            match = confirmed_match(point, memories)
            if match:
                unchanged.append({**copy.deepcopy(point), 'report_id': report['id'], 'memory_id': match})
                continue
            current = _cited_sources_current(data, report, point)
            observations.append({**copy.deepcopy(point), 'report_id': report['id'],
                'display_summary': presentation_text(point['text'], elder_name),
                'applicability': preference_window(point['text']+' '+point['citations'][0]['quote'],
                    next(s for s in report['sources'] if s['source_id'] == point['citations'][0]['source_id'])),
                'source_current': current, 'can_adopt': current
                and point['category'] != 'attention' and not memory,
                'evidence': [{**c, 'happened_at': next(s['happened_at'] for s in report['sources']
                             if s['source_id'] == c['source_id'])} for c in point['citations']],
                'label': '近期观察，尚待核实' if current else '依据已变化，需要重新核实'})
    confirmed = [{**m, 'display_summary': presentation(m, elder_name)} for m in memories if m['effective']]
    from app.services.candidate_service import groups
    return {'elder_id': elder_id, 'confirmed': confirmed,
            'confirmed_groups': groups(confirmed), 'candidate_groups': groups(observations),
            'profile_summary_needed': any((m.get('presentation') or {}).get('memory_revision') != m['revision'] for m in confirmed),
            'needs_review': [m for m in memories if m['status'] not in {'retired', 'rejected'}
                             and (not m['source_current'] or m['review_state'] == 'pending')],
            'observations': observations, 'unchanged_observations': unchanged, 'as_of': now(),
            'notice': '个人特性由记录整理、经人工确认；原文可展开核实。'}


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
            if payload.decision == 'adopt' and point['category'] == 'attention':
                raise DomainError('impression_requires_care_review', 422)
            point['reviews'].append({'status': point['status'], 'revision': point['revision'],
                                      'note': point.get('review_note')})
            point.update(status='confirmed' if payload.decision == 'adopt' else 'rejected',
                         revision=point['revision'] + 1, reviewed_by=user_id, reviewed_at=now(), review_note=payload.note)
            point['human_decision'] = {'decision': payload.decision, 'original_content': point['text'],
                'final_content': payload.content or point['text'],
                'edited': bool(payload.content and payload.content != point['text']), 'by': user_id, 'at': now()}
            memory = None
            if payload.decision == 'adopt':
                citation = point['citations'][0]
                source = next(s for s in report['sources'] if s['source_id'] == citation['source_id'])
                scenes = _scenes(point)
                request = MemoryCreateRequest(elder_id=elder_id, content=payload.content or point['text'],
                    category='communication' if point['category'] == 'communication' else 'stable_preference',
                    scenes=scenes, attributed_to=point['expressor'] if point['expressor'] in {'elder','family','staff'} else 'unknown',
                    source_record_id=source['source_id'], source_revision=source['revision'],
                    source_field='observations', source_quote=citation['quote'],
                    **_memory_window(point['text']+' '+citation['quote'], source, payload.expires_at))
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
                from app.services.personal_profile_service import set_presentation, presentation_text
                set_presentation(memory, presentation_text(memory['content']), report['provider'], user_id)
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
        if item.get('kind') == 'inline' or item.get('error_code') == 'requires_inline_reanalysis':
            raise DomainError('inline_record_retry_required', 409)
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
        people = [p for p in data['users'] if p.get('active', True) and p['role'] in {'caregiver','supervisor','admin', 'nurse'}
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
            saved['time_confirmation'] = {**time_proposal(quote, record), 'final_due_at': due.isoformat(),
                'final_scheduled_at': due.isoformat(), 'confirmed_by': rule['approved_by'], 'rule_id': rule['id']}
            saved['scheduled_at'] = due.isoformat()
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
    if not any(j.get('kind') != 'inline' and j['status'] == 'queued' and (force or parse_time(j['not_before']) <= parse_time(instant)) for j in store.read()['care_jobs']):
        return False
    def claim(data):
        processing = {j['elder_id'] for j in data['care_jobs'] if j['status'] == 'processing'}
        eligible = [j for j in data['care_jobs'] if j.get('kind') != 'inline' and j['status'] == 'queued' and j['elder_id'] not in processing
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
            if current.get('demo_batch_id') != data.get('demo_batch_id'):
                raise DomainError('demo_batch_changed', 409)
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
                job.update(status='queued', claim_token=None, updated_at=now(),
                           not_before=now(), error_code=None)
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
        from app.services.candidate_service import previously_rejected, confirmed_match
        reports = [r for r in data['elder_impressions'] if r['elder_id'] == elder_id]
        memories = [memory_service._view(data, m) for m in data['care_memories'] if m['elder_id'] == elder_id]
        for point in report['points']:
            if point['status'] == 'candidate' and point['kind'] in {'trend','conflict'}:
                if previously_rejected(reports, report, point) or confirmed_match(point, memories):
                    continue
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
