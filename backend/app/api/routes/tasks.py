from fastapi import APIRouter, HTTPException, Query

from app.api.deps import StaffUser, Store
from app.schemas.api import CareTask, TaskCompleteRequest
from app.services.store_service import complete_task, list_tasks


router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[CareTask])
def tasks(_: StaffUser, store: Store, elder_id: str | None = Query(default=None)) -> list[CareTask]:
    return list_tasks(store, elder_id)


@router.post("/{task_id}/complete", response_model=CareTask)
def complete(task_id: str, payload: TaskCompleteRequest, current: StaffUser, store: Store) -> CareTask:
    try:
        return complete_task(store, task_id, current["sub"], payload.result)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
