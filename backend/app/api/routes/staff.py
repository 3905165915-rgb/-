from fastapi import APIRouter, Query
from app.api.deps import ManagementUser, Store
from app.schemas.facility import StaffCreate, StaffUpdate, StaffPasswordReset
from app.services import staff_service

router = APIRouter(prefix='/staff', tags=['staff'])


@router.get('')
def listing(_: ManagementUser, store: Store, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    """Minimal safe lookup for shift members and task assignees; no credentials."""
    return [{'id': row['id'], 'display_name': row['display_name'], 'role': row['role']}
            for row in store.read()['users']
            if row.get('active', True) and row['role'] in {'admin', 'supervisor', 'caregiver'}][offset:offset+limit]


@router.get('/directory')
def directory(_: ManagementUser, store: Store, active: bool | None = None,
              limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return staff_service.directory(store, active, limit, offset)


@router.get('/{staff_id}/workload')
def workload(staff_id: str, _: ManagementUser, store: Store):
    return staff_service.workload(store, staff_id)


@router.post('', status_code=201)
def create(payload: StaffCreate, current: ManagementUser, store: Store):
    return staff_service.create(store, payload, current['sub'], current['role'])


@router.patch('/{staff_id}')
def update(staff_id: str, payload: StaffUpdate, current: ManagementUser, store: Store):
    return staff_service.update(store, staff_id, payload, current['sub'], current['role'])


@router.post('/{staff_id}/reset-password')
def reset_password(staff_id: str, payload: StaffPasswordReset, current: ManagementUser, store: Store):
    return staff_service.reset_password(store, staff_id, payload, current['sub'], current['role'])
