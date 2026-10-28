"""Read-only follow-up projection. Original state machines remain authoritative."""
from copy import deepcopy
from app.services.workflow import current_staff, now
from app.services import incident_service, change_review_service, elder_workspace_service
from app.services.care_scope_service import elder_ids


def listing(store, user_id, role, elder_id=None):
    data=store.read()
    current_staff(data,user_id,role)
    scope=elder_ids(data,user_id,role)
    names={e['id']:e['name'] for e in data['elders']}
    people={u['id']:u.get('display_name','工作人员') for u in data['users']}
    items=[]
    def add(kind,row,title,status,group,path,owner=None,reason=None):
        eid=row.get('elder_id')
        if elder_id and eid != elder_id or role=='caregiver' and eid not in scope:
            return
        state='closed' if status in {'closed','reviewed','resolved','dismissed','rejected','confirmed','acknowledged','not_applicable'} else 'review' if status in {'awaiting_review','pending_review'} else 'pending'
        items.append(dict(id=kind+':'+row['id'],object_id=row['id'],kind=kind,group=group,elder_id=eid,
            elder_name=names.get(eid,'机构事项'),title=title,status=status,state=state,
            assigned_to=owner,owner_name=people.get(owner,'待主管安排'),due_at=row.get('due_at'),
            next_action='查看处理结果' if state=='closed' else '核对并复查' if state=='review' else '查看并办理',
            path=path,context={k:v for k,v in row.items() if k in {'task_id','memory_id','report_id','section'}},
            reason=reason,allowed_actions=['view'], action_path=None))
    # Existing per-module access checks are reused, against the same snapshot.
    nested=elder_workspace_service.TransactionStore(deepcopy(data))
    for incident in incident_service.listing(nested,user_id,role,elder_id,limit=100000):
        rect=incident.get('rectification') or {}
        add('incident',incident,incident.get('description') or '照护安全事项',
            'awaiting_review' if rect.get('status')=='awaiting_review' else incident['status'],
            'incidents','/incidents/'+incident['id'],rect.get('assigned_to'))
        if items and items[-1]['object_id'] == incident['id']:
            card=items[-1]
            card['due_at'] = rect.get('due_at')
            card['context'].update(incident_id=incident['id'],rectification_id=rect.get('id'))
            action=None
            if incident['status']!='closed':
                if rect.get('status')=='awaiting_review' and role in {'admin','supervisor'}:
                    submission=(rect.get('submissions') or [{}])[-1]
                    if submission.get('by')!=user_id:
                        action='/rectifications/{rectification_id}/review'
                elif rect.get('status')=='assigned' and rect.get('assigned_to')==user_id:
                    action='/rectifications/{rectification_id}/submit'
                elif role in {'admin','supervisor'}:
                    action='/incidents/{incident_id}/triage'
            card['action_path']=action
            card['allowed_actions']=['view',action] if action else ['view']
    for row in change_review_service.listing(nested,user_id,role,elder_id=elder_id,limit=100000):
        add('change',row,'个性化照护依据变化待核验',row['status'],'changes','/change-reviews/'+row['id'],row.get('assigned_to'))
        if items and items[-1]['object_id']==row['id']:
            card=items[-1]
            action=None
            if row['status']=='awaiting_review' and role in {'admin','supervisor'}:
                if (row.get('submissions') or [{}])[-1].get('submitted_by')!=user_id:
                    action='/change-reviews/{case_id}/review'
            elif row['status']=='assigned' and row.get('assigned_to')==user_id:
                action='/change-reviews/{case_id}/submit'
            elif row['status']!='closed' and role in {'admin','supervisor'}:
                action='/change-reviews/{case_id}/assign'
            card['action_path']=action
            card['allowed_actions']=['view',action] if action else ['view']
    if role in {'admin','supervisor'}:
        for report in data['quality_checks']:
            for issue in report['issues']:
                row={**issue,'elder_id':issue.get('elder_id') or report.get('scope',{}).get('elder_id'),'report_id':report['id']}
                add('quality',row,issue.get('title') or issue.get('message') or '照护记录待核对',issue['status'],
                    'quality','/quality/checks/'+report['id'],reason=issue.get('explanation'))
                if items and items[-1]['object_id']==issue['id'] and issue['status']=='pending_review':
                    items[-1]['action_path']='/quality/checks/{report_id}/issues/{issue_id}/resolve'
                    items[-1]['allowed_actions'].append(items[-1]['action_path'])
        for decision in elder_workspace_service.decisions(nested,user_id,role)['items']:
            if elder_id and decision['elder_id'] != elder_id:
                continue
            row={**decision,'id':decision['object_id']}
            row['section'] = {
                'assessment': 'assessment', 'plan': 'assessment', 'task': 'today',
                'care_advice': 'today', 'organising': 'records', 'followup': 'records',
            }.get(decision['kind'], 'understanding')
            add('decision',row,decision['reason'],'pending','elder',decision['path'])
    action_labels={
        '/incidents/{incident_id}/triage':'安排整改',
        '/rectifications/{rectification_id}/submit':'提交整改结果',
        '/rectifications/{rectification_id}/review':'复查整改',
        '/change-reviews/{case_id}/assign':'安排核验',
        '/change-reviews/{case_id}/submit':'提交核验结果',
        '/change-reviews/{case_id}/review':'复查核验',
        '/quality/checks/{report_id}/issues/{issue_id}/resolve':'核对记录问题',
    }
    for card in items:
        if card['group']!='elder':
            card['next_action']=action_labels.get(card.get('action_path'),'查看处理结果' if card['state']=='closed' else '查看当前进展')
    return {'items':items,'counts':{s:sum(r['state']==s for r in items) for s in ('pending','review','closed')},
            'as_of':now(),'notice':'待核对不等于漏护；查看不会自动生成、处理或关闭事项。'}


def check_today(store, elder_id, user_id, role, key=None, kinds=None):
    """Independent checks use isolated copies; no workflow is implicitly resolved."""
    from datetime import timedelta, timezone
    from app.services import quality_service, insight_service
    from app.schemas.api import QualityScanRequest
    from app.services.workflow import audit, identifier, parse_time, replayable
    kinds = list(dict.fromkeys(kinds or ['quality', 'coverage']))
    def commit(data):
        elder_workspace_service.access(data, elder_id, user_id, role, management=True)
        def operation():
            day = parse_time(now()).astimezone(timezone(timedelta(hours=8))).date()
            results = []
            for kind in kinds:
                staged = deepcopy(data)
                nested = elder_workspace_service.TransactionStore(staged)
                try:
                    if kind == 'quality':
                        result = quality_service.scan(nested, QualityScanRequest(elder_id=elder_id, include_ai=False), user_id)
                        detail = {'report_id': result['id'], 'issue_count': len(result['issues'])}
                    else:
                        result = insight_service.coverage(nested, elder_id, day, user_id, role)
                        detail = {'service_date': str(day), 'items': result['items']}
                    data.clear(); data.update(staged)
                    results.append({'kind':kind, 'status':'completed', 'result':detail})
                except Exception:
                    results.append({'kind':kind, 'status':'failed', 'message':'本项检查未完成，请单独重试；其他检查结果已保留。'})
            result = {'id':identifier('CHECK'), 'elder_id':elder_id, 'as_of':now(), 'checks':results}
            audit(data, 'check_today_care', result['id'], user_id, elder_id=elder_id, result=deepcopy(result))
            return result
        return replayable(data, user_id, 'check_today_care', key, {'elder_id':elder_id, 'kinds':kinds}, operation)
    return store.mutate(commit)
