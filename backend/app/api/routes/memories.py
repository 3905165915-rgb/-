from typing import Annotated

from fastapi import APIRouter, Header, Query

from app.api.deps import ManagementUser, StaffUser, Store
from app.schemas.memory import (
    MemoryContextResponse, MemoryCreateRequest, MemoryResponse, MemoryReviewRequest,
    MemoryRevisionRequest, MemoryScene, MemoryStatus, MemoryFromDraftRequest,
)
from app.services import memory_service


router = APIRouter(prefix='/memories', tags=['care-memories'])
IdempotencyKey = Annotated[str | None, Header(min_length=1, max_length=128)]


@router.post('', response_model=MemoryResponse, status_code=201)
def create(payload: MemoryCreateRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return memory_service.create(store, payload, current['sub'], current['role'], idempotency_key)


@router.get('', response_model=list[MemoryResponse])
def listing(elder_id: str, _: StaffUser, store: Store, status: MemoryStatus | None = None,
            scene: MemoryScene | None = None, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return memory_service.listing(store, elder_id, status, scene, limit, offset)


@router.get('/context', response_model=MemoryContextResponse)
def context(elder_id: str, scene: MemoryScene, _: StaffUser, store: Store):
    return memory_service.context(store, elder_id, scene)


@router.get('/{memory_id}', response_model=MemoryResponse)
def detail(memory_id: str, _: StaffUser, store: Store):
    return memory_service.detail(store, memory_id)


@router.post('/from-draft', response_model=MemoryResponse, status_code=201)
def from_draft(payload: MemoryFromDraftRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return memory_service.create_from_draft(store, payload, current['sub'], current['role'], idempotency_key)


@router.get('/{memory_id}/history')
def history(memory_id: str, _: StaffUser, store: Store, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return memory_service.history(store, memory_id, limit, offset)


@router.post('/{memory_id}/revisions', response_model=MemoryResponse)
def revise(memory_id: str, payload: MemoryRevisionRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return memory_service.revise(store, memory_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{memory_id}/review', response_model=MemoryResponse)
def review(memory_id: str, payload: MemoryReviewRequest, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return memory_service.review(store, memory_id, payload, current['sub'], current['role'], idempotency_key)
