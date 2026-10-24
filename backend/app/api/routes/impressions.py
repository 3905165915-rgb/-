from typing import Annotated
from fastapi import APIRouter, HTTPException, Header

from app.api.deps import ManagementUser, StaffUser, Store
from app.schemas.impression import ImpressionReview, ImpressionMemoryRequest
from app.schemas.memory import MemoryResponse
from app.services import impression_service
from app.services.ai_service import AIProviderError

router = APIRouter(prefix='/elders/{elder_id}/impressions', tags=['elder-impressions'])
Key = Annotated[str | None, Header(alias='Idempotency-Key', min_length=1, max_length=128)]


@router.get('')
def listing(elder_id: str, current: StaffUser, store: Store):
    return impression_service.listing(store, elder_id, current['sub'], current['role'])


@router.post('/generate')
def generate(elder_id: str, current: StaffUser, store: Store):
    try:
        return impression_service.generate(store, elder_id, current['sub'], current['role'])
    except AIProviderError as exc:
        raise HTTPException(503, '老人印象整理暂不可用，原有记录不受影响，请稍后重试') from exc


@router.get('/{report_id}')
def detail(elder_id: str, report_id: str, current: StaffUser, store: Store):
    return impression_service.detail(store, elder_id, report_id, current['sub'], current['role'])


@router.post('/{report_id}/points/{point_id}/review')
def review(elder_id: str, report_id: str, point_id: str, payload: ImpressionReview,
           current: ManagementUser, store: Store):
    return impression_service.review(store, elder_id, report_id, point_id, payload, current['sub'], current['role'])


@router.post('/{report_id}/points/{point_id}/activate-memory', response_model=MemoryResponse)
def activate_memory(elder_id: str, report_id: str, point_id: str, payload: ImpressionMemoryRequest,
                    current: ManagementUser, store: Store, idempotency_key: Key = None):
    return impression_service.activate_memory(store, elder_id, report_id, point_id, payload,
                                             current['sub'], current['role'], idempotency_key)
