from typing import Literal

from fastapi import APIRouter, Query

from app.api.deps import ManagementUser, StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.facility import BedCreate, BedUpdate
from app.services import facility_service as service

router = APIRouter(prefix='/beds', tags=['beds'])


@router.get('')
def listing(_: StaffUser, store: Store, status: Literal['available', 'occupied', 'inactive', 'conflict'] | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.list_beds(store, status, limit, offset)


@router.post('', status_code=201)
def create(payload: BedCreate, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.create_bed(store, payload, current['sub'], current['role'], idempotency_key)


@router.patch('/{bed_id}')
def update(bed_id: str, payload: BedUpdate, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.update_bed(store, bed_id, payload, current['sub'], current['role'], idempotency_key)
