from fastapi import APIRouter

from app.api.deps import StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.care_guidance import GuidanceRecord, GuidanceStatus
from app.services import care_guidance_service as service

router = APIRouter(prefix='/elders/{elder_id}/care-guidance', tags=['care-guidance'])


@router.get('')
def listing(elder_id: str, current: StaffUser, store: Store):
    return service.listing(store, elder_id, current['sub'], current['role'])


@router.post('/{guidance_id}/status')
def status(elder_id: str, guidance_id: str, payload: GuidanceStatus,
           current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.status(store, elder_id, guidance_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{guidance_id}/record')
def record(elder_id: str, guidance_id: str, payload: GuidanceRecord,
           current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.record(store, elder_id, guidance_id, payload, current['sub'], current['role'], idempotency_key)
