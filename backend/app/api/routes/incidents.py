from typing import Annotated

from fastapi import APIRouter, Header, Query, HTTPException
from app.api.deps import IncidentReporter, ManagementUser, StaffUser, Store
from app.schemas import incident as schema
from app.services import incident_service as service

router = APIRouter(tags=['incidents'])
Key = Annotated[str | None, Header(alias='Idempotency-Key', min_length=1, max_length=200)]


@router.post('/incidents/prepare')
def prepare(payload: schema.IncidentPrepare, current: IncidentReporter, store: Store):
    from app.services.ai_service import AIProviderError
    from pydantic import ValidationError
    try:
        return service.prepare(store, payload, current['sub'], current['role'])
    except (AIProviderError, ValidationError) as exc:
        raise HTTPException(503, '辅助整理暂不可用，请直接人工上报，不必等待') from exc


@router.get('/incidents')
def listing(current: StaffUser, store: Store, elder_id: str | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.listing(store, current['sub'], current['role'], elder_id, limit, offset)


@router.get('/incidents/{incident_id}')
def get(incident_id: str, current: StaffUser, store: Store):
    return service.get(store, incident_id, current['sub'], current['role'])


@router.post('/incidents', status_code=201)
def create(payload: schema.IncidentCreate, current: IncidentReporter, store: Store, idempotency_key: Key = None):
    return service.create(store, payload, current['sub'], current['role'], idempotency_key)


@router.post('/incidents/{incident_id}/triage')
def triage(incident_id: str, payload: schema.IncidentTriage, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.triage(store, incident_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/rectifications/{rectification_id}/assign')
def assign(rectification_id: str, payload: schema.RectificationAssign, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.assign(store, rectification_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/rectifications/{rectification_id}/submit')
def submit(rectification_id: str, payload: schema.RectificationSubmit, current: StaffUser, store: Store, idempotency_key: Key = None):
    return service.submit(store, rectification_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/rectifications/{rectification_id}/review')
def review(rectification_id: str, payload: schema.RectificationReview, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.review(store, rectification_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/incidents/{incident_id}/reopen')
def reopen(incident_id: str, payload: schema.IncidentReopen, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.reopen(store, incident_id, payload, current['sub'], current['role'], idempotency_key)
