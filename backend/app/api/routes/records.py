from fastapi import APIRouter, HTTPException

from app.api.deps import StaffUser, Store
from app.schemas.api import AIDraft, CareRecord, CareTask, RecordConfirmRequest, RecordExtractRequest
from app.services.ai_service import AIProviderError
from app.services.store_service import confirm_draft, create_draft, get_elder


router = APIRouter(prefix="/records", tags=["records"])


@router.post("/extract", response_model=AIDraft)
def extract(payload: RecordExtractRequest, _: StaffUser, store: Store) -> AIDraft:
    if get_elder(store, payload.elder_id) is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    try:
        return create_draft(store, payload.elder_id, payload.shift_id, payload.text)
    except AIProviderError as exc:
        raise HTTPException(status_code=503, detail="AI provider unavailable; use manual entry") from exc


@router.post("/{draft_id}/confirm")
def confirm(draft_id: str, payload: RecordConfirmRequest, current: StaffUser, store: Store) -> dict:
    try:
        record, tasks = confirm_draft(store, draft_id, current["sub"], payload.observations, payload.task_candidates)
    except ValueError as exc:
        if str(exc) == "draft_not_found":
            raise HTTPException(status_code=404, detail="AI draft not found") from exc
        raise
    return {"record": CareRecord.model_dump(record), "tasks": [CareTask.model_dump(task) for task in tasks]}
