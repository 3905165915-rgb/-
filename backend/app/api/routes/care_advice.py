from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import ManagementUser, StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.care_advice import AdviceGenerate, AdviceAdopt, AdviceReject, AdviceFeedback, AdviceReview
from app.schemas.memory import MemoryScene
from app.services import care_advice_service as service
from app.services.ai_service import AIProviderError

router = APIRouter(prefix='/elders/{elder_id}/care-advice', tags=['care-advice'])


@router.post('/generate')
def generate(elder_id: str, payload: AdviceGenerate, current: StaffUser, store: Store):
    try:
        return service.generate(store, elder_id, payload, current['sub'], current['role'])
    except AIProviderError as exc:
        raise HTTPException(503, '照护建议暂时无法整理，已有记录不受影响，请稍后重试或手工安排') from exc


@router.get('')
def listing(elder_id: str, current: StaffUser, store: Store, scene: MemoryScene | None = None,
            status: Literal['proposed', 'adopted', 'rejected'] | None = None,
            limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    return service.listing(store, elder_id, current['sub'], current['role'], scene, status, limit, offset)


@router.get('/{advice_id}')
def detail(elder_id: str, advice_id: str, current: StaffUser, store: Store):
    return service.detail(store, elder_id, advice_id, current['sub'], current['role'])


@router.post('/{advice_id}/adopt')
def adopt(elder_id: str, advice_id: str, payload: AdviceAdopt,
          current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.adopt(store, elder_id, advice_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{advice_id}/reject')
def reject(elder_id: str, advice_id: str, payload: AdviceReject,
           current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.reject(store, elder_id, advice_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{advice_id}/feedback')
def feedback(elder_id: str, advice_id: str, payload: AdviceFeedback,
             current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.feedback(store, elder_id, advice_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{advice_id}/review')
def review(elder_id: str, advice_id: str, payload: AdviceReview,
           current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.review(store, elder_id, advice_id, payload, current['sub'], current['role'], idempotency_key)
