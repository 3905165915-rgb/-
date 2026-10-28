from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import StaffUser, ManagementUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.facility import ElderCreate, ElderUpdate, AdmissionCreate
from app.services import facility_service
from app.schemas.api import Elder
from app.services.store_service import get_elder, list_elders
from app.services import care_scope_service
from app.services import timeline_service
from app.schemas.care_scope import CareAssignment, RevokeAssignment


router = APIRouter(prefix="/elders", tags=["elders"])


@router.get("", response_model=list[Elder])
def elders(current: StaffUser, store: Store) -> list[Elder]:
    data = store.read()
    scope = care_scope_service.elder_ids(data, current['sub'], current['role']) if current['role'] in {'caregiver', 'nurse'} else None
    from app.services.presentation_service import bed_label
    return [Elder.model_validate({**row, 'bed_label': bed_label(data, row.get('bed_id'))})
            for row in data['elders'] if scope is None or row['id'] in scope]


@router.get('/worklist/me')
def current_worklist(current: StaffUser, store: Store):
    """Current task/shift scope for the caregiver workbench."""
    return care_scope_service.worklist(store, current['sub'], current['role'])


@router.get('/{elder_id}/timeline')
def elder_timeline(elder_id: str, current: StaffUser, store: Store,
                   event_type: list[str] = Query(default=[]),
                   start: datetime | None = None, end: datetime | None = None,
                   limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0)):
    return timeline_service.elder_timeline(store, elder_id, current['sub'], current['role'],
                                           limit, offset, event_type, start, end)


@router.post('/work-assignments', status_code=201)
def assign_care(payload: CareAssignment, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return care_scope_service.assign(store, payload, current['sub'], current['role'], idempotency_key)


@router.get('/work-assignments')
def care_assignments(current: ManagementUser, store: Store, elder_id: str | None = None,
                     caregiver_id: str | None = None,
                     status: Literal['active', 'scheduled', 'expired', 'revoked'] | None = None,
                     limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return care_scope_service.assignments(store, current['sub'], current['role'], elder_id,
                                          caregiver_id, status, limit, offset)


@router.get('/work-assignments/{assignment_id}')
def care_assignment(assignment_id: str, current: ManagementUser, store: Store):
    return care_scope_service.assignment_detail(store, assignment_id, current['sub'], current['role'])


@router.post('/work-assignments/{assignment_id}/revoke')
def revoke_care(assignment_id: str, payload: RevokeAssignment, current: ManagementUser, store: Store,
                idempotency_key: IdempotencyKey = None):
    return care_scope_service.revoke(store, assignment_id, payload, current['sub'], current['role'], idempotency_key)


@router.get('/{elder_id}', response_model=Elder)
def elder(elder_id: str, current: StaffUser, store: Store) -> Elder:
    care_scope_service.require_elder_access(store.read(), elder_id, current['sub'], current['role'])
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
