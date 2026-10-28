from datetime import datetime, timedelta, timezone
import pytest
from app.services.elder_workspace_service import time_proposal
from app.services.workflow import DomainError
from app.storage.request_context import expected_demo_batch
from test_facility import ROOT, post
from test_arrangements import prepare


def test_beijing_nine_pm_and_relative_day_use_occurrence_not_entry():
    record = {'happened_at':'2026-10-26T16:30:00Z', 'created_at':'2026-10-29T12:00:00Z'}
    result = time_proposal('明天晚上九点询问活动意愿', record)
    assert result['suggested_at'] == '2026-10-28T21:00:00+08:00'
    assert result['semantics'] == 'service_time'
    assert time_proposal('2026-10-28晚上九点前完成询问', record)['semantics'] == 'deadline'
    assert time_proposal('明天再看看', record)['suggested_at'] is None
    assert time_proposal('明天三点或者四点询问', record)['missing']
    assert time_proposal('明天上午十三点询问', record)['suggested_at'] is None
    assert time_proposal('明天晚上十二点询问', record)['suggested_at'] is None


def test_arrangement_cannot_change_body_after_preview(api):
    body=prepare(api)
    preview=post(api,'/elders/E1/arrangement/preview',body,expected=200)
    body['items'][0]['title']='预览后被替换的安排'
    before=api[1].path.read_bytes()
    post(api,'/elders/E1/arrangement/confirm',{**body,'context_token':preview['context_token']},expected=409)
    assert before == api[1].path.read_bytes()


def test_reset_during_request_cannot_commit_previous_batch(api):
    store=api[1]
    store.mutate(lambda d:d.update(demo_batch_id='new'))
    token=expected_demo_batch.set('old')
    try:
        with pytest.raises(DomainError,match='demo_batch_changed'):
            store.mutate(lambda d:d['elders'].clear())
    finally:
        expected_demo_batch.reset(token)
    assert store.read()['elders']


def test_today_checks_keep_success_when_another_check_fails(api,monkeypatch):
    from app.services import insight_service
    def fail(*args,**kwargs): raise DomainError('synthetic_check_failure')
    monkeypatch.setattr(insight_service,'coverage',fail)
    result=post(api,'/elders/E1/followups/check-today',{},actor='manager',expected=200,key='today-check')
    assert [r['status'] for r in result['checks']] == ['completed','failed']
    assert len(api[1].read()['quality_checks']) == 1
    assert post(api,'/elders/E1/followups/check-today',{},actor='manager',expected=200,key='today-check') == result
    assert len(api[1].read()['quality_checks']) == 1
    retry=post(api,'/elders/E1/followups/check-today',{'kinds':['coverage']},actor='manager',expected=200,key='coverage-retry')
    assert [r['kind'] for r in retry['checks']] == ['coverage']
    assert len(api[1].read()['quality_checks']) == 1
    post(api,'/elders/E1/followups/check-today',{'kinds':['invalid']},actor='manager',expected=422)
    post(api,'/elders/E1/followups/check-today',{},actor='staff',expected=403)


def test_service_time_and_deadline_are_independent_and_adjustments_need_reason(api):
    from test_planning import shift
    day=(datetime.now(timezone(timedelta(hours=8)))+timedelta(days=1)).date()
    assigned=shift(api,day)
    result=post(api,'/elders/E1/record',{'text':'请联系家属反馈情况','shift_id':assigned['id']},actor='staff')
    suggestion=result['analysis']['task_suggestions'][0]
    scheduled=f'{day}T11:00:00+08:00'
    api[1].mutate(lambda d:d['record_analyses'][-1]['task_suggestions'][0].update(time_proposal={
        'original_expression':'明天上午十一点联系家属','suggested_at':scheduled,'semantics':'service_time'}))
    endpoint=f'/elders/E1/records/{result["record"]["id"]}/analysis/{result["analysis"]["id"]}/confirm'
    body={'expected_revision':1,'accepted_tasks':[{'suggestion_id':suggestion['id'],'title':'联系家属反馈情况',
        'shift_id':assigned['id'],'assigned_to':'staff','due_at':f'{day}T12:00:00+08:00',
        'scheduled_at':f'{day}T11:30:00+08:00','completion_criteria':'记录实际回应'}]}
    before=api[1].path.read_bytes()
    post(api,endpoint,body,actor='staff',expected=422)
    assert api[1].path.read_bytes()==before
    body['accepted_tasks'][0]['scheduled_at']=scheduled
    saved=post(api,endpoint,body,actor='staff',expected=200)
    task=saved['tasks'][0]
    assert task['scheduled_at']==scheduled
    assert task['time_confirmation']['final_due_at']==f'{day}T12:00:00+08:00'
