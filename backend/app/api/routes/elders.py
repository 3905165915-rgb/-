from fastapi import APIRouter, HTTPException, Query

from app.api.deps import StaffUser, ManagementUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.facility import ElderCreate, ElderUpdate, AdmissionCreate
from app.services import facility_service
from app.schemas.api import Elder
from app.services.store_service import get_elder, list_elders


router = APIRouter(prefix="/elders", tags=["elders"])


@router.get("", response_model=list[Elder])
def elders(_: StaffUser, store: Store) -> list[Elder]:
    return list_elders(store)


@router.get("/{elder_id}", response_model=Elder)
def elder(elder_id: str, _: StaffUser, store: Store) -> Elder:
    item = get_elder(store, elder_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    return item


@router.post('', response_model=Elder, status_code=201)
def create(payload: ElderCreate, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return facility_service.create_elder(store, payload, current['sub'], current['role'], idempotency_key)


@router.patch('/{elder_id}', response_model=Elder)
def update(elder_id: str, payload: ElderUpdate, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return facility_service.update_elder(store, elder_id, payload, current['sub'], current['role'], idempotency_key)


@router.get('/{elder_id}/admissions')
def history(elder_id: str, _: ManagementUser, store: Store,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return facility_service.admission_history(store, elder_id, limit, offset)


@router.post('/{elder_id}/admissions', status_code=201)
def admit(elder_id: str, payload: AdmissionCreate, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return facility_service.admit(store, elder_id, payload, current['sub'], current['role'], idempotency_key)
