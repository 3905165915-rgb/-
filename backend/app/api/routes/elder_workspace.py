from fastapi import APIRouter

from app.api.deps import ManagementUser, StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.elder_workspace import (AssessmentSave, AutomationRule, FollowupResolution,
    PlanAutomation, TodayCheckRequest, RecordSave, RecordAnalysisConfirm, UnderstandingDecision)
from app.services import elder_workspace_service as service

router = APIRouter(tags=['elder-workspace'])


@router.get('/followups')
def followups(current: StaffUser, store: Store, elder_id: str | None = None):
    from app.services.followup_service import listing
    return listing(store, current['sub'], current['role'], elder_id)


@router.post('/elders/{elder_id}/followups/check-today')
def check_today(elder_id: str, current: ManagementUser, store: Store, payload: TodayCheckRequest | None = None, idempotency_key: IdempotencyKey = None):
    from app.services.followup_service import check_today
    return check_today(store, elder_id, current['sub'], current['role'], idempotency_key, payload.kinds if payload else None)


@router.get('/elders/{elder_id}/arrangement')
def arrangement_context(elder_id: str, current: ManagementUser, store: Store):
    from app.services.arrangement_service import context
    return context(store, elder_id, current['sub'], current['role'])


from app.schemas.elder_workspace import Arrangement


@router.post('/elders/{elder_id}/arrangement/preview')
def arrangement_preview(elder_id: str, payload: Arrangement, current: ManagementUser, store: Store):
    from app.services.arrangement_service import preview
    return preview(store, elder_id, payload, current['sub'], current['role'])


@router.post('/elders/{elder_id}/arrangement/confirm')
def arrangement_confirm(elder_id: str, payload: Arrangement, current: ManagementUser, store: Store,
                        idempotency_key: IdempotencyKey = None):
    from app.services.arrangement_service import confirm
    return confirm(store, elder_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/elders/{elder_id}/assessment/save')
def save_assessment(elder_id: str, payload: AssessmentSave, current: StaffUser, store: Store,
                    idempotency_key: IdempotencyKey = None):
    return service.save_assessment(store, elder_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/elders/{elder_id}/record', status_code=201)
def save_record(elder_id: str, payload: RecordSave, current: StaffUser, store: Store,
                idempotency_key: IdempotencyKey = None):
    return service.save_record(store, elder_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/elders/{elder_id}/records/{record_id}/analyze')
def analyze_record(elder_id: str, record_id: str, current: StaffUser, store: Store, background: bool = False):
    if background:
        from app.services.record_job_service import retry
        return retry(store, elder_id, record_id, current['sub'], current['role'])
    return service.retry_record_analysis(store, elder_id, record_id, current['sub'], current['role'])


@router.get('/elders/{elder_id}/records/{record_id}/analysis')
def record_analysis_status(elder_id: str, record_id: str, current: StaffUser, store: Store):
    from app.services.record_job_service import status
    return status(store, elder_id, record_id, current['sub'], current['role'])


@router.post('/elders/{elder_id}/records/{record_id}/analysis/{analysis_id}/confirm')
def confirm_record_analysis(elder_id: str, record_id: str, analysis_id: str,
                            payload: RecordAnalysisConfirm, current: StaffUser, store: Store,
                            idempotency_key: IdempotencyKey = None):
    return service.confirm_record_analysis(store, elder_id, record_id, analysis_id, payload,
                                           current['sub'], current['role'], idempotency_key)


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
