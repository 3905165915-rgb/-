"""Synthetic workflow tests: model capability never grants business permission."""
import copy
import json
from datetime import datetime, timedelta, timezone

import pytest
import httpx

from app.schemas.elder_workspace import AutomationRule, PlanAutomation
from app.services import ai_service, assessment_service, elder_workspace_service as service
from app.services.ai_service import MockAIProvider, AIProviderError
from app.storage.json_store import EMPTY_STORE, JsonStore
from test_facility import ROOT, post, legacy
from test_planning import assessment_body, source, plan_body, review_assessment, review_plan, shift
from test_impressions import records

BASE = '/elders/E1'


def get(api, path, actor='staff', status=200):
    client, _, headers = api
    response = client.get(ROOT + path, headers=headers(actor))
    assert response.status_code == status, response.text
    return response.json()


def workspace_assessment(api, **changes):
    record = source(api)
    body = assessment_body(record, evidence=[], item_sources={}, direct_observations={
        key: f'本次现场已观察{label}表现并核对选项' for key, label, _ in assessment_service.ITEMS})
    body.update(changes)
    return body


def test_partial_save_has_no_official_score_and_cannot_confirm_or_plan(api):
    body = workspace_assessment(api)
    del body['scores']['feeding']
    item = post(api, BASE + '/assessment/save', body, actor='staff', expected=200, key='partial')
    assert item['status'] == 'pending_observation' and item['total_score'] is None
    assert not item['current']['effective']
    assert post(api, BASE + '/assessment/save', body, actor='staff', expected=200, key='partial') == item
    _, store, _ = api
    before = store.path.read_bytes()
    review_assessment(api, item, expected=422)
    assert store.path.read_bytes() == before
    post(api, '/care-plans', plan_body(item), expected=409)
    assert not store.read()['care_plans']
    update = {**body, 'action': 'confirm', 'scores': {**body['scores'], 'feeding': 5},
              'note': '本次已补充进食现场观察', 'review_due_at': (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
              'assessment_id': item['id'], 'expected_revision': item['revision']}
    official = post(api, BASE + '/assessment/save', update, expected=200)
    assert official['status'] == 'confirmed' and official['total_score'] == 95
    assert official['current']['effective']
    assert official['note'] == update['note'] and datetime.fromisoformat(official['review_due_at']) == datetime.fromisoformat(update['review_due_at'])
    observation = next(e for e in official['evidence'] if e['item_key'] == 'feeding')
    assert observation['source_type'] == 'direct_observation' and observation['observed_by'] == 'manager'
    assert observation['observed_at'] and len(store.read()['assessments']) == 1


def test_atomic_save_rolls_back_failed_confirmation_and_checks_scope(api):
    body = workspace_assessment(api, action='confirm', scores={})
    _, store, _ = api
    before = store.path.read_bytes()
    post(api, BASE + '/assessment/save', body, expected=422)
    assert store.path.read_bytes() == before
    post(api, BASE + '/assessment/save', body, actor='staff', expected=403)
    post(api, BASE + '/assessment/save', body, actor='family', expected=403)
    store.mutate(lambda data: data.update(care_assignments=[]))
    post(api, BASE + '/assessment/save', {**body, 'action': 'save'}, actor='staff', expected=403)


def test_item_evidence_cannot_support_a_different_item(api):
    record = source(api)
    body = assessment_body(record, evidence=[], scores={'feeding': 5}, item_sources={
        'dressing': [{'record_id': record['id'], 'revision': 1, 'field': 'observations', 'quote': record['observations'][0]}]})
    post(api, BASE + '/assessment/save', body, actor='staff', expected=422)


def test_submitted_assessment_disappears_from_decisions_after_confirmation(api):
    body = workspace_assessment(api, action='submit')
    saved = post(api, BASE + '/assessment/save', body, actor='staff', expected=200)
    assert saved['submitted_for_review']
    assert any(d['object_id'] == saved['id'] for d in get(api, '/decisions/me', 'manager')['items'])
    post(api, BASE + '/assessment/save', {**body, 'action': 'confirm',
         'assessment_id': saved['id'], 'expected_revision': saved['revision']}, expected=200)
    assert not any(d['object_id'] == saved['id'] for d in get(api, '/decisions/me', 'manager')['items'])


def prefill_output(sources):
    items = MockAIProvider().assessment_prefill(sources, assessment_service.templates()[0]['items'], None)['items']
    if sources:
        record = sources[0]
        items[0].update(score=5, citations=[{'record_id': record['record_id'], 'revision': record['revision'],
                                           'field': 'observations', 'quote': record['text']}])
    return {'items': items}


def test_prefill_sources_previous_and_no_evidence_do_not_invent_ability(api, monkeypatch):
    record = source(api)
    confirmed = review_assessment(api, post(api, '/assessments', assessment_body(record), actor='staff'))
    provider = MockAIProvider()
    calls = []
    def prefill(sources, items, previous):
        calls.append((sources, previous))
        return prefill_output(sources)
    provider.assessment_prefill = prefill
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    result = post(api, '/assessments/prefill', {'elder_id': 'E1'}, actor='staff', expected=200)
    assert result['previous']['id'] == confirmed['id']
    assert result['items'][0]['score'] == 5
    assert all(i['score'] is None for i in result['items'][1:])
    assert len(calls) == 1
    _, store, _ = api
    store.mutate(lambda d: d['care_records'].clear())
    empty = post(api, '/assessments/prefill', {'elder_id': 'E1'}, actor='staff', expected=200)
    assert all(i['score'] is None and i['citations'] == [] for i in empty['items'])
    assert len(calls) == 1  # no model call just to reinterpret absent evidence


@pytest.mark.parametrize('change', ['quote', 'revision', 'permission', 'source'])
def test_prefill_rejects_fabrication_and_changes_during_model_call(api, monkeypatch, change):
    source(api)
    _, store, _ = api
    provider = MockAIProvider()
    def prefill(sources, items, previous):
        output = prefill_output(sources)
        if change == 'quote':
            output['items'][0]['citations'][0]['quote'] = '杜撰的原文'
        elif change == 'revision':
            output['items'][0]['citations'][0]['revision'] = 999
        elif change == 'permission':
            store.mutate(lambda d: d.update(care_assignments=[]))
        else:
            store.mutate(lambda d: d['care_records'][0].update(revision=2, observations=['修订观察']))
        return output
    provider.assessment_prefill = prefill
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    post(api, '/assessments/prefill', {'elder_id': 'E1'}, actor='staff', expected=503 if change in {'quote','revision'} else 403 if change == 'permission' else 409)


class Organiser(MockAIProvider):
    name = 'mock'
    calls = 0
    fail = False
    kind = 'trend'
    def impression(self, sources, candidates=None):
        self.calls += 1
        if self.fail:
            raise AIProviderError('synthetic unavailable')
        return {'points': [{'category': 'preference', 'kind': self.kind, 'expressor': 'elder',
            'text': '近期记录显示午后喜欢听戏，需尊重本人当次选择',
            'citations': [{'source_id': s['source_id'], 'quote': s['text']} for s in sources[:3]]}]}
    def ordinary_followups(self, sources):
        return {'items': [{'record_id': s['source_id'], 'action': 'activity_invitation', 'quote': s['text']}
                          for s in sources if '由' in s['text'] and '询问' in s['text']]}


def test_record_first_queue_failure_retry_and_one_step_memory(api, monkeypatch):
    client, store, headers = api
    provider = Organiser()
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    records(api, 3)
    assert provider.calls == 0 and len(store.read()['care_jobs']) == 3
    provider.fail = True
    assert service.process_next(store, force=True)
    assert len(store.read()['care_records']) == 3 and all(j['status'] == 'failed' for j in store.read()['care_jobs'])
    job = get(api, BASE + '/organising')['items'][0]
    post(api, BASE + f'/organising/{job["id"]}/retry', None, actor='staff', expected=200)
    provider.fail = False
    service.process_next(store, force=True)
    view = get(api, BASE + '/understanding')
    assert not view['confirmed'] and len(view['observations']) == 1
    point = view['observations'][0]
    assert point['can_adopt'] and point['supporting_days'] == 3
    decision = {'expected_revision': point['revision'], 'decision': 'adopt'}
    path = BASE + f'/understanding/{point["report_id"]}/{point["id"]}/decision'
    post(api, path, decision, actor='staff', expected=403)
    receipt = post(api, path, decision, expected=200, key='single-adopt')
    assert post(api, path, decision, expected=200, key='single-adopt') == receipt
    assert receipt['memory']['effective'] and 'activity' in receipt['memory']['scenes']
    assert len(store.read()['care_memories']) == 1
    assert get(api, BASE + '/understanding')['confirmed'][0]['id'] == receipt['memory']['id']
    get(api, BASE + '/understanding', 'family', status=403)


@pytest.mark.parametrize('kind', ['temporary', 'conflict', 'observation'])
def test_any_frequency_personal_impression_requires_human_adoption(api, monkeypatch, kind):
    provider = Organiser()
    provider.kind = kind
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    records(api, 3)
    service.process_next(api[1], force=True)
    point = get(api, BASE + '/understanding')['observations'][0]
    assert point['can_adopt']
    post(api, BASE + f'/understanding/{point["report_id"]}/{point["id"]}/decision',
         {'expected_revision': 1, 'decision': 'adopt'}, expected=200)
    assert len(api[1].read()['care_memories']) == 1


def test_inline_record_analysis_persists_once_and_retries_same_record(api, monkeypatch):
    provider = Organiser()
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    body = {'text': '今日完成床铺整理。'}
    first = post(api, BASE + '/record', body, actor='staff', key='record-once')
    assert first['analysis_status'] == 'ready'
    assert first['analysis']['record_id'] == first['record']['id']
    assert post(api, BASE + '/record', body, actor='staff', key='record-once') == first
    assert len(api[1].read()['care_records']) == 1
    assert api[1].read()['care_jobs'] == []
    assert len(api[1].read()['record_analyses']) == 1
    retried = post(api, BASE + f'/records/{first["record"]["id"]}/analyze', None, expected=200)
    assert retried['record']['id'] == first['record']['id']
    assert len(api[1].read()['care_records']) == 1
    assert len(api[1].read()['record_analyses']) == 1
    before = api[1].path.read_bytes()
    assert not service.process_next(api[1], force=True)
    assert before == api[1].path.read_bytes()  # no idle file rewrites


def test_inline_record_ai_failure_keeps_saved_record_and_retry_recovers(api, monkeypatch):
    _, store, _ = api
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: type('Failing', (), {
        'extract': lambda *args: (_ for _ in ()).throw(AIProviderError('unavailable'))})())
    result = post(api, BASE + '/record', {'text': '今天想休息'}, key='inline-failure')
    assert result['analysis_status'] == 'failed' and result['analysis'] is None
    record_id = result['record']['id']
    assert len(store.read()['care_records']) == 1 and store.read()['care_jobs'] == []
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: MockAIProvider())
    retried = post(api, BASE + f'/records/{record_id}/analyze', None, expected=200)
    assert retried['analysis_status'] == 'ready' and retried['record']['id'] == record_id
    assert len(store.read()['care_records']) == 1


@pytest.mark.parametrize('failure,code', [
    (httpx.ReadTimeout('private-provider-detail'), 'analysis_timeout'),
    (ValueError('private-output'), 'analysis_invalid_output'),
    (RuntimeError('private-error'), 'analysis_unavailable'),
])
def test_inline_failure_classification_preserves_record_and_safe_retry(api, monkeypatch, failure, code):
    def extract(*args):
        raise AIProviderError('private-provider-detail') from failure
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: type('Failing', (), {'extract': extract})())
    result = post(api, BASE + '/record', {'text': '今日完成床铺整理。'}, key='classified-failure')
    assert result['analysis_status'] == 'failed'
    assert result['analysis_error']['code'] == code
    assert '原记录已保存' in result['analysis_error']['message']
    assert 'private' not in json.dumps(result)
    assert api[1].read()['record_analyses'][0]['error_code'] == code
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: MockAIProvider())
    retried = post(api, BASE + f'/records/{result["record"]["id"]}/analyze', None, expected=200)
    assert retried['analysis_status'] == 'ready' and retried['record']['id'] == result['record']['id']
    assert len(api[1].read()['care_records']) == 1


@pytest.mark.parametrize('status,code', [(401, 'analysis_configuration'), (403, 'analysis_configuration'),
                                       (429, 'analysis_rate_limited'), (503, 'analysis_unavailable')])
def test_inline_http_failure_codes(status, code):
    response = httpx.Response(status, request=httpx.Request('POST', 'https://example.invalid'))
    cause = httpx.HTTPStatusError('private-response', request=response.request, response=response)
    error = AIProviderError('private-response')
    error.__cause__ = cause
    assert service.analysis_failure_code(error) == code


def test_inline_analysis_confirm_creates_only_reviewed_explicit_memory_once(api):
    result = post(api, BASE + '/record', {'text': '我每天午休后愿意听戏'}, key='daily-memory-record')
    suggestion = result['analysis']['preference_suggestions'][0]
    assert suggestion['frequency'] == 'explicit'
    body = {'expected_revision': result['record']['revision'],
            'preference_decisions': [{'suggestion_id': suggestion['id'], 'decision': 'adopt'}],
            'accepted_tasks': []}
    endpoint = BASE + f'/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm'
    confirmed = post(api, endpoint, body, expected=200, key='daily-memory-confirm')
    assert len(confirmed['memories']) == 1 and confirmed['memories'][0]['effective']
    assert post(api, endpoint, body, expected=200, key='daily-memory-confirm') == confirmed
    assert len(api[1].read()['care_memories']) == 1 and len(api[1].read()['care_tasks']) == 0


@pytest.mark.parametrize('text,frequency', [('愿意听戏', 'ambiguous'), ('今天喜欢听戏', 'one_time')])
def test_inline_confirmation_accepts_human_review_at_any_frequency(api, text, frequency):
    result = post(api, BASE + '/record', {'text': text}, key='ambiguous-record')
    suggestion = result['analysis']['preference_suggestions'][0]
    assert suggestion['frequency'] == frequency
    assert not api[1].read()['care_memories']
    receipt = post(api, BASE + f'/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm',
         {'expected_revision': 1, 'preference_decisions': [
             {'suggestion_id': suggestion['id'], 'decision': 'adopt'}]}, expected=200)
    assert receipt['memories'][0]['effective']
    assert receipt['memories'][0]['source']['quote'] in text


def test_model_splits_personal_traits_and_keeps_verbatim_sources(api, monkeypatch):
    from app.services.ai_outputs import validate_extraction
    text = '喜欢喝茶，喜欢打太极拳，喜欢和张阿姨散步。'
    provider = MockAIProvider()
    original = provider.extract
    def extract(*args):
        draft = original(*args)
        draft.preference_candidates = [
            {'content': content, 'evidence_text': content, 'group': 'preference', 'attributed_to': 'elder'}
            for content in ['喜欢喝茶', '喜欢打太极拳', '喜欢和张阿姨散步']]
        return draft
    provider.extract = extract
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    result = post(api, BASE+'/record', {'text':text})
    suggestions = result['analysis']['preference_suggestions']
    assert len(suggestions)==3
    receipt = post(api, BASE+f'/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm',
        {'expected_revision':1,'preference_decisions':[{'suggestion_id':s['id'],'decision':'adopt'} for s in suggestions]},expected=200)
    assert len(receipt['memories'])==3
    view=get(api, BASE+'/understanding')
    assert [row['display_summary'] for row in view['confirmed']]==[s['content'] for s in suggestions]
    assert view['profile_summary_needed'] is False
    with pytest.raises(ValueError):
        validate_extraction({'observations':[text], 'task_candidates':[], 'evidence':[{'text':text,'type':'observation'}],
            'warnings':[], 'preference_candidates':[{'content':'喜欢游泳','evidence_text':'从未出现的原文'}]}, text)


def legacy_profile(api):
    result=post(api, BASE+'/record', {'text':'王爷爷说：“我喜欢低音量京剧，活动前先问问我。”'})
    suggestion=result['analysis']['preference_suggestions'][0]
    post(api, BASE+f'/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm',
        {'expected_revision':1,'preference_decisions':[{'suggestion_id':suggestion['id'],'decision':'adopt',
            'content':result['record']['raw_text']}]},expected=200)
    api[1].mutate(lambda data: data['care_memories'][0].pop('presentation',None))
    return result


def test_profile_summary_preserves_sources_and_is_cached(api, monkeypatch):
    legacy_profile(api)
    provider=MockAIProvider()
    calls=[]
    def summary(sources):
        calls.append(sources)
        return {'points':[{'text':'喜欢低音量京剧；活动前先询问意愿',
            'citations':[{'source_id':row['source_id'],'quote':row['text']}]} for row in sources]}
    provider.personal_profile=summary
    monkeypatch.setattr(ai_service,'get_ai_provider',lambda:provider)
    before=copy.deepcopy(api[1].read()['care_memories'][0])
    first=post(api,BASE+'/understanding/summarize',None,actor='staff',expected=200)
    assert first['confirmed'][0]['display_summary']=='喜欢低音量京剧；活动前先询问意愿'
    assert not first['profile_summary_needed']
    post(api,BASE+'/understanding/summarize',None,actor='staff',expected=200)
    assert len(calls)==1
    after=api[1].read()['care_memories'][0]
    assert all(after[key]==value for key,value in before.items())
    assert before['source']['quote'] in first['confirmed'][0]['source']['snapshot_text']
    post(api,BASE+'/understanding/summarize',None,actor='family',expected=403)


@pytest.mark.parametrize('failure', ['fabricated_quote','source_changed','permission_revoked'])
def test_profile_summary_never_overwrites_changed_or_unauthorized_sources(api, monkeypatch, failure):
    legacy_profile(api)
    provider=MockAIProvider()
    def summary(sources):
        if failure=='source_changed':
            api[1].mutate(lambda data:data['care_records'][0].update(revision=2,observations=['本人已更正记录']))
        elif failure=='permission_revoked':
            api[1].mutate(lambda data:data.update(care_assignments=[]))
        return {'points':[{'text':'简短个人特性','citations':[{'source_id':row['source_id'],
            'quote':'不存在的内容' if failure=='fabricated_quote' else row['text']}]} for row in sources]}
    provider.personal_profile=summary
    monkeypatch.setattr(ai_service,'get_ai_provider',lambda:provider)
    post(api,BASE+'/understanding/summarize',None,actor='staff',
         expected={'fabricated_quote':503,'source_changed':409,'permission_revoked':403}[failure])
    assert not api[1].read()['care_memories'][0].get('presentation')


def test_inline_confirmation_uses_current_observations_not_original_narrative(api):
    record = post(api, '/records/manual', {
        'elder_id': 'E1', 'raw_text': '本人说每天午休后愿意听戏，今天也想试试。',
        'observations': ['本人说每天午休后愿意听戏']}, actor='staff')['record']
    result = post(api, BASE + f'/records/{record["id"]}/analyze', None,
                  actor='staff', expected=200)
    suggestion = result['analysis']['preference_suggestions'][0]
    confirmed = post(api, BASE + f'/records/{record["id"]}/analysis/{result["analysis"]["id"]}/confirm',
        {'expected_revision': record['revision'], 'preference_decisions': [
            {'suggestion_id': suggestion['id'], 'decision': 'adopt'}]}, actor='staff', expected=200)
    assert len(confirmed['memories']) == 1
    assert confirmed['record']['raw_text'] == record['raw_text']


def test_inline_followup_validates_incoming_assignee_against_selected_shift(api):
    tomorrow = (datetime.now(timezone(timedelta(hours=8))) + timedelta(days=1)).date()
    outgoing = shift(api, tomorrow, start='00:00', hours=8, member='staff')
    incoming = shift(api, tomorrow, start='08:00', hours=8, member='other')
    result = post(api, BASE + '/record', {'text': '请联系家属反馈情况', 'shift_id': outgoing['id']},
                  actor='staff', key='next-shift-record')
    suggestion = result['analysis']['task_suggestions'][0]
    confirmed = post(api, BASE + f'/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm',
        {'expected_revision': 1, 'accepted_tasks': [{
            'suggestion_id': suggestion['id'], 'title': '联系家属反馈情况',
            'shift_id': incoming['id'], 'assigned_to': 'other',
            'due_at': f'{tomorrow.isoformat()}T12:00:00+08:00',
            'completion_criteria': '联系后记录反馈结果'}]}, expected=200)
    assert confirmed['tasks'][0]['shift_id'] == incoming['id']
    assert confirmed['tasks'][0]['assigned_to'] == 'other'
    assert confirmed['record']['shift_id'] == outgoing['id']
    assert confirmed['tasks'][0]['source_record_id'] == confirmed['record']['id']


def test_inline_confirm_creates_only_complete_confirmed_task_once(api):
    tomorrow = (datetime.now(timezone(timedelta(hours=8))) + timedelta(days=1)).date()
    actual_shift = shift(api, tomorrow)
    result = post(api, BASE + '/record', {'text': '请联系家属反馈情况', 'shift_id': actual_shift['id']},
                  actor='staff', key='task-record')
    suggestion = result['analysis']['task_suggestions'][0]
    body = {'expected_revision': 1, 'preference_decisions': [], 'accepted_tasks': [{
        'suggestion_id': suggestion['id'], 'title': '联系家属反馈情况',
        'shift_id': actual_shift['id'], 'assigned_to': 'staff',
        'due_at': datetime.combine(tomorrow, datetime.min.time(), tzinfo=timezone(timedelta(hours=8))).replace(hour=12).isoformat(),
        'completion_criteria': '联系后记录反馈结果'}]}
    endpoint = BASE + f'/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm'
    confirmed = post(api, endpoint, body, actor='staff', expected=200, key='task-confirm')
    assert len(confirmed['tasks']) == 1
    assert confirmed['tasks'][0]['source_record_id'] == result['record']['id']
    assert confirmed['tasks'][0]['completion_criteria'] == '联系后记录反馈结果'
    assert post(api, endpoint, body, actor='staff', expected=200, key='task-confirm') == confirmed
    assert len(api[1].read()['care_tasks']) == 1


def test_inline_confirm_blocks_stale_revision_and_revoked_scope(api):
    result = post(api, BASE + '/record', {'text': '每天愿意听戏'}, key='stale-record')
    suggestion = result['analysis']['preference_suggestions'][0]
    body = {'expected_revision': 1, 'preference_decisions': [
        {'suggestion_id': suggestion['id'], 'decision': 'adopt'}]}
    endpoint = BASE + f'/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm'
    api[1].mutate(lambda data: next(row for row in data['care_records'] if row['id'] == result['record']['id'])
                  .update(revision=2, raw_text='来源已更正'))
    post(api, endpoint, body, expected=409)
    latest = post(api, BASE + '/record', {'text': '每天愿意听戏'}, key='scope-record')
    api[1].mutate(lambda data: data.update(care_assignments=[]))
    retry = post(api, BASE + f'/records/{latest["record"]["id"]}/analyze', None,
                 actor='staff', expected=403)
    assert retry['error_code'] == 'elder_not_in_current_work_scope'
    assert not api[1].read()['care_memories']


@pytest.mark.parametrize('quote,allowed,expected_tasks', [
    ('明天下午三点，由staff询问是否愿意参加活动。', True, 1),
    ('明天下午三点，由staff询问是否愿意参加活动。', False, 0),
    ('明天由staff询问是否愿意参加活动。', True, 0),
    ('如果天气好，明天下午三点，由staff询问是否愿意参加活动。', True, 0),
    ('明天下午三点，由staff询问是否愿意服药后参加活动。', True, 0),
])
def test_followups_require_authorization_complete_time_and_safe_purpose(api, monkeypatch, quote, allowed, expected_tasks):
    _, store, _ = api
    tomorrow = (datetime.now(timezone(timedelta(hours=8))) + timedelta(days=1)).date()
    shift(api, tomorrow)
    if allowed:
        service.set_rule(store, 'E1', AutomationRule(expected_revision=0, enabled=True,
            permitted_actions=['activity_invitation'], reason='主管授权仅询问活动意愿'), 'manager', 'supervisor')
    provider = Organiser()
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': quote}, actor='staff')
    service.process_next(store, force=True)
    assert len(store.read()['care_tasks']) == expected_tasks
    if expected_tasks:
        task = store.read()['care_tasks'][0]
        assert task['assigned_to'] == 'staff' and task['source_type'] == 'record'
        assert datetime.fromisoformat(task['due_at']).hour == 15
        post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': quote}, actor='staff')
        service.process_next(store, force=True)
        assert len(store.read()['care_tasks']) == 1
    else:
        decisions = get(api, '/decisions/me', 'manager')['items']
        assert any(d['kind'] == 'followup' for d in decisions)
        job = store.read()['care_jobs'][0]
        post(api, BASE + f'/organising/{job["id"]}/resolve-followups', {'reason': '已人工核对并安排接续'}, expected=200)
        assert not any(d['kind'] == 'followup' for d in get(api, '/decisions/me', 'manager')['items'])


def test_recovery_and_schema7_migration_never_resurrect_automation(api, tmp_path):
    data = copy.deepcopy(EMPTY_STORE)
    data['schema_version'] = 7
    data.pop('care_jobs')
    data.pop('automation_rules')
    store = JsonStore(tmp_path / 'migration')
    store.data_dir.mkdir()
    store.path.write_text(json.dumps(data), encoding='utf-8')
    backup = store.migrate()
    assert backup and json.loads(backup.read_text(encoding='utf-8'))['schema_version'] == 7
    from app.storage.json_store import CURRENT_SCHEMA_VERSION
    assert store.read()['schema_version'] == CURRENT_SCHEMA_VERSION and store.read()['care_jobs'] == []
    def seed(current):
        current['automation_rules'].append({'id': 'RULE', 'kind': 'followup', 'elder_id': 'E1', 'enabled': True, 'revision': 1})
        current['care_jobs'].append({'id': 'JOB', 'status': 'processing'})
    store.mutate(seed)
    snapshot = store.backup()
    store.restore(snapshot)
    assert not store.read()['automation_rules'][0]['enabled']
    assert store.read()['care_jobs'][0]['status'] == 'failed'


def test_schema_eight_migration_preserves_data_and_marks_old_record_jobs_for_inline_retry(tmp_path):
    data = copy.deepcopy(EMPTY_STORE)
    data['schema_version'] = 8
    data['care_records'] = [{'id': 'R1', 'elder_id': 'E1', 'revision': 1}]
    data['care_jobs'] = [
        {'id': 'J1', 'record_id': 'R1', 'status': 'queued'},
        {'id': 'J2', 'record_id': 'R1', 'status': 'processing'},
        {'id': 'J3', 'record_id': 'R1', 'status': 'completed'},
    ]
    store = JsonStore(tmp_path)
    store.path.write_text(json.dumps(data), encoding='utf-8')
    backup = store.migrate()
    migrated = store.read()
    assert backup and json.loads(backup.read_text(encoding='utf-8')) == data
    from app.storage.json_store import CURRENT_SCHEMA_VERSION
    assert migrated['schema_version'] == CURRENT_SCHEMA_VERSION
    assert migrated['care_records'] == data['care_records']
    assert migrated['care_jobs'][0]['status'] == 'failed'
    assert migrated['care_jobs'][0]['error_code'] == 'requires_inline_reanalysis'
    assert migrated['care_jobs'][1]['status'] == 'failed'
    assert migrated['care_jobs'][1]['error_code'] == 'requires_inline_reanalysis'
    assert migrated['care_jobs'][2]['status'] == 'completed'
    assert migrated['record_analyses'] == []


def test_conflicting_prefill_is_unscored_and_has_original_quotes(api, monkeypatch):
    source(api)
    source(api)
    provider = MockAIProvider()
    def prefill(sources, items, previous):
        output = prefill_output(sources)
        output['items'][0].update(score=None, conflict=True, question='两次观察需要帮助的程度不同，请本次核实',
            citations=[{'record_id': s['record_id'], 'revision': s['revision'], 'field': 'observations', 'quote': s['text']} for s in sources])
        return output
    provider.assessment_prefill = prefill
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    result = post(api, '/assessments/prefill', {'elder_id': 'E1'}, actor='staff', expected=200)
    assert result['items'][0]['conflict'] and result['items'][0]['score'] is None
    assert len(result['items'][0]['citations']) == 2


def test_recovered_worker_cannot_commit_its_old_claim(api, monkeypatch):
    provider = Organiser()
    original = provider.impression
    def interrupted(sources, candidates=None):
        service.recover_jobs(api[1])
        return original(sources)
    provider.impression = interrupted
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    records(api, 3)
    service.process_next(api[1], force=True)
    assert all(j['status'] == 'queued' and j['claim_token'] is None
               for j in api[1].read()['care_jobs'])
    assert not api[1].read()['elder_impressions']
    provider.impression = original
    service.process_next(api[1], force=True)
    assert api[1].read()['elder_impressions']


def test_authorization_revoked_during_model_work_creates_no_followup(api, monkeypatch):
    _, store, _ = api
    shift(api, (datetime.now(timezone(timedelta(hours=8))) + timedelta(days=1)).date())
    rule = service.set_rule(store, 'E1', AutomationRule(expected_revision=0, enabled=True,
        permitted_actions=['activity_invitation'], reason='允许普通询问'), 'manager', 'supervisor')
    provider = Organiser()
    original = provider.ordinary_followups
    def revoked(sources):
        service.set_rule(store, 'E1', AutomationRule(expected_revision=rule['revision'], enabled=False,
            permitted_actions=[], reason='撤回授权'), 'manager', 'supervisor')
        return original(sources)
    provider.ordinary_followups = revoked
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '明天下午三点，由staff询问是否愿意参加活动。'}, actor='staff')
    service.process_next(store, force=True)
    assert not store.read()['care_tasks']


def make_plan_rule(api):
    record = source(api)
    assessment = review_assessment(api, post(api, '/assessments', assessment_body(record), actor='staff'))
    plan = review_plan(api, post(api, '/care-plans', plan_body(assessment, items=[{
        'key': 'invitation', 'title': '询问活动意愿', 'scene': 'activity',
        'instruction': '询问本人并记录回应', 'times': ['15:00']}])) )
    tomorrow = (datetime.now(timezone(timedelta(hours=8))) + timedelta(days=1)).date()
    actual_shift = shift(api, tomorrow)
    payload = PlanAutomation(expected_revision=0, enabled=True, plan_id=plan['id'],
        shift_id=actual_shift['id'], assigned_to='staff', reason='批准在本次真实班次内按周期生成')
    rule = service.set_plan_rule(api[1], 'E1', payload, 'manager', 'supervisor')
    return rule, payload


def test_authorized_plan_generation_is_idempotent_and_changes_block(api):
    rule, payload = make_plan_rule(api)
    service.run_plan_rules(api[1])
    assert len(api[1].read()['care_tasks']) == 1
    api[1].mutate(lambda d: d['automation_rules'][0].update(last_run_at=None))
    service.run_plan_rules(api[1])
    assert len(api[1].read()['care_tasks']) == 1
    def change(data):
        data['care_plans'][0].update(revision=3, status='retired')
        data['automation_rules'][0].update(last_run_at=None)
    api[1].mutate(change)
    service.run_plan_rules(api[1])
    assert api[1].read()['automation_rules'][0]['error_code']
    disabled = service.set_plan_rule(api[1], 'E1', payload.model_copy(update={
        'expected_revision': rule['revision'], 'enabled': False}), 'manager', 'supervisor')
    assert not disabled['enabled']


def test_revoke_between_scheduler_snapshot_and_transaction_prevents_generation(api, monkeypatch):
    rule, payload = make_plan_rule(api)
    store = api[1]
    original = store.read
    def snapshot_then_revoke():
        snapshot = original()
        store.mutate(lambda d: d['automation_rules'][0].update(enabled=False, revision=rule['revision'] + 1))
        return snapshot
    monkeypatch.setattr(store, 'read', snapshot_then_revoke)
    service.run_plan_rules(store)
    assert not original()['care_tasks']
