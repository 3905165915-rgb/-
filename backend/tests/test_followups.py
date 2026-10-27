from test_facility import ROOT


def test_followup_projection_counts_match_and_read_does_not_mutate(api):
    client,store,headers=api
    def seed(data):
        data['quality_checks']=[{'id':'QC1','scope':{'elder_id':'E1'},'issues':[
            {'id':'ISSUE1','title':'原文需核对','status':'pending_review','explanation':'人工复核依据'}]}]
    store.mutate(seed)
    before=store.path.read_bytes()
    response=client.get(ROOT+'/followups?elder_id=E1',headers=headers('manager'))
    assert response.status_code==200,response.text
    body=response.json()
    assert body['counts']=={'pending':0,'review':1,'closed':0}
    assert body['items'][0]['action_path']=='/quality/checks/{report_id}/issues/{issue_id}/resolve'
    assert body['items'][0]['next_action']=='核对记录问题'
    assert body['items'][0]['path']=='/quality/checks/QC1'
    assert body['items'][0]['reason']=='人工复核依据'
    assert body['items'][0]['context']['report_id']=='QC1'
    assert body['items'][0]['elder_id']=='E1'
    assert store.path.read_bytes()==before


def test_caregiver_followups_exclude_out_of_scope_quality_and_decisions(api):
    client,store,headers=api
    store.mutate(lambda data: data.update(care_assignments=[]))
    response=client.get(ROOT+'/followups',headers=headers('staff'))
    assert response.status_code==200,response.text
    assert response.json()['items']==[]
