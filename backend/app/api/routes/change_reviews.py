from fastapi import APIRouter, Query

from app.api.deps import ManagementUser, StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.change_review import (
    ChangeAssignRequest, ChangeReviewRequest, ChangeReviewResponse, ChangeScanRequest,
    ChangeScanResponse, ChangeSubmitRequest, ReviewStatus,
)
from app.services import change_review_service as service


router = APIRouter(prefix='/change-reviews', tags=['change-reviews'])


@router.get('', response_model=list[ChangeReviewResponse])
def listing(current: StaffUser, store: Store, status: ReviewStatus | None = None, elder_id: str | None = None,
            task_id: str | None = None, assigned_to: str | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.listing(store, current['sub'], current['role'], status, elder_id, task_id, assigned_to, limit, offset)


@router.post('/scan', response_model=ChangeScanResponse)
def scan(payload: ChangeScanRequest, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.scan(store, payload, current['sub'], current['role'], idempotency_key)


@router.get('/{case_id}', response_model=ChangeReviewResponse)
def detail(case_id: str, current: StaffUser, store: Store):
    return service.get(store, case_id, current['sub'], current['role'])


@router.post('/{case_id}/assign', response_model=ChangeReviewResponse)
def assign(case_id: str, payload: ChangeAssignRequest, current: ManagementUser, store: Store,
           idempotency_key: IdempotencyKey = None):
    return service.assign(store, case_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{case_id}/submit', response_model=ChangeReviewResponse)
def submit(case_id: str, payload: ChangeSubmitRequest, current: StaffUser, store: Store,
           idempotency_key: IdempotencyKey = None):
    return service.submit(store, case_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{case_id}/review', response_model=ChangeReviewResponse)
def review(case_id: str, payload: ChangeReviewRequest, current: ManagementUser, store: Store,
           idempotency_key: IdempotencyKey = None):
    return service.review(store, case_id, payload, current['sub'], current['role'], idempotency_key)
