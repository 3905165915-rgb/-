from datetime import datetime,timedelta,timezone
from test_facility import ROOT,post
from test_planning import source,assessment_body,review_assessment,shift


def prepare(api):
    day=datetime.now(timezone(timedelta(hours=8))).date()
    assessment=review_assessment(api,post(api,'/assessments',assessment_body(source(api)),actor='staff'))
    current=shift(api,day)
    body={'title':'日常活动安排','goal':'尊重本人当次意愿','starts_on':str(day),'ends_on':str(day+timedelta(days=3)),
          'items':[{'key':'activity','title':'询问听戏意愿','scene':'activity','instruction':'询问并记录回应','times':['10:00']}],
          'service_date':str(day),'shift_id':current['id'],'assigned_to':'staff'}
    return body


def test_arrangement_preview_is_read_only_confirm_is_atomic_and_idempotent(api):
    body=prepare(api)
    client,store,headers=api
    before=store.path.read_bytes()
    preview=post(api,'/elders/E1/arrangement/preview',body,expected=200)
    assert store.path.read_bytes()==before
    assert preview['items']
    payload={**body,'context_token':preview['context_token']}
    saved=post(api,'/elders/E1/arrangement/confirm',payload,expected=200,key='arrangement')
    assert saved['plan']['status']=='active' and saved['created_tasks']
    assert post(api,'/elders/E1/arrangement/confirm',payload,expected=200,key='arrangement')==saved
    assert len(store.read()['care_plans'])==len(store.read()['care_tasks'])==1


def test_changed_context_or_invalid_staffing_cannot_partially_save(api):
    body=prepare(api)
    _,store,_=api
    preview=post(api,'/elders/E1/arrangement/preview',body,expected=200)
    store.mutate(lambda d:d['elders'][0].update(notes='新观察'))
    before=store.path.read_bytes()
    post(api,'/elders/E1/arrangement/confirm',{**body,'context_token':preview['context_token']},expected=409)
    assert before==store.path.read_bytes() and not store.read()['care_plans']
    post(api,'/elders/E1/arrangement/preview',{**body,'assigned_to':'manager'},expected=422)
    assert not store.read()['care_plans']
    post(api,'/elders/E1/arrangement/preview',body,actor='staff',expected=403)


def test_preview_reports_each_service_not_covered_by_selected_shift(api):
    body=prepare(api)
    body['items'][0]['times']=['10:00','22:00']
    api[1].mutate(lambda d: next(s for s in d['shifts'] if s['id']==body['shift_id']).update(end_at=body['service_date']+'T18:00:00+08:00'))
    preview=post(api,'/elders/E1/arrangement/preview',body,expected=200)
    assert len(preview['items']) == 1
    assert len(preview['unassigned_items']) == 1
    assert '尚未安排' in preview['unassigned_items'][0]['reason']
