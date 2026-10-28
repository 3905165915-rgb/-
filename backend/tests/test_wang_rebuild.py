import importlib.util
from pathlib import Path
from datetime import datetime, timedelta, timezone
from app.services import dashboard_service

spec=importlib.util.spec_from_file_location('reset_wang',Path(__file__).parents[1]/'scripts/reset_wang_demo.py')
resetter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(resetter)


def test_rebuild_preserves_all_credentials_cleans_old_data_and_validates_chains(api):
    client,store,headers=api
    original=store.read()
    result=resetter.reset(store)
    data=store.read()
    assert Path(result['backup']).is_file()
    assert [e['name'] for e in data['elders']]==['王爷爷']
    assert len(data['care_records'])==40
    assert {u['id']:u['password_hash'] for u in data['users']}=={u['id']:u['password_hash'] for u in original['users']}
    assert all(u['token_version']==1 for u in data['users'])
    assert data['record_analyses']==data['care_jobs']==data['attachments']==[]
    eid=data['elders'][0]['id']
    for collection in ('care_records','care_tasks','care_memories','care_plans','assessments'):
        assert all(r['elder_id']==eid for r in data[collection])
    day=datetime.now(timezone(timedelta(hours=8))).date()
    report=dashboard_service.dashboard(store,day-timedelta(days=6),day,'manager','supervisor')
    assert report
    from app.api.routes.elders import elders
    assert elders({'sub':'manager','role':'supervisor'},store)[0].bed_label == '101房·1床'


def test_old_batch_rejected_before_mutation(api):
    client,store,headers=api
    store.mutate(lambda d:d.update(demo_batch_id='new-batch'))
    before=store.path.read_bytes()
    response=client.post('/api/v1/elders/E1/record',json={'text':'旧页面提交'},headers={**headers(),'X-Demo-Batch':'old-batch'})
    assert response.status_code==409 and response.json()['detail']=='demo_batch_changed'
    assert store.path.read_bytes()==before
