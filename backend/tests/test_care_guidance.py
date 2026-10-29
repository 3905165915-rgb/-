"""Synthetic HTTP acceptance: persistence, isolation, concurrency and task separation."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from app.services import care_guidance_service as service
from app.storage.json_store import EMPTY_STORE, JsonStore
from test_care_advice import advice, generate
from test_dashboard import dashboard

ROOT = '/api/v1/elders/E1'


def call(api, path, body=None, *, actor='manager', expected=200, key='test', method='post'):
    client, _, headers = api
    auth = headers(actor)
    if key:
        auth['Idempotency-Key'] = key
    result = getattr(client, method)(path, headers=auth, **({'json': body} if method == 'post' else {}))
    assert result.status_code == expected, result.text
    return result.json()


def arrangement(kind='routine_hint'):
    line = {'title': '活动前询问本人意愿', 'content_type': kind, 'condition': '先确认本人愿意沟通'}
    body = {'title': '尊重本人的生活照护', 'goal': '', 'content_type': kind}
    if kind == 'routine_hint':
        line.update(scene='before_activity', instruction='放慢语速，一次只问一件事')
    else:
        line.update(occasion='before_activity', record_what='记录实际询问及本人回应，允许拒绝或休息')
        body['service_date'] = service.today()
    return {**body, 'items': [line]}


def save(api, kind='routine_hint', *, key='save', body=None):
    body = body or arrangement(kind)
    preview = call(api, ROOT + '/arrangement/preview', body)
    saved = call(api, ROOT + '/arrangement/confirm', {**body, 'context_token': preview['context_token']}, key=key)
    return saved['guidance'][0]


def response_body(row, response='unclear'):
    return {'expected_revision': row['revision'], 'response': response,
            'observation': '已询问，本人表示现在想休息，尊重本次选择。',
            'happened_at': datetime.now(timezone.utc).isoformat()}


@pytest.mark.parametrize('kind', ['routine_hint', 'one_off_reminder'])
def test_arrangement_readonly_preview_atomic_confirm_and_restart_persistence(api, kind):
    before = api[1].path.read_bytes()
    preview = call(api, ROOT + '/arrangement/preview', arrangement(kind))
    assert api[1].path.read_bytes() == before
    assert preview['elder_id'] == 'E1' and preview['content_type'] == kind
    assert preview['items'][0]['content_type'] == kind
    body = {**arrangement(kind), 'context_token': preview['context_token']}
    saved = call(api, ROOT + '/arrangement/confirm', body)
    assert saved == call(api, ROOT + '/arrangement/confirm', body)
    assert saved['plan']['content_type'] == kind and saved['created_tasks'] == []
    reopened = JsonStore(api[1].data_dir).read()
    assert len(reopened['care_guidance']) == len(reopened['care_guidance_plans']) == 1
    assert reopened['care_guidance'][0]['revision'] == 1
    assert not reopened['care_tasks'] and not reopened['care_plans'] and not reopened['care_memories']
    listing = call(api, ROOT + '/care-guidance', method='get')
    assert listing['items'] == saved['guidance']


@pytest.mark.parametrize('field,value', [('shift_id','DAY'), ('assigned_to','staff'), ('starts_on','2026-10-28'), ('task',{}), ('service_date','2026-10-28')])
def test_hint_rejects_hidden_task_and_date_fields(api, field, value):
    before = api[1].path.read_bytes()
    call(api, ROOT + '/arrangement/preview', {**arrangement(), field: value}, expected=422)
    assert before == api[1].path.read_bytes()


@pytest.mark.parametrize('mutation', ['type', 'title', 'elder', 'admission'])
def test_preview_token_binds_content_elder_and_current_admission(api, mutation):
    body = arrangement()
    preview = call(api, ROOT + '/arrangement/preview', body)
    if mutation == 'type':
        body = arrangement('one_off_reminder')
    elif mutation == 'title':
        body['items'][0]['title'] = '改为用餐前询问'
    else:
        api[1].mutate(lambda d: d['elders'][0].update(**({'notes':'资料变化'} if mutation == 'elder' else {'current_admission_id':'new'})))
    call(api, ROOT + '/arrangement/confirm', {**body,'context_token':preview['context_token']}, expected=409)
    assert not api[1].read()['care_guidance']


def test_permissions_visibility_and_revision_lifecycle(api):
    row = save(api)
    path = ROOT + '/care-guidance/' + row['id'] + '/status'
    body = {'expected_revision': 1, 'status': 'disabled', 'reason': '需核实'}
    call(api, path, body, actor='staff', expected=403)
    adjusted = call(api, path, {**body,'status':'needs_adjustment'}, actor='staff', key='adjust')
    assert adjusted['revision'] == 2
    assert call(api, ROOT + '/care-guidance', actor='staff', method='get')['items'] == []
    call(api, path, body, expected=409)
    enabled = call(api, path, {**body,'expected_revision':2,'status':'enabled'}, key='enable')
    assert enabled['revision'] == 3 and enabled['confirmed_by'] == 'manager'
    assert call(api, ROOT + '/care-guidance', actor='staff', method='get')['items'][0]['id'] == row['id']
    disabled = call(api, path, {**body,'expected_revision':3}, key='disable')
    assert disabled['status'] == 'disabled'
    assert call(api, ROOT + '/care-guidance', actor='staff', method='get')['items'] == []


@pytest.mark.parametrize('response', ['willing','alternative','rest','declined','unclear'])
def test_reminder_response_is_formal_record_without_tasks_memory_or_jobs(api, response):
    row = save(api, 'one_off_reminder')
    path = ROOT + '/care-guidance/' + row['id'] + '/record'
    body = response_body(row, response)
    result = call(api, path, body, actor='staff')
    assert result == call(api, path, body, actor='staff')
    assert result['guidance']['status'] == 'recorded'
    assert result['guidance']['revision'] == 2
    assert result['record']['source_guidance_id'] == row['id']
    assert result['record']['care_response'] == response
    data = api[1].read()
    assert len(data['care_records']) == 1
    assert not data['care_tasks'] and not data['care_memories'] and not data['care_jobs']
    call(api, path, body, actor='staff', key='second-response', expected=409)


def test_reminder_future_expired_cancelled_and_invalid_time_are_blocked(api, monkeypatch):
    row = save(api, 'one_off_reminder')
    path = ROOT + '/care-guidance/' + row['id']
    body = response_body(row)
    call(api, path + '/record', {**body,'happened_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()}, expected=422)
    call(api, path + '/record', {**body,'happened_at':datetime.now().isoformat()}, expected=422)
    tomorrow = (datetime.now(timezone(timedelta(hours=8)))+timedelta(days=1)).date().isoformat()
    future = save(api, 'one_off_reminder', key='future', body={**arrangement('one_off_reminder'),'service_date':tomorrow})
    call(api, ROOT + '/care-guidance/' + future['id'] + '/record', response_body(future), expected=409)
    next_day = datetime.now(timezone.utc)+timedelta(days=1)
    monkeypatch.setattr(service, 'now', lambda: next_day.isoformat())
    service.expire_due(api[1])
    expired = next(r for r in api[1].read()['care_guidance'] if r['id'] == row['id'])
    assert expired['status'] == 'expired' and expired['revision'] == 2
    call(api, path + '/record', {**body,'expected_revision':2}, expected=409)
    call(api, path + '/status', {'expected_revision':2,'status':'cancelled','reason':'过期'}, expected=409)
    target = ROOT + '/care-guidance/' + future['id']
    cancelled = call(api, target + '/status', {'expected_revision':1,'status':'cancelled','reason':'本人想休息'}, key='cancel')
    assert cancelled['status'] == 'cancelled'
    call(api, target + '/record', {**response_body(future),'expected_revision':2}, expected=409)


def test_cross_elder_admission_scope_family_and_revoked_access_are_denied(api):
    row = save(api, 'one_off_reminder')
    api[1].mutate(lambda d: d['elders'].append({'id':'E2','name':'另一位虚构老人','status':'active'}))
    call(api, '/api/v1/elders/E2/care-guidance/' + row['id'] + '/record', response_body(row), expected=404)
    call(api, ROOT + '/care-guidance', actor='family', method='get', expected=403)
    api[1].mutate(lambda d: d['care_assignments'].clear())
    call(api, ROOT + '/care-guidance', actor='staff', method='get', expected=403)
    call(api, ROOT + '/care-guidance/' + row['id'] + '/record', response_body(row), actor='staff', expected=403)
    api[1].mutate(lambda d: d['elders'][0].update(current_admission_id='readmitted'))
    assert call(api, ROOT + '/care-guidance', method='get')['items'] == []
    call(api, ROOT + '/care-guidance/' + row['id'] + '/record', response_body(row), expected=404)


def test_concurrent_confirm_and_response_replay_do_not_duplicate(api):
    body = arrangement('one_off_reminder')
    preview = call(api, ROOT + '/arrangement/preview', body)
    body['context_token'] = preview['context_token']
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _:call(api, ROOT + '/arrangement/confirm', body, key='concurrent'),range(2)))
    assert replies[0] == replies[1]
    row = replies[0]['guidance'][0]
    body = response_body(row)
    path = ROOT + '/care-guidance/' + row['id'] + '/record'
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _:call(api, path, body, key='concurrent-record'),range(2)))
    assert replies[0] == replies[1] and len(api[1].read()['care_records']) == 1
    call(api, path, {**body,'observation':'更改内容'}, key='concurrent-record', expected=409)


@pytest.mark.parametrize('kind', ['routine_hint','one_off_reminder'])
def test_advice_adoption_creates_guidance_and_preserves_source_rules(api, advice, kind):
    item = generate(api)['items'][0]
    line = arrangement(kind)['items'][0]
    body = {**line, 'condition':item['condition'], 'reason':'人工核对本次安排','expected_revision':item['revision']}
    if kind == 'one_off_reminder':
        body['service_date'] = service.today()
    path = ROOT + '/care-advice/' + item['id'] + '/adopt'
    result = call(api, path, body, actor='staff')
    assert result == call(api, path, body, actor='staff')
    assert result['status'] == 'adopted' and result['revision'] == 2 and result['task'] is None
    assert result['guidance']['content_type'] == result['content_type'] == kind
    assert result['guidance']['status'] == ('pending' if kind == 'routine_hint' else 'active')
    assert not api[1].read()['care_tasks']
    assert kind in call(api, ROOT + '/care-advice', actor='staff', method='get')['supported_content_types']
    assert kind in call(api, ROOT + '/arrangement', method='get')['supported_content_types']


def test_advice_rejects_mixed_fields_and_changed_evidence(api, advice):
    item = generate(api)['items'][0]
    body = {**arrangement()['items'][0], 'condition':item['condition'],'reason':'核对后采用','expected_revision':1}
    path = ROOT + '/care-advice/' + item['id'] + '/adopt'
    call(api, path, {**body,'task':{}}, expected=422)
    api[1].mutate(lambda d:d['care_records'][0].update(revision=2,observations=['更正来源']))
    call(api, path, body, expected=409)
    assert not api[1].read()['care_guidance']


def test_guidance_does_not_change_task_dashboard_or_worklist(api):
    initial = dashboard(api)
    save(api)
    save(api,'one_off_reminder',key='another')
    after = dashboard(api)
    assert initial['task_trend'] == after['task_trend']
    assert initial['details']['tasks'] == after['details']['tasks']
    assert call(api,'/api/v1/tasks',method='get') == []


def test_task_arrangement_accepts_explicit_frontend_content_types(api):
    from test_arrangements import prepare
    body = prepare(api)
    body['content_type'] = 'followup_task'
    body['items'][0]['content_type'] = 'followup_task'
    preview = call(api, ROOT+'/arrangement/preview',body)
    result = call(api, ROOT+'/arrangement/confirm',{**body,'context_token':preview['context_token']})
    assert result['created_tasks'] and result['plan']['content_type'] == 'followup_task'
    assert not api[1].read()['care_guidance']


def test_missing_key_invalid_scene_date_and_cross_type_items_fail_without_writes(api):
    for patch in ({'scene':'invalid'}, {'content_type':'one_off_reminder'}, {'times':['10:00']}):
        body = arrangement()
        body['items'][0].update(patch)
        call(api, ROOT+'/arrangement/preview',body,expected=422)
    for day in ('2026-02-30','2026-10-28T00:00:00Z',100,'2020-01-01'):
        call(api,ROOT+'/arrangement/preview',{**arrangement('one_off_reminder'),'service_date':day},expected=422)
    preview = call(api,ROOT+'/arrangement/preview',arrangement())
    call(api,ROOT+'/arrangement/confirm',{**arrangement(),'context_token':preview['context_token']},key=None,expected=422)
    assert not api[1].read()['care_guidance']


def test_response_disk_failure_rolls_back_record_guidance_and_replay(api, monkeypatch):
    from app.storage import json_store
    row = save(api,'one_off_reminder')
    before = api[1].path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setattr(json_store.os,'replace',lambda *_: (_ for _ in ()).throw(OSError('synthetic failure')))
        with pytest.raises(OSError):
            call(api,ROOT+'/care-guidance/'+row['id']+'/record',response_body(row))
    assert before == api[1].path.read_bytes()


def test_v9_migration_backs_up_and_preserves_accounts_tasks_records(tmp_path):
    data = copy.deepcopy(EMPTY_STORE)
    data.update(schema_version=9,users=[{'id':'test-account','password_hash':'synthetic'}],
                care_tasks=[{'id':'existing-task'}],care_records=[{'id':'existing-record'}])
    del data['care_guidance'], data['care_guidance_plans']
    store = JsonStore(tmp_path)
    tmp_path.mkdir(exist_ok=True)
    store.path.write_text(json.dumps(data),encoding='utf8')
    original = store.path.read_bytes()
    backup = store.migrate()
    assert backup.read_bytes() == original
    upgraded = store.read()
    assert upgraded['schema_version'] == 10
    assert upgraded['users'] == data['users'] and upgraded['care_tasks'] == data['care_tasks']
    assert upgraded['care_records'] == data['care_records']
    assert upgraded['care_guidance'] == upgraded['care_guidance_plans'] == []
    assert store.migrate() is None


def test_nurse_guidance_visibility_and_management_boundaries(api):
    from test_safety_roles import accounts
    accounts(api)
    enabled = save(api)
    reminder = save(api, 'one_off_reminder', key='nurse-reminder')
    hidden = save(api, key='nurse-hidden')
    path = ROOT + '/care-guidance/' + hidden['id'] + '/status'
    call(api, path, {'expected_revision': 1, 'status': 'disabled', 'reason': '待重新核实'}, key='disable-hidden')
    visible = call(api, ROOT + '/care-guidance', actor='nurse', method='get')['items']
    assert {row['id'] for row in visible} == {enabled['id'], reminder['id']}
    call(api, path, {'expected_revision': 2, 'status': 'enabled', 'reason': '申请启用'}, actor='nurse', expected=403)
    changed = call(api, ROOT + '/care-guidance/' + enabled['id'] + '/status',
                   {'expected_revision': 1, 'status': 'needs_adjustment', 'reason': '本人表示希望换个时间'},
                   actor='nurse', key='nurse-adjust')
    assert changed['status'] == 'needs_adjustment'
    result = call(api, ROOT + '/care-guidance/' + reminder['id'] + '/record',
                  response_body(reminder), actor='nurse', key='nurse-response')
    assert result['record']['created_by'] == 'nurse'
    assert result['created_tasks'] == []
