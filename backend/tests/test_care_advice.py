"""Synthetic provider responses verify workflow rules, not real model accuracy."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from app.services import care_advice_service as service
from app.services.ai_service import AIProviderError, DeepSeekAIProvider
from app.storage.json_store import CURRENT_SCHEMA_VERSION, EMPTY_STORE, JsonStore


BASE = '/api/v1/elders/E1/care-advice'
OBSERVATION = '张阿姨本人说喜欢午后听戏，音量小一些。'


@pytest.fixture
def advice(api, monkeypatch):
    client, store, headers = api
    instant = datetime.now(timezone.utc)
    store.mutate(lambda d: d['shifts'].append({
        'id': 'DAY', 'name': '日班', 'start_at': (instant - timedelta(hours=1)).isoformat(),
        'end_at': (instant + timedelta(hours=7)).isoformat(), 'status': 'open',
        'caregiver_ids': ['staff', 'other'], 'created_by': 'manager',
    }))
    record_response = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': 'E1', 'raw_text': OBSERVATION, 'observations': [OBSERVATION],
    })
    assert record_response.status_code == 201, record_response.text
    state = {'calls': [], 'hook': None, 'record': record_response.json()['record']}
    provider = DeepSeekAIProvider('test-only', 'https://example.invalid', 'test-model', 1)
    def request(instruction, body):
        context = json.loads(body)
        state['calls'].append({'instruction': instruction, 'context': copy.deepcopy(context)})
        record = next(s for s in context['sources'] if s['kind'] == 'record')
        output = {'suggestions': [{
            'title': '先询问是否愿意午后听戏', 'action': '询问本人当前意愿，愿意时播放小音量戏曲。',
            'rationale': '本人曾表示喜欢午后听戏。', 'uncertainty': '只有一次观察，需再次询问本人。',
            'condition': None, 'citations': [{'source_id': record['source_id'], 'quote': record['text']}],
        }]}
        if state['hook']:
            state['hook'](output, context)
        return output
    monkeypatch.setattr(provider, '_request', request)
    monkeypatch.setattr(service, 'get_ai_provider', lambda: provider)
    state['provider'] = provider
    return state


def call(api, path, body=None, actor='staff', expected=200, key=None, method='post'):
    client, _, headers = api
    auth = headers(actor)
    if key:
        auth['Idempotency-Key'] = key
    response = getattr(client, method)(path, headers=auth, **({'json': body} if method != 'get' else {}))
    assert response.status_code == expected, response.text
    return response.json()


def generate(api, **changes):
    return call(api, BASE + '/generate', {'scene': 'activity', 'shift_id': 'DAY', **changes})


def adopt_payload(item, **task_changes):
    return {'expected_revision': item['revision'], 'reason': '已询问本人，确认本次尝试。', 'task': {
        'elder_id': 'E1', 'title': item['action'], 'shift_id': 'DAY', 'assigned_to': 'staff',
        'due_at': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        'completion_criteria': '记录是否愿意听戏和本人感受', 'source_type': 'manual',
        'condition': item.get('condition'), **task_changes,
    }}


def adopted(api):
    item = generate(api)['items'][0]
    return call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(item))


def feedback_payload(item, **changes):
    return {'expected_revision': item['revision'], 'expected_task_revision': item['task']['revision'],
        'response': 'accepted', 'observation': '本人愿意听戏，表示当前音量合适。',
        'happened_at': datetime.now(timezone.utc).isoformat(), 'shift_id': 'DAY', 'followup': 'none', **changes}


def with_feedback(api):
    item = adopted(api)
    task = call(api, '/api/v1/tasks/' + item['task_id'] + '/complete', {'result': '已询问后播放小音量戏曲'})
    item['task'] = task
    return call(api, BASE + '/' + item['id'] + '/feedback', feedback_payload(item))


def review_payload(item, decision='continue_trial'):
    return {'expected_revision': item['revision'], 'expected_feedback_fingerprint': item['feedback_fingerprint'],
            'decision': decision, 'note': '核对本人反应与原文，仅作为本次尝试的复核。'}


def test_generate_grounded_scoped_and_model_version_cache(api, advice):
    first = generate(api)
    assert first == generate(api)
    assert len(advice['calls']) == 1
    assert first['model'] == 'test-model' and first['model_status'] == 'available'
    item = first['items'][0]
    assert item['can_adopt'] and item['task'] is None and not item['needs_review']
    assert item['citations'][0]['quote'] == OBSERVATION
    context = advice['calls'][0]['context']
    assert all(s.get('object_id') != 'E2' for s in context['sources'])
    assert context['coverage']['recent_records']['included'] == 1
    assert api[1].read()['care_tasks'] == []
    advice['provider'].model = 'new-model'
    assert generate(api)['batch_id'] != first['batch_id']
    assert len(advice['calls']) == 2


@pytest.mark.parametrize('failure', ['bad_id', 'bad_quote', 'no_citations', 'professional', 'duplicate', 'extra_field'])
def test_invalid_provider_output_never_saves_advice(api, advice, failure):
    def invalid(output, context):
        point = output['suggestions'][0]
        if failure == 'bad_id':
            point['citations'][0]['source_id'] = 'record/not-authorized/v1'
        elif failure == 'bad_quote':
            point['citations'][0]['quote'] = '虚构的原文内容'
        elif failure == 'no_citations':
            point['citations'] = []
        elif failure == 'professional':
            point['action'] = '建议服用20毫克某药'
        elif failure == 'duplicate':
            point['citations'].append(copy.deepcopy(point['citations'][0]))
        else:
            point['assigned_to'] = 'staff'
    advice['hook'] = invalid
    before = api[1].path.read_bytes()
    call(api, BASE + '/generate', {'scene': 'activity'}, expected=503)
    assert api[1].path.read_bytes() == before


def test_no_personal_evidence_and_provider_failure_leave_manual_path(api, advice):
    def fail(*_):
        raise AIProviderError('private-provider-error')
    advice['provider']._request = fail
    body = call(api, BASE + '/generate', {'scene': 'activity'}, expected=503)
    assert 'private-provider-error' not in str(body)
    api[1].mutate(lambda d: d['care_records'].clear())
    body = call(api, BASE + '/generate', {'scene': 'activity'}, expected=422)
    assert body['error_code'] == 'advice_insufficient_sources'
    assert api[1].read()['care_advice'] == []
    # Existing manual entry still works when the provider fails.
    call(api, '/api/v1/records/manual', {'elder_id': 'E1', 'raw_text': '本人今天想休息'}, expected=201)


def test_record_filter_and_explicit_coverage(api, advice):
    def seed(d):
        base = copy.deepcopy(d['care_records'][0])
        for i in range(35):
            d['care_records'].append({**base, 'id': f'RECENT-{i:02}', 'created_at':
                (datetime.now(timezone.utc) - timedelta(minutes=40-i)).isoformat()})
        d['care_records'].extend([
            {**base, 'id': 'FUTURE', 'happened_at': '2099-01-01T00:00:00Z'},
            {**base, 'id': 'OLD', 'happened_at': '2020-01-01T00:00:00Z'},
            {**base, 'id': 'PREVIOUS-ADMISSION', 'admission_id': 'OLD'},
            {**base, 'id': 'OTHER-ELDER', 'elder_id': 'E2'},
            {**base, 'id': 'UNCONFIRMED', 'status': 'pending_review'},
        ])
    api[1].mutate(seed)
    result = generate(api)
    coverage = result['coverage']['recent_records']
    assert (coverage['eligible'], coverage['included'], coverage['excluded']) == (36, 30, 6)
    ids = {s['object_id'] for s in advice['calls'][0]['context']['sources']}
    assert not ids.intersection({'FUTURE', 'OLD', 'PREVIOUS-ADMISSION', 'OTHER-ELDER', 'UNCONFIRMED'})


@pytest.mark.parametrize('race', ['correction', 'revoke', 'discharge'])
def test_changed_context_or_permissions_during_generation_cannot_commit(api, advice, race):
    def change(*_):
        def mutate(d):
            if race == 'correction':
                d['care_records'][0].update(revision=2, observations=['实际今天想休息'])
            elif race == 'revoke':
                d['care_assignments'].clear()
            else:
                d['elders'][0]['status'] = 'discharged'
        api[1].mutate(mutate)
    advice['hook'] = change
    call(api, BASE + '/generate', {'scene': 'activity'}, expected=403 if race == 'revoke' else 409)
    assert api[1].read()['care_advice'] == []


def test_concurrent_generation_and_adoption_are_deduplicated(api, advice):
    with ThreadPoolExecutor(max_workers=2) as pool:
        batches = list(pool.map(lambda _: generate(api), range(2)))
    assert batches[0]['batch_id'] == batches[1]['batch_id']
    item = batches[0]['items'][0]
    body = adopt_payload(item)
    url = BASE + '/' + item['id'] + '/adopt'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: call(api, url, body, key='adopt-once'), range(2)))
    assert results[0] == results[1]
    assert len(api[1].read()['care_tasks']) == 1
    call(api, url, {**body, 'reason': '改了原因'}, key='adopt-once', expected=409)
    call(api, url, body, expected=409)
    assert results[0]['task']['source_advice_id'] == item['id']


@pytest.mark.parametrize('failure', ['missing_field', 'other_elder', 'assign_other', 'past_due', 'stale', 'source_type'])
def test_invalid_adoption_rolls_back_task_and_advice(api, advice, failure):
    item = generate(api)['items'][0]
    body = adopt_payload(item)
    expected = 422
    if failure == 'missing_field':
        del body['task']['completion_criteria']
    elif failure == 'other_elder':
        body['task']['elder_id'] = 'E2'
    elif failure == 'assign_other':
        body['task']['assigned_to'] = 'other'
        expected = 403
    elif failure == 'past_due':
        body['task']['due_at'] = '2020-01-01T00:00:00Z'
    elif failure == 'stale':
        body['expected_revision'] = 2
        expected = 409
    else:
        body['task'].update(source_type='record', source_id=advice['record']['id'], source_revision=1)
    before = api[1].path.read_bytes()
    call(api, BASE + '/' + item['id'] + '/adopt', body, expected=expected)
    assert api[1].path.read_bytes() == before


def test_condition_preserved_and_original_condition_gate_used(api, advice):
    advice['hook'] = lambda output, _: output['suggestions'][0].update(condition='本人再次表示愿意听戏')
    item = generate(api)['items'][0]
    call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(item, condition=None), expected=422)
    item = call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(item))
    call(api, '/api/v1/tasks/' + item['task_id'] + '/complete', {'result': '尝试完成'}, expected=409)


def test_reject_and_expiry_prevent_adoption(api, advice):
    item = generate(api)['items'][0]
    reject = {'expected_revision': 1, 'reason': '本次本人希望休息'}
    url = BASE + '/' + item['id'] + '/reject'
    first = call(api, url, reject, key='reject')
    assert first == call(api, url, reject, key='reject')
    assert first['status'] == 'rejected' and not first['can_adopt']
    call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(first), expected=409)
    assert api[1].read()['care_tasks'] == []
    api[1].mutate(lambda d: d['care_advice'][0].update(status='proposed', valid_until='2020-01-01T00:00:00Z'))
    call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(first), expected=409)


def test_feedback_record_review_notification_timeline_and_no_auto_memory(api, advice):
    item = with_feedback(api)
    assert item['needs_review'] and item['feedback'][0]['source_current']
    assert api[1].read()['care_memories'] == []
    feedback = item['feedback'][0]
    record = next(r for r in api[1].read()['care_records'] if r['id'] == feedback['record_id'])
    assert record['status'] == 'confirmed' and record['observations'] == [feedback['observation']]
    call(api, BASE + '/' + item['id'] + '/review', review_payload(item), actor='staff', expected=403)
    notices = call(api, '/api/v1/notifications?pending=true', actor='manager', method='get')['items']
    assert any(n['object_id'] == item['id'] and n['stage'] == 'advice_review' for n in notices)
    reviewed = call(api, BASE + '/' + item['id'] + '/review', review_payload(item), actor='manager', key='review')
    assert not reviewed['needs_review']
    assert call(api, BASE + '/' + item['id'] + '/review', review_payload(item), actor='manager', key='review') == reviewed
    notices = call(api, '/api/v1/notifications?pending=true', actor='manager', method='get')['items']
    assert not any(n['object_id'] == item['id'] for n in notices)
    timeline = call(api, '/api/v1/items/' + item['id'] + '/timeline', method='get')
    actions = {e['action'] for e in timeline}
    assert {'generate_care_advice', 'adopt_care_advice', 'complete_task',
            'create_manual_record', 'feedback_care_advice', 'review_care_advice'} <= actions


def test_feedback_requires_result_is_idempotent_and_validates_followup_atomically(api, advice):
    item = adopted(api)
    url = BASE + '/' + item['id'] + '/feedback'
    call(api, url, feedback_payload(item), expected=409)
    item['task'] = call(api, '/api/v1/tasks/' + item['task_id'] + '/complete', {'result': '已尝试'})
    before = api[1].path.read_bytes()
    call(api, url, feedback_payload(item, followup='observe'), expected=422)
    assert api[1].path.read_bytes() == before
    body = feedback_payload(item, followup='observe', followup_assigned_to='staff',
                            followup_due_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat())
    result = call(api, url, body, key='feedback')
    assert call(api, url, body, key='feedback') == result
    assert len(api[1].read()['care_tasks']) == 2
    call(api, url, {**body, 'expected_revision': result['revision']}, expected=409)
    assert len(api[1].read()['care_records']) == 2


@pytest.mark.parametrize('stage', ['before_adopt', 'before_start', 'before_complete'])
def test_source_correction_blocks_stale_advice_execution(api, advice, stage):
    item = generate(api)['items'][0] if stage == 'before_adopt' else adopted(api)
    api[1].mutate(lambda d: d['care_records'][0].update(revision=2, observations=['更正为本人不愿听戏']))
    detail = call(api, BASE + '/' + item['id'], method='get')
    assert not detail['source_current'] and not detail['can_adopt']
    before = api[1].path.read_bytes()
    if stage == 'before_adopt':
        call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(item), expected=409)
    elif stage == 'before_start':
        call(api, '/api/v1/tasks/' + item['task_id'] + '/transition',
             {'action': 'start', 'expected_revision': 1}, expected=409)
    else:
        call(api, '/api/v1/tasks/' + item['task_id'] + '/complete', {'result': '完成'}, expected=409)
    assert api[1].path.read_bytes() == before


def test_correction_impact_lists_advice_and_task_and_feedback_can_be_replaced(api, advice):
    item = with_feedback(api)
    for record_id in (advice['record']['id'], item['feedback'][0]['record_id']):
        body = {'expected_revision': 1, 'observations': ['人工核实后更正此项观察'], 'reason': '核对原文'}
        result = call(api, '/api/v1/records/' + record_id + '/corrections/preview', body, actor='manager')
        assert {r['kind'] for r in result['explicit_references']} >= {'care_advice', 'task'}
    feedback_id = item['feedback'][0]['record_id']
    api[1].mutate(lambda d: next(r for r in d['care_records'] if r['id'] == feedback_id).update(revision=2))
    call(api, BASE + '/' + item['id'] + '/review', review_payload(item), actor='manager', expected=409)
    replaced = call(api, BASE + '/' + item['id'] + '/feedback', feedback_payload(item))
    assert len(replaced['feedback']) == 2
    assert not replaced['feedback'][0]['source_current'] and replaced['feedback'][-1]['source_current']
    reviewed = call(api, BASE + '/' + item['id'] + '/review', review_payload(replaced), actor='manager')
    assert not reviewed['needs_review']


@pytest.mark.parametrize('decision', ['stop', 'adjust'])
def test_supervisor_stop_or_adjust_blocks_reopened_trial(api, advice, decision):
    item = adopted(api)
    task = call(api, '/api/v1/tasks/' + item['task_id'] + '/transition',
                {'action': 'not_done', 'expected_revision': 1, 'reason_code': 'elder_refused', 'note': '本人本次不愿听戏'})
    item['task'] = task
    item = call(api, BASE + '/' + item['id'] + '/feedback', feedback_payload(item, response='declined'))
    call(api, BASE + '/' + item['id'] + '/review', review_payload(item, decision), actor='manager')
    task = call(api, '/api/v1/tasks/' + item['task_id'] + '/transition',
                {'action': 'reopen', 'expected_revision': task['revision'], 'note': '重新核对'})
    result = call(api, '/api/v1/tasks/' + task['id'] + '/transition',
                  {'action': 'start', 'expected_revision': task['revision']}, expected=409)
    assert result['error_code'] == 'advice_trial_paused'


def test_cross_elder_role_and_revoked_scope_isolation(api, advice):
    item = generate(api)['items'][0]
    for suffix in ('', '/' + item['id']):
        call(api, BASE + suffix, actor='family', method='get', expected=403)
    api[1].mutate(lambda d: d['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'active'}))
    call(api, '/api/v1/elders/E2/care-advice/' + item['id'], actor='manager', method='get', expected=404)
    api[1].mutate(lambda d: d['care_assignments'].clear())
    call(api, BASE, method='get', expected=403)
    call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(item), expected=403)
    call(api, '/api/v1/items/' + item['id'] + '/timeline', method='get', expected=403)
    assert call(api, BASE, actor='manager', method='get')['total'] == 1


def test_mock_returns_empty_without_fabricating_personal_advice(api, advice, monkeypatch):
    from app.services.ai_service import get_ai_provider
    monkeypatch.setattr(service, 'get_ai_provider', get_ai_provider)
    result = generate(api)
    assert result['model_status'] == 'demo' and result['items'] == []
    assert api[1].read()['care_tasks'] == []
    runs = [r for r in api[1].read()['ai_evaluations'] if r.get('feature') == 'care_advice']
    assert len(runs) == 1 and runs[0]['is_demo']
    assert runs[0]['prompt_version'] == service.PROMPT_VERSION
    assert 'context' not in runs[0]


def test_schema_six_migration_backs_up_and_preserves_history(tmp_path):
    old = copy.deepcopy(EMPTY_STORE)
    old['schema_version'] = 6
    old.pop('care_advice')
    old.pop('care_advice_batches')
    old['elders'] = [{'id': 'E1', 'name': '张阿姨'}]
    store = JsonStore(tmp_path)
    store.path.write_text(json.dumps(old, ensure_ascii=False), encoding='utf-8')
    original = store.path.read_bytes()
    backup = store.migrate()
    assert backup.read_bytes() == original
    assert store.read()['schema_version'] == CURRENT_SCHEMA_VERSION
    assert store.read()['elders'] == old['elders']
    assert store.read()['care_advice'] == store.read()['care_advice_batches'] == []
    assert store.migrate() is None


def test_confirmed_memory_can_support_advice_but_suspension_blocks_adoption(api, advice):
    from test_assistant import create_memory
    memory, _ = create_memory(api, content='平时愿意午后听戏')
    def cite_memory(output, context):
        source = next(s for s in context['sources'] if s['kind'] == 'memory')
        output['suggestions'][0]['citations'] = [{'source_id': source['source_id'], 'quote': source['text']}]
    advice['hook'] = cite_memory
    item = generate(api)['items'][0]
    call(api, '/api/v1/memories/' + memory['id'] + '/review', {
        'action': 'suspend', 'expected_revision': memory['revision'], 'reason': '本人最近有不同意愿，先核实'}, actor='manager')
    call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(item), expected=409)
    assert not call(api, BASE + '/' + item['id'], method='get')['source_current']


def test_task_arrangement_alone_is_not_personal_evidence(api, advice):
    call(api, '/api/v1/tasks', adopt_payload({'revision': 1, 'action': '询问活动意愿'})['task'], expected=201)
    def cite_only_task(output, context):
        source = next(s for s in context['sources'] if s['kind'] == 'task')
        output['suggestions'][0]['citations'] = [{'source_id': source['source_id'], 'quote': source['text']}]
    advice['hook'] = cite_only_task
    call(api, BASE + '/generate', {'scene': 'activity'}, expected=503)
    assert api[1].read()['care_advice'] == []


def test_source_changes_require_fresh_review_token_and_stopping_resolves_notice(api, advice):
    item = with_feedback(api)
    reviewed = call(api, BASE + '/' + item['id'] + '/review', review_payload(item), actor='manager')
    assert not reviewed['needs_review']
    # Use the actual correction route to preserve the original and trigger the
    # same dependency/notification behavior as a supervisor editing a record.
    call(api, '/api/v1/records/' + advice['record']['id'] + '/corrections', {
        'expected_revision': 1, 'observations': ['更正：是家属喜欢听戏，本人意愿未核实'], 'reason': '核对说话人'}, actor='manager')
    call(api, BASE + '/' + item['id'] + '/review', review_payload(reviewed, 'stop'), actor='manager', expected=409)
    current = call(api, BASE + '/' + item['id'], method='get')
    assert current['needs_review'] and not current['source_current']
    notices = call(api, '/api/v1/notifications?pending=true', actor='manager', method='get')['items']
    assert any(n['object_id'] == item['id'] for n in notices)
    notice_ids = [n['id'] for n in api[1].read()['notifications'] if n['object_id'] == item['id']]
    call(api, '/api/v1/notifications?pending=true', actor='manager', method='get')
    assert [n['id'] for n in api[1].read()['notifications'] if n['object_id'] == item['id']] == notice_ids
    stopped = call(api, BASE + '/' + item['id'] + '/review', review_payload(current, 'stop'), actor='manager')
    assert not stopped['needs_review'] and not stopped['source_current']
    notices = call(api, '/api/v1/notifications?pending=true', actor='manager', method='get')['items']
    assert not any(n['object_id'] == item['id'] for n in notices)


def test_adoption_disk_failure_keeps_advice_and_task_atomic(api, advice, monkeypatch):
    from app.storage import json_store
    item = generate(api)['items'][0]
    original = api[1].path.read_bytes()
    with monkeypatch.context() as patch:
        def fail(*_):
            raise OSError('synthetic disk failure')
        patch.setattr(json_store.os, 'replace', fail)
        with pytest.raises(OSError):
            call(api, BASE + '/' + item['id'] + '/adopt', adopt_payload(item))
    assert api[1].path.read_bytes() == original
    assert api[1].read()['care_tasks'] == []
    assert api[1].read()['care_advice'][0]['status'] == 'proposed'
