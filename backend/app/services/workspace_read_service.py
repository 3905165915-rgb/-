"""Bounded elder workspace assembled through existing authorized projections."""
from copy import deepcopy

from app.services import elder_workspace_service, care_scope_service, record_service, plan_service, followup_service
from app.services.workflow import now


def read(store, elder_id, user_id, role):
    data = store.read()
    elder = elder_workspace_service.access(data, elder_id, user_id, role)
    snapshot = elder_workspace_service.TransactionStore(deepcopy(data))
    admission_id = elder.get('current_admission_id')
    admission = next((a for a in data['admissions'] if a['id'] == admission_id and a['elder_id'] == elder_id
                      and a.get('status') in {'active', 'out'}), None)
    worklist = care_scope_service.worklist(snapshot, user_id, role)
    work = next((r for r in worklist['items'] if r['elder']['id'] == elder_id), {})
    records = record_service.record_list(snapshot, elder_id=elder_id, user_id=user_id, role=role,
                                        limit=len(data['care_records']) + 1)
    current_records = [r.model_dump() for r in records if admission and r.admission_id == admission_id]
    plans = plan_service.listing(snapshot, role, elder_id=elder_id, user_id=user_id)
    current_plans = [p for p in plans if admission and p.get('admission_id') == admission_id]
    return {'elder': {key: elder.get(key) for key in ('id', 'name', 'status', 'revision', 'current_admission_id')},
            'current_admission': {key: admission.get(key) for key in ('id', 'status', 'revision', 'bed_id')} if admission else None,
            'current_care_available': admission is not None,
            'context_notice': None if admission else '暂无有效入住；历史资料可回看，当前安排需先核实入住。',
            'tasks': work.get('open_tasks', []) if admission else [],
            'my_tasks': work.get('my_tasks', []) if admission else [],
            'current_shifts': worklist['current_shifts'] if admission else [],
            'plans': current_plans, 'recent_records': current_records[:10], 'record_total': len(current_records),
            'understanding': elder_workspace_service.understanding(snapshot, elder_id, user_id, role),
            'followups': followup_service.listing(snapshot, user_id, role, elder_id, limit=10),
            'timezone': 'Asia/Shanghai', 'as_of': now(), 'contract_version': 1}
