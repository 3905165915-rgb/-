import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from app.schemas.planning import PlanGenerate, AssessmentReview
from app.services import assessment_service as assessments, assistant_service, plan_service as plans, ai_service, quality_service
from app.services.ai_service import MockAIProvider
from app.services.workflow import DomainError, now
from test_facility import ROOT, legacy, post, action as admission_action
from test_assistant import fake_ai

QUOTE = '人工观察：老人进食时需要帮助，活动安排应先核实本人意愿。'


def source(api):
    return post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': QUOTE}, actor='staff')['record']


def assessment_body(record, **changes):
    instant = datetime.now(timezone.utc)
    body = {'elder_id': 'E1', 'scores': {key: choices[-1][0] for key, _, choices in assessments.ITEMS},
            'assessed_at': (instant - timedelta(minutes=1)).isoformat(),
            'review_due_at': (instant + timedelta(days=4)).isoformat(), 'note': '人工逐项观察并核对，不由模型填写。',
            'evidence': [{'record_id': record['id'], 'revision': record['revision'], 'field': 'observations', 'quote': QUOTE}]}
    body['scores']['feeding'] = 5
    body.update(changes)
    return body


def review_assessment(api, item, verb='confirm', expected=200, **changes):
    body = {'expected_revision': item['revision'], 'action': verb, 'reason': '主管人工核对当前观察及机构规则'}
    if verb == 'confirm':
        body.update(care_level_label='机构演示照护档A', care_level_basis='人工结合机构演示规则判断，不用于收费或补贴认定')
    body.update(changes)
    return post(api, f'/assessments/{item["id"]}/review', body, expected=expected)


def plan_body(assessment, **changes):
    day = plans.local_date(now())
    body = {'elder_id': 'E1', 'assessment_id': assessment['id'], 'expected_assessment_revision': assessment['revision'],
            'title': '个性化活动照护计划', 'goal': '尊重本人意愿，按本次评估安排帮助',
            'starts_on': day.isoformat(), 'ends_on': (day + timedelta(days=3)).isoformat(),
            'items': [{'key': 'activity', 'title': '确认并协助本人参加活动', 'scene': 'activity',
                       'instruction': '先询问本人本次意愿，再按当前安排提供帮助。', 'times': ['09:00', '18:00']}]}
    body.update(changes)
    return body


def review_plan(api, item, verb='approve', expected=200, key=None):
    return post(api, f'/care-plans/{item["id"]}/review', {'expected_revision': item['revision'],
        'action': verb, 'reason': '主管明确核对本版安排后审批'}, expected=expected, key=key)


def shift(api, day=None, start='00:00', hours=24, member='staff'):
    day = day or plans.local_date(now())
    start_at = datetime.fromisoformat(day.isoformat() + 'T' + start + ':00+08:00')
    return post(api, '/shifts', {'name': '演示实际班次', 'start_at': start_at.isoformat(),
        'end_at': (start_at + timedelta(hours=hours)).isoformat(), 'caregiver_ids': [member]})


def generation_body(plan, shift_item, day=None):
    return {'expected_revision': plan['revision'], 'service_date': (day or plans.local_date(now())).isoformat(),
            'shift_id': shift_item['id'], 'assigned_to': shift_item['caregiver_ids'][0]}


def generate(api, plan, shift_item, day=None, expected=200, key=None):
    return post(api, f'/care-plans/{plan["id"]}/generate', generation_body(plan, shift_item, day), expected=expected, key=key)


@pytest.fixture
def assessed(api):
    state = legacy(api)
    record = source(api)
    draft = post(api, '/assessments', assessment_body(record), actor='staff')
    confirmed = review_assessment(api, draft)
    return state, record, confirmed


@pytest.fixture
def planned(api, assessed):
    _, _, assessment = assessed
    draft = post(api, '/care-plans', plan_body(assessment))
    return review_plan(api, draft)


def test_assessment_is_versioned_human_review_not_automatic_grade(api):
    client, store, headers = api
    catalog = client.get(ROOT + '/assessments/templates', headers=headers()).json()[0]
    assert catalog['max_score'] == 100 and len(catalog['items']) == 10 and not catalog['automatic_care_level']
    record = source(api)
    body = assessment_body(record)
    draft = post(api, '/assessments', body, actor='staff', key='assessment-create')
    assert post(api, '/assessments', body, actor='staff', key='assessment-create') == draft
    assert draft['total_score'] == 95 and draft['status'] == 'draft' and not draft['current']['effective']
    assert draft['care_level_label'] is None
    post(api, f'/assessments/{draft["id"]}/review', {'expected_revision': 1, 'action': 'confirm', 'reason': '缺人工依据'}, expected=422)
    post(api, f'/assessments/{draft["id"]}/review', {'expected_revision': 1, 'action': 'confirm',
         'reason': '护理员越权确认', 'care_level_label': 'A', 'care_level_basis': '人工'}, actor='staff', expected=403)
    confirmed = review_assessment(api, draft)
    assert confirmed['revision'] == 2 and confirmed['current']['effective'] and confirmed['care_level_label']
    before = store.path.read_bytes()
    review_assessment(api, draft, expected=409)
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('change', ['missing', 'invalid_option', 'extra', 'bool', 'float', 'future_observation', 'review_past', 'cross_elder', 'false_quote'])
def test_invalid_assessment_input_cannot_become_official(api, change):
    _, store, _ = api
    record = source(api)
    body = assessment_body(record)
    expected = 422
    if change == 'missing':
        del body['scores']['feeding']
    elif change == 'invalid_option':
        body['scores']['bathing'] = 10
    elif change == 'extra':
        body['scores']['fabricated_item'] = 10
    elif change == 'bool':
        body['scores']['bathing'] = True
    elif change == 'float':
        body['scores']['feeding'] = 5.0
    elif change == 'future_observation':
        body['assessed_at'] = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    elif change == 'review_past':
        body['review_due_at'] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    elif change == 'cross_elder':
        store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '另一位虚构老人', 'status': 'active'}))
        from scope_fixtures import grant
        grant(api, 'E2')  # Test cross-elder evidence, separately from access denial.
        body['elder_id'] = 'E2'
    else:
        body['evidence'][0]['quote'] = '来源中不存在的文字'
    before = store.path.read_bytes()
    post(api, '/assessments', body, actor='staff', expected=expected)
    assert store.path.read_bytes() == before


def test_confirm_rechecks_corrected_sources_and_preserves_original_snapshot(api):
    client, store, headers = api
    record = source(api)
    draft = post(api, '/assessments', assessment_body(record), actor='staff')
    post(api, f'/records/{record["id"]}/corrections', {'expected_revision': 1, 'reason': '原观察有误',
         'observations': ['重新核实的观察']}, actor='staff', expected=200)
    before = store.path.read_bytes()
    assert review_assessment(api, draft, expected=409)['detail'] == 'assessment_basis_not_current'
    assert store.path.read_bytes() == before
    current = client.get(ROOT + '/assessments/' + draft['id'], headers=headers()).json()
    assert current['evidence'][0]['snapshot_text'] == QUOTE and not current['current']['sources_current']


def test_reassessment_supersedes_old_version_and_invalidates_plan_tasks(api, assessed, planned):
    client, store, headers = api
    _, record, old = assessed
    generated = generate(api, planned, shift(api))['created_tasks']
    new = post(api, '/assessments', assessment_body(record, supersedes_id=old['id']), actor='staff')
    current = review_assessment(api, new)
    assert current['current']['effective']
    before = store.path.read_bytes()
    old_view = client.get(ROOT + '/assessments/' + old['id'], headers=headers()).json()
    assert old_view['status'] == 'superseded' and old_view['evidence'] == old['evidence']
    assert store.path.read_bytes() == before
    task = generated[0]
    check = client.get(ROOT + f'/tasks/{task["id"]}/plan-check', headers=headers()).json()['current']
    assert not check['ready']
    assert post(api, f'/tasks/{task["id"]}/complete', {'result': '想沿用旧安排'}, actor='staff', expected=409)['detail'] == 'task_plan_requires_review'
    assert store.read()['care_tasks'][0]['source_plan_snapshot']['assessment_id'] == old['id']


def test_parallel_unlinked_assessment_and_plan_cannot_both_be_approved(api, assessed, planned):
    _, record, old = assessed
    draft = post(api, '/assessments', assessment_body(record), actor='staff')
    assert review_assessment(api, draft, expected=409)['detail'] == 'assessment_supersession_required'
    other = post(api, '/care-plans', plan_body(old))
    assert review_plan(api, other, expected=409)['detail'] == 'plan_supersession_required'


def test_plan_needs_confirmed_assessment_then_explicit_approval(api):
    record = source(api)
    draft = post(api, '/assessments', assessment_body(record), actor='staff')
    post(api, '/care-plans', plan_body(draft), expected=409)
    assessment = review_assessment(api, draft)
    plan = post(api, '/care-plans', plan_body(assessment))
    generated_shift = shift(api)
    generate(api, plan, generated_shift, expected=409)
    approved = review_plan(api, plan, key='approve-plan')
    assert review_plan(api, plan, key='approve-plan') == approved
    assert approved['assessment_snapshot']['total_score'] == 95 and approved['status'] == 'active'
    tasks = generate(api, approved, generated_shift)['created_tasks']
    assert len(tasks) == 2 and all(row['status'] == 'pending' for row in tasks)


def test_repeated_generation_with_different_keys_is_still_deduplicated(api, planned):
    _, store, _ = api
    actual_shift = shift(api)
    first = generate(api, planned, actual_shift, key='first-generation')
    assert generate(api, planned, actual_shift, key='first-generation') == first
    second = generate(api, planned, actual_shift, key='different-key')
    assert second['created_tasks'] == [] and set(second['existing_task_ids']) == {row['id'] for row in first['created_tasks']}
    assert len(store.read()['care_tasks']) == 2 and len(store.read()['care_records']) == 1
    for task in first['created_tasks']:
        assert task['source_plan_id'] == planned['id'] and task['source_record_id'] is None and task['source_plan_snapshot']['item']['key'] == 'activity'


def test_concurrent_generation_creates_one_occurrence_only(api, planned):
    _, store, _ = api
    actual_shift = shift(api)
    request = PlanGenerate(**generation_body(planned, actual_shift))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: plans.generate(store, planned['id'], request, 'manager', 'supervisor'), range(2)))
    assert sorted(len(result['created_tasks']) for result in results) == [0, 2]
    assert len({row['occurrence_key'] for row in store.read()['care_tasks']}) == len(store.read()['care_tasks']) == 2


def test_generation_cross_midnight_and_half_open_shift_boundaries(api, assessed):
    _, _, assessment = assessed
    today = plans.local_date(now())
    tomorrow = today + timedelta(days=1)
    body = plan_body(assessment)
    body['items'][0]['times'] = ['00:30', '08:00', '20:00']
    plan = review_plan(api, post(api, '/care-plans', body))
    night = shift(api, today, '20:00', 12)
    before_midnight = generate(api, plan, night, today)['created_tasks']
    after_midnight = generate(api, plan, night, tomorrow)['created_tasks']
    assert len(before_midnight) == len(after_midnight) == 1
    assert before_midnight[0]['scheduled_at'].endswith('20:00:00+08:00')
    assert after_midnight[0]['scheduled_at'].endswith('00:30:00+08:00')
    assert after_midnight[0]['service_date'] == tomorrow.isoformat() and after_midnight[0]['shift_id'] == night['id']


def test_weekdays_and_interval_are_applied_together(api, assessed):
    _, _, assessment = assessed
    day = plans.local_date(now())
    body = plan_body(assessment)
    body['items'][0].update(every_n_days=2, weekdays=[day.isoweekday(), (day + timedelta(days=1)).isoweekday()])
    plan = review_plan(api, post(api, '/care-plans', body))
    assert len(generate(api, plan, shift(api))['created_tasks']) == 2
    assert generate(api, plan, shift(api, day + timedelta(days=1)), day + timedelta(days=1))['created_tasks'] == []


def test_generation_and_execution_recheck_natural_review_deadline(api, planned, monkeypatch):
    client, store, headers = api
    actual_shift = shift(api)
    task = generate(api, planned, actual_shift)['created_tasks'][0]
    due = store.read()['assessments'][0]['review_due_at']
    monkeypatch.setattr(plans, 'now', lambda: due)
    assert not client.get(ROOT + '/care-plans/' + planned['id'], headers=headers()).json()['current']['effective']
    generate(api, planned, actual_shift, expected=409)
    from app.services import task_service
    monkeypatch.setattr(task_service, 'now', lambda: due)
    before = store.path.read_bytes()
    post(api, f'/tasks/{task["id"]}/complete', {'result': '已完成'}, actor='staff', expected=409)
    assert store.path.read_bytes() == before


def test_assessment_due_before_future_service_blocks_generation_atomically(api, planned):
    _, store, _ = api
    tomorrow = plans.local_date(now()) + timedelta(days=1)
    # Current assessment remains valid now, but not at tomorrow's scheduled care.
    due = datetime.combine(tomorrow, datetime.min.time(), tzinfo=plans.CHINA).isoformat()
    store.mutate(lambda data: data['assessments'][0].update(review_due_at=due))
    future_shift = shift(api, tomorrow)
    before = store.path.read_bytes()
    assert generate(api, planned, future_shift, tomorrow, expected=409)['detail'] == 'assessment_review_due_before_service'
    assert store.path.read_bytes() == before


def test_plan_change_blocks_old_task_and_explicit_reissue_preserves_history(api, planned, assessed):
    client, store, headers = api
    actual_shift = shift(api)
    tasks = generate(api, planned, actual_shift)['created_tasks']
    new_body = plan_body(assessed[2], supersedes_id=planned['id'])
    new_body['items'][0]['instruction'] = '先按本人新意愿核实，再安排本次服务。'
    new = review_plan(api, post(api, '/care-plans', new_body))
    old = tasks[0]
    post(api, f'/tasks/{old["id"]}/transition', {'expected_revision': 1, 'action': 'start'}, actor='staff', expected=409)
    assert not generate(api, new, actual_shift)['created_tasks']
    reissue = {'expected_revision': new['revision'], 'previous_task_id': old['id'], 'expected_task_revision': 1,
               'shift_id': actual_shift['id'], 'assigned_to': 'staff', 'reason': '人工确认原待办取消后按新计划补发'}
    post(api, f'/care-plans/{new["id"]}/reissue', reissue, expected=409)
    cancelled = post(api, f'/tasks/{old["id"]}/transition', {'expected_revision': 1, 'action': 'cancel', 'note': '新计划替代，人工取消旧安排'}, expected=200)
    reissue['expected_task_revision'] = cancelled['revision']
    replacement = post(api, f'/care-plans/{new["id"]}/reissue', reissue, key='reissue')
    assert post(api, f'/care-plans/{new["id"]}/reissue', reissue, key='reissue') == replacement
    post(api, f'/care-plans/{new["id"]}/reissue', reissue, expected=409)
    assert replacement['id'] != old['id'] and replacement['replaces_task_id'] == old['id']
    assert replacement['occurrence_key'] == old['occurrence_key']
    post(api, f'/tasks/{replacement["id"]}/complete', {'result': '人工按新版安排完成'}, actor='staff', expected=200)
    retained = next(row for row in store.read()['care_tasks'] if row['id'] == old['id'])
    assert retained['source_plan_snapshot'] == old['source_plan_snapshot'] and retained['status'] == 'cancelled'


def test_plan_condition_remains_blocked_until_existing_human_verification(api, assessed):
    body = plan_body(assessed[2])
    body['items'][0]['condition'] = '等本人明确同意后再开始'
    plan = review_plan(api, post(api, '/care-plans', body))
    task = generate(api, plan, shift(api))['created_tasks'][0]
    assert task['condition'] and task['condition_verification'] is None
    assert post(api, f'/tasks/{task["id"]}/complete', {'result': '直接完成'}, actor='staff', expected=409)['detail'] == 'task_condition_not_ready'


def test_retired_plan_not_retrieved_by_context_ai_or_executable(api, planned, fake_ai):
    client, store, headers = api
    task = generate(api, planned, shift(api))['created_tasks'][0]
    response = post(api, '/records/context-extract', {'elder_id': 'E1', 'scene': 'activity', 'text': '老人本人说今天想先休息。'}, actor='staff', expected=200)
    inputs = fake_ai['requests'][-1]['context']
    assert any(row['kind'] == 'plan' for row in inputs['sources'])
    assert all('evidence' not in row for row in inputs['sources'] if row['kind'] == 'plan')
    draft = response
    review_plan(api, planned, 'retire')
    post(api, f'/records/{draft["id"]}/confirm', {'observations': ['老人本人说今天想先休息。'], 'task_candidates': []}, actor='staff', expected=409)
    post(api, '/records/context-extract', {'elder_id': 'E1', 'scene': 'activity', 'text': '老人本人说今天想先休息。'}, actor='staff', expected=200)
    assert not any(row['kind'] == 'plan' for row in fake_ai['requests'][-1]['context']['sources'])
    assert not client.get(ROOT + f'/tasks/{task["id"]}/plan-check', headers=headers()).json()['current']['ready']


def test_scene_filter_and_ai_call_recheck_plan_changes(api, planned, fake_ai):
    post(api, '/records/context-extract', {'elder_id': 'E1', 'scene': 'bathing', 'text': '老人说今天先休息。'}, actor='staff', expected=200)
    assert not any(row['kind'] == 'plan' for row in fake_ai['requests'][-1]['context']['sources'])
    fake_ai['hook'] = lambda *_: review_plan(api, planned, 'retire')
    post(api, '/records/context-extract', {'elder_id': 'E1', 'scene': 'activity', 'text': '老人说今天先休息。'}, actor='staff', expected=409)


def test_source_correction_invalidates_task_plan_and_quality_flags(api, planned, assessed):
    client, store, headers = api
    task = generate(api, planned, shift(api))['created_tasks'][0]
    post(api, f'/records/{assessed[1]["id"]}/corrections', {'expected_revision': 1, 'reason': '重新观察',
         'observations': ['修正后的观察']}, actor='staff', expected=200)
    before = store.path.read_bytes()
    assert not client.get(ROOT + f'/tasks/{task["id"]}/plan-check', headers=headers()).json()['current']['ready']
    assert store.path.read_bytes() == before
    quality = post(api, '/quality/checks', {'elder_id': 'E1', 'include_ai': False}, expected=201)
    assert any(issue['code'] == 'task_plan_requires_review' for issue in quality['issues'])


def test_draft_permissions_cannot_be_bypassed_through_timeline(api, assessed):
    client, store, headers = api
    draft = post(api, '/care-plans', plan_body(assessed[2]))
    for path in ('/care-plans/' + draft['id'], '/items/' + draft['id'] + '/timeline'):
        assert client.get(ROOT + path, headers=headers()).status_code == 403
    assert client.get(ROOT + '/care-plans', headers=headers()).json() == []
    assert not any(row['source_id'] == draft['id'] for row in client.get(ROOT + '/items/E1/timeline', headers=headers()).json())
    new_assessment = post(api, '/assessments', assessment_body(assessed[1], supersedes_id=assessed[2]['id']), actor='staff')
    assert client.get(ROOT + '/assessments/' + new_assessment['id'], headers=headers('other')).status_code == 403
    assert client.get(ROOT + '/items/' + new_assessment['id'] + '/timeline', headers=headers('other')).status_code == 403
    assert client.get(ROOT + '/care-plans', headers=headers('family')).status_code == 403


def test_generation_checks_shift_membership_and_closed_shift(api, planned):
    _, store, _ = api
    actual_shift = shift(api, member='other')
    body = generation_body(planned, actual_shift)
    body['assigned_to'] = 'staff'
    post(api, f'/care-plans/{planned["id"]}/generate', body, expected=422)
    store.mutate(lambda data: data['shifts'][0].update(status='closed'))
    generate(api, planned, actual_shift, expected=409)


@pytest.mark.parametrize('mutation', ['duplicate_key', 'duplicate_time', 'bad_time', 'no_times', 'invalid_weekday', 'bad_interval', 'invalid_dates'])
def test_plan_schedule_rejects_ambiguous_or_invalid_values(api, assessed, mutation):
    body = plan_body(assessed[2])
    if mutation == 'duplicate_key':
        body['items'].append(copy.deepcopy(body['items'][0]))
    elif mutation == 'duplicate_time':
        body['items'][0]['times'] = ['09:00', '09:00']
    elif mutation == 'bad_time':
        body['items'][0]['times'] = ['24:00']
    elif mutation == 'no_times':
        body['items'][0]['times'] = []
    elif mutation == 'invalid_weekday':
        body['items'][0]['weekdays'] = [0]
    elif mutation == 'bad_interval':
        body['items'][0]['every_n_days'] = 0
    else:
        body['ends_on'] = '2000-01-01'
    post(api, '/care-plans', body, expected=422)


def test_plan_system_references_cannot_be_injected_into_manual_candidates(api):
    post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '本次记录',
        'task_candidates': [{'title': '伪装计划来源', 'source_plan_id': 'forged'}]}, actor='staff', expected=422)


def test_plan_generation_is_atomic_on_late_failure(api, planned, monkeypatch):
    _, store, _ = api
    actual_shift = shift(api)
    before = store.path.read_bytes()
    def fail(*args, **kwargs):
        raise RuntimeError('simulated task audit failure')
    monkeypatch.setattr(plans, 'audit', fail)
    with pytest.raises(RuntimeError):
        plans.generate(store, planned['id'], PlanGenerate(**generation_body(planned, actual_shift)), 'manager', 'supervisor', 'late-failure')
    assert store.path.read_bytes() == before


def test_assessment_review_rechecks_account_in_transaction(api, assessed):
    _, store, _ = api
    store.mutate(lambda data: data['users'][2].update(active=False))
    before = store.path.read_bytes()
    with pytest.raises(DomainError) as failure:
        assessments.review(store, assessed[2]['id'], AssessmentReview(expected_revision=2, action='retire', reason='测试旧权限'), 'manager', 'supervisor')
    assert failure.value.status_code == 403 and store.path.read_bytes() == before


def test_plan_handover_requires_refresh_after_assessment_expiry_and_keeps_task_identity(api, planned, monkeypatch):
    client, store, headers = api
    today = plans.local_date(now())
    first = shift(api)
    second = shift(api, today + timedelta(days=1), member='other')
    tasks = generate(api, planned, first)['created_tasks']
    handover = post(api, '/handovers', {'source_shift_id': first['id'], 'target_shift_id': second['id']}, actor='staff')
    due = store.read()['assessments'][0]['review_due_at']
    from app.services import handover_service
    monkeypatch.setattr(handover_service, 'now', lambda: due)
    post(api, f'/handovers/{handover["id"]}/submit', {'expected_revision': 1}, actor='staff', expected=409)
    refreshed = client.post(ROOT + f'/handovers/{handover["id"]}/refresh', headers=headers()).json()
    task_items = [row for row in refreshed['items'] if row['kind'] == 'task']
    assert all(not row['plan_check']['ready'] for row in task_items)
    post(api, f'/handovers/{handover["id"]}/submit', {'expected_revision': refreshed['revision']}, actor='staff', expected=200)
    snapshot = copy.deepcopy(store.read()['handover_items'])
    for item in refreshed['items']:
        post(api, f'/handovers/{handover["id"]}/items/{item["id"]}/receive', {'status': 'received'}, actor='other', expected=200)
    current = client.get(ROOT + f'/tasks/{tasks[0]["id"]}', headers=headers('other')).json()
    assert current['id'] == tasks[0]['id'] and current['shift_id'] == second['id']
    assert current['source_plan_snapshot'] == tasks[0]['source_plan_snapshot']
    assert store.read()['handover_items'][0]['source_plan_snapshot'] == snapshot[0]['source_plan_snapshot']


@pytest.mark.parametrize('kind', ['summary', 'quality'])
def test_ai_summary_and_quality_recheck_plan_state_after_provider_wait(api, planned, monkeypatch, kind):
    _, store, _ = api
    actual_shift = shift(api)
    generate(api, planned, actual_shift)
    target = shift(api, plans.local_date(now()) + timedelta(days=1), member='other')
    handover = post(api, '/handovers', {'source_shift_id': actual_shift['id'], 'target_shift_id': target['id']}, actor='staff')
    initial = store.read()
    class RacingProvider(MockAIProvider):
        def summarize(self, inputs):
            result = super().summarize(inputs)
            review_plan(api, planned, 'retire')
            return result
        def quality(self, inputs):
            result = super().quality(inputs)
            review_plan(api, planned, 'retire')
            return result
    provider = RacingProvider()
    if kind == 'summary':
        monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
        post(api, f'/handovers/{handover["id"]}/ai-summary', {'expected_revision': 1}, actor='staff', expected=409)
    else:
        monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: provider)
        post(api, '/quality/checks', {'elder_id': 'E1', 'include_ai': True}, expected=409)
    latest = store.read()
    assert latest['handovers'] == initial['handovers'] and latest['quality_checks'] == initial['quality_checks']


def test_prior_admission_plan_never_becomes_effective_after_readmission(api, assessed, planned):
    client, store, headers = api
    closed = admission_action(api, assessed[0], 'discharge')
    from test_facility import admit
    admit(api, closed['elder'], closed['bed'])
    before = store.path.read_bytes()
    old = client.get(ROOT + '/care-plans/' + planned['id'], headers=headers()).json()
    assert not old['current']['effective'] and 'plan_admission_changed' in old['current']['blocked_reasons']
    assert store.path.read_bytes() == before


def test_rejecting_drafts_never_supersedes_current_approved_versions(api, assessed, planned):
    client, store, headers = api
    draft = post(api, '/assessments', assessment_body(assessed[1], supersedes_id=assessed[2]['id']), actor='staff')
    review_assessment(api, draft, 'reject')
    assert client.get(ROOT + '/assessments/' + assessed[2]['id'], headers=headers()).json()['current']['effective']
    draft_plan = post(api, '/care-plans', plan_body(assessed[2], supersedes_id=planned['id']))
    review_plan(api, draft_plan, 'reject')
    assert client.get(ROOT + '/care-plans/' + planned['id'], headers=headers()).json()['current']['effective']


def test_future_revision_cannot_silently_remove_current_plan(api, assessed, planned):
    client, store, headers = api
    future = plans.local_date(now()) + timedelta(days=1)
    draft = post(api, '/care-plans', plan_body(assessed[2], starts_on=future.isoformat(), supersedes_id=planned['id']))
    before = store.path.read_bytes()
    assert review_plan(api, draft, expected=409)['detail'] == 'cannot_supersede_before_effective_date'
    assert store.path.read_bytes() == before
    assert client.get(ROOT + '/care-plans/' + planned['id'], headers=headers()).json()['current']['effective']


def test_plan_timeline_links_approval_assessment_and_generated_tasks(api, planned):
    client, _, headers = api
    generated = generate(api, planned, shift(api))['created_tasks']
    events = client.get(ROOT + f'/items/{planned["id"]}/timeline', headers=headers()).json()
    actions = {row['action'] for row in events}
    assert {'create_assessment', 'review_assessment', 'create_plan', 'review_plan', 'create_plan_task'} <= actions
    task_events = client.get(ROOT + f'/items/{generated[0]["id"]}/timeline', headers=headers()).json()
    assert any(row['source_id'] == planned['id'] and row['action'] == 'review_plan' for row in task_events)


def test_caregiver_and_family_cannot_create_or_generate_plan(api, assessed, planned):
    for actor in ('staff', 'family'):
        post(api, '/care-plans', plan_body(assessed[2]), actor=actor, expected=403)
        post(api, f'/care-plans/{planned["id"]}/generate', {'expected_revision': 2,
             'service_date': planned['starts_on'], 'shift_id': 'some-shift', 'assigned_to': 'staff'}, actor=actor, expected=403)


def test_stale_plan_revision_and_different_idempotency_body_fail_without_writes(api, planned):
    _, store, _ = api
    actual_shift = shift(api)
    generate(api, planned, actual_shift, key='fixed-generation')
    before = store.path.read_bytes()
    body = generation_body(planned, actual_shift)
    body['service_date'] = (plans.local_date(now()) + timedelta(days=1)).isoformat()
    assert post(api, f'/care-plans/{planned["id"]}/generate', body, expected=409, key='fixed-generation')['detail'] == 'idempotency_key_payload_mismatch'
    body = generation_body(planned, actual_shift)
    body['expected_revision'] = 1
    post(api, f'/care-plans/{planned["id"]}/generate', body, expected=409)
    assert store.path.read_bytes() == before
