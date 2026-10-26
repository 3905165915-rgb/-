from fastapi import APIRouter

from app.api.deps import ManagementUser, StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.elder_workspace import AssessmentSave, AutomationRule, FollowupResolution, PlanAutomation, RecordSave, UnderstandingDecision
from app.services import elder_workspace_service as service

router = APIRouter(tags=['elder-workspace'])


@router.post('/elders/{elder_id}/assessment/save')
def save_assessment(elder_id: str, payload: AssessmentSave, current: StaffUser, store: Store,
                    idempotency_key: IdempotencyKey = None):
    return service.save_assessment(store, elder_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/elders/{elder_id}/record', status_code=201)
def save_record(elder_id: str, payload: RecordSave, current: StaffUser, store: Store,
                idempotency_key: IdempotencyKey = None):
    return service.save_record(store, elder_id, payload, current['sub'], current['role'], idempotency_key)


@router.get('/elders/{elder_id}/understanding')
def understanding(elder_id: str, current: StaffUser, store: Store):
    return service.understanding(store, elder_id, current['sub'], current['role'])


@router.post('/elders/{elder_id}/understanding/{report_id}/{point_id}/decision')
def decide(elder_id: str, report_id: str, point_id: str, payload: UnderstandingDecision,
           current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.decide(store, elder_id, report_id, point_id, payload,
                          current['sub'], current['role'], idempotency_key)


@router.get('/elders/{elder_id}/organising')
def jobs(elder_id: str, current: StaffUser, store: Store):
    return service.jobs(store, elder_id, current['sub'], current['role'])


@router.post('/elders/{elder_id}/organising/{job_id}/retry')
def retry(elder_id: str, job_id: str, current: StaffUser, store: Store):
    return service.retry_job(store, elder_id, job_id, current['sub'], current['role'])


@router.get('/elders/{elder_id}/automation')
def rule(elder_id: str, current: ManagementUser, store: Store):
    return service.get_rule(store, elder_id, current['sub'], current['role'])


@router.post('/elders/{elder_id}/organising/{job_id}/resolve-followups')
def resolve_followups(elder_id: str, job_id: str, payload: FollowupResolution,
                      current: ManagementUser, store: Store):
    return service.resolve_followups(store, elder_id, job_id, payload, current['sub'], current['role'])


@router.put('/elders/{elder_id}/automation')
def set_rule(elder_id: str, payload: AutomationRule, current: ManagementUser, store: Store):
    return service.set_rule(store, elder_id, payload, current['sub'], current['role'])


@router.get('/decisions/me')
def decisions(current: ManagementUser, store: Store):
    return service.decisions(store, current['sub'], current['role'])


@router.get('/elders/{elder_id}/plan-automation')
def plan_rules(elder_id: str, current: ManagementUser, store: Store):
    return service.plan_rules(store, elder_id, current['sub'], current['role'])


@router.put('/elders/{elder_id}/plan-automation')
def set_plan_rule(elder_id: str, payload: PlanAutomation, current: ManagementUser, store: Store):
    return service.set_plan_rule(store, elder_id, payload, current['sub'], current['role'])
