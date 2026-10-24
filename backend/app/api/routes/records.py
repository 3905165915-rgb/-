from typing import Annotated, Literal
from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import JSONResponse

from app.api.deps import ManagementUser, StaffUser, Store
from app.schemas.api import AIDraft, CareRecord, RecordConfirmRequest, RecordExtractRequest, ManualRecordRequest, CorrectRecordRequest, RejectDraftRequest
from app.services.ai_service import AIProviderError
from app.services.store_service import create_draft, get_elder
from app.services import record_service
from app.services.workflow import open_shift
from app.schemas.assistant import ContextExtractRequest
from app.services import assistant_service
from app.schemas.api import VerifiedCorrectionRequest, RecordImpactReviewRequest, DraftUpdateRequest
from app.services import record_impact_service
from app.schemas.memory import MemoryScene
from app.services.facility_service import care_eligible, care_state


router = APIRouter(prefix="/records", tags=["records"])
IdempotencyKey = Annotated[str | None, Header(min_length=1, max_length=128)]


@router.get('', response_model=list[CareRecord])
def records(_: StaffUser, store: Store, elder_id: str | None = None, shift_id: str | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return record_service.record_list(store, elder_id, shift_id, limit, offset)


@router.get('/drafts', response_model=list[AIDraft])
def drafts(current: StaffUser, store: Store, elder_id: str | None = None,
           status: Literal['pending_review', 'confirmed', 'rejected', 'failed'] | None = None,
           limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return record_service.draft_list(store, current['sub'], current['role'], elder_id, status, limit, offset)


@router.get('/drafts/{draft_id}', response_model=AIDraft)
def draft(draft_id: str, current: StaffUser, store: Store):
    return record_service.draft_detail(store, draft_id, current['sub'], current['role'])


@router.post('/drafts/{draft_id}/reject', response_model=AIDraft)
def reject(draft_id: str, payload: RejectDraftRequest, current: StaffUser, store: Store):
    return record_service.reject(store, draft_id, current['sub'], current['role'], payload.reason, payload.expected_revision)


@router.patch('/drafts/{draft_id}', response_model=AIDraft)
def edit_draft(draft_id: str, payload: DraftUpdateRequest, current: StaffUser, store: Store,
               idempotency_key: IdempotencyKey = None):
    return record_service.update_draft(store, draft_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/manual', status_code=201)
def manual(payload: ManualRecordRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return record_service.manual(store, payload, current['sub'], current['role'], idempotency_key)


@router.post("/extract", response_model=AIDraft)
def extract(payload: RecordExtractRequest, current: StaffUser, store: Store) -> AIDraft:
    if get_elder(store, payload.elder_id) is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    open_shift(store.read(), payload.shift_id, current['sub'], current['role'])
    original_state = care_state(care_eligible(store.read(), payload.elder_id))
    try:
        return create_draft(store, payload.elder_id, payload.shift_id, payload.text, current['sub'], current['role'])
    except AIProviderError:
        draft = record_service.save_failed_draft(store, payload.elder_id, payload.shift_id, payload.text,
                                                  current['sub'], current['role'], expected_state=original_state)
        return JSONResponse(status_code=503, content={
            'detail': 'AI provider unavailable; use manual entry',
            'error_code': 'ai_unavailable', 'safe_message': 'AI暂不可用，请使用人工录入',
            'retryable': True, 'draft_preserved': True, 'draft_id': draft.id,
        })


@router.post("/{draft_id}/confirm")
def confirm(draft_id: str, payload: RecordConfirmRequest, current: StaffUser, store: Store) -> dict:
    record, tasks = record_service.confirm(store, draft_id, current['sub'], payload.observations, payload.task_candidates,
                                           current['role'], payload.expected_revision)
    return {'record': record.model_dump(), 'tasks': [task.model_dump() for task in tasks]}


@router.post('/context-extract', response_model=AIDraft)
def context_extract(payload: ContextExtractRequest, current: StaffUser, store: Store):
    original_state = care_state(care_eligible(store.read(), payload.elder_id))
    try:
        return assistant_service.create_draft(store, payload, current['sub'], current['role'])
    except AIProviderError:
        draft = record_service.save_failed_draft(store, payload.elder_id, payload.shift_id, payload.text,
                                                  current['sub'], current['role'], 'context_record', original_state)
        return JSONResponse(status_code=503, content={
            'detail': 'AI provider unavailable; use manual entry',
            'error_code': 'ai_unavailable', 'safe_message': 'AI暂不可用，请使用人工录入',
            'retryable': True, 'draft_preserved': True, 'draft_id': draft.id,
        })


@router.get('/context')
def context(elder_id: str, scene: MemoryScene, current: StaffUser, store: Store, shift_id: str | None = None):
    return assistant_service.get_context(store, elder_id, shift_id, scene, current['sub'], current['role'])


@router.get('/{record_id}', response_model=CareRecord)
def detail(record_id: str, _: StaffUser, store: Store):
    return record_service.record_detail(store, record_id)


@router.get('/{record_id}/history')
def history(record_id: str, _: StaffUser, store: Store):
    return record_service.record_detail(store, record_id).corrections


@router.post('/{record_id}/corrections', response_model=CareRecord)
def correct(record_id: str, payload: CorrectRecordRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return record_service.correct(store, record_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{record_id}/corrections/preview')
def correction_preview(record_id: str, payload: CorrectRecordRequest, current: ManagementUser, store: Store):
    return record_impact_service.preview(store, record_id, payload, current['sub'], current['role'])


@router.post('/{record_id}/corrections/apply', response_model=CareRecord)
def correction_apply(record_id: str, payload: VerifiedCorrectionRequest, current: ManagementUser, store: Store,
                     idempotency_key: IdempotencyKey = None):
    return record_service.correct(store, record_id, payload, current['sub'], current['role'], idempotency_key,
                                  payload.expected_impact_fingerprint)


@router.get('/{record_id}/impact-reviews')
def impact_reviews(record_id: str, current: ManagementUser, store: Store):
    return record_impact_service.checklists(store, record_id, current['sub'], current['role'])


@router.post('/{record_id}/corrections/{correction_id}/review')
def review_impact(record_id: str, correction_id: str, payload: RecordImpactReviewRequest, current: ManagementUser,
                  store: Store, idempotency_key: IdempotencyKey = None):
    return record_impact_service.review(store, record_id, correction_id, payload, current['sub'], current['role'],
                                        idempotency_key)
