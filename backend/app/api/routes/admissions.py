from fastapi import APIRouter

from app.api.deps import ManagementUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.facility import AdmissionAction
from app.services.facility_service import admission_action

router = APIRouter(prefix='/admissions', tags=['admissions'])


@router.post('/{admission_id}/actions')
def action(admission_id: str, payload: AdmissionAction, current: ManagementUser, store: Store,
           idempotency_key: IdempotencyKey = None):
    return admission_action(store, admission_id, payload, current['sub'], current['role'], idempotency_key)
