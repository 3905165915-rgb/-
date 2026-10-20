from typing import Annotated, Literal
from fastapi import APIRouter, HTTPException, Header, Query

from app.api.deps import StaffUser, Store
from app.schemas.api import AIDraft, CareRecord, RecordConfirmRequest, RecordExtractRequest, ManualRecordRequest, CorrectRecordRequest, RejectDraftRequest
from app.services.ai_service import AIProviderError
from app.services.store_service import create_draft, get_elder
from app.services import record_service
from app.services.workflow import open_shift
from app.schemas.assistant import ContextExtractRequest
from app.services import assistant_service


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
    return record_service.reject(store, draft_id, current['sub'], current['role'], payload.reason)


@router.post('/manual', status_code=201)
def manual(payload: ManualRecordRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return record_service.manual(store, payload, current['sub'], current['role'], idempotency_key)


@router.post("/extract", response_model=AIDraft)
def extract(payload: RecordExtractRequest, current: StaffUser, store: Store) -> AIDraft:
    if get_elder(store, payload.elder_id) is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    open_shift(store.read(), payload.shift_id, current['sub'], current['role'])
    try:
        return create_draft(store, payload.elder_id, payload.shift_id, payload.text, current['sub'], current['role'])
    except AIProviderError as exc:
        raise HTTPException(status_code=503, detail="AI provider unavailable; use manual entry") from exc


@router.post("/{draft_id}/confirm")
def confirm(draft_id: str, payload: RecordConfirmRequest, current: StaffUser, store: Store) -> dict:
    record, tasks = record_service.confirm(store, draft_id, current['sub'], payload.observations, payload.task_candidates, current['role'])
    return {'record': record.model_dump(), 'tasks': [task.model_dump() for task in tasks]}


@router.post('/context-extract', response_model=AIDraft)
def context_extract(payload: ContextExtractRequest, current: StaffUser, store: Store):
    try:
        return assistant_service.create_draft(store, payload, current['sub'], current['role'])
    except AIProviderError as exc:
        raise HTTPException(status_code=503, detail='AI provider unavailable; use manual entry') from exc


@router.get('/{record_id}', response_model=CareRecord)
def detail(record_id: str, _: StaffUser, store: Store):
    return record_service.record_detail(store, record_id)


@router.get('/{record_id}/history')
def history(record_id: str, _: StaffUser, store: Store):
    return record_service.record_detail(store, record_id).corrections


@router.post('/{record_id}/corrections', response_model=CareRecord)
def correct(record_id: str, payload: CorrectRecordRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return record_service.correct(store, record_id, payload, current['sub'], current['role'], idempotency_key)
