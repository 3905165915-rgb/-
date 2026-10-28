from fastapi import APIRouter, Query

from app.api.deps import StaffUser, ManagementUser, Store
from app.schemas.api import CareTask, TaskCompleteRequest, TaskCreateRequest, TaskUpdateRequest, TaskTransitionRequest
from app.services import task_service
from app.api.routes.records import IdempotencyKey
from app.services.workflow import find
from app.schemas.task_memory import TaskMemoryAdoptRequest, TaskMemoryResponse, TaskMemoryWithdrawRequest
from app.services import task_memory_service
from app.schemas.task_condition import ConditionConfigureRequest, ConditionClaimRequest, ConditionCheckRequest, TaskConditionResponse
from app.services import task_condition_service
from app.services.listing_service import Page


router = APIRouter(prefix="/tasks", tags=["tasks"])
from app.schemas.batch import BatchRequest


@router.post('/batch/preview')
def batch_preview(payload: BatchRequest, current: ManagementUser, store: Store):
    from app.services.batch_service import execute
    return execute(store, payload, current['sub'], current['role'], 'tasks', preview=True)


@router.post('/batch/transfer')
def batch_transfer(payload: BatchRequest, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey):
    from app.services.batch_service import execute
    return execute(store, payload, current['sub'], current['role'], 'tasks', idempotency_key)


@router.post("", response_model=CareTask, status_code=201)
def create(payload: TaskCreateRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return task_service.create(store, payload, current['sub'], current['role'], idempotency_key)


@router.get("", response_model=list[CareTask] | Page[CareTask])
def tasks(current: StaffUser, store: Store, elder_id: str | None = None, shift_id: str | None = None,
          assigned_to: str | None = None, status: str | None = None,
          limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0),
          envelope: bool = False, q: str | None = Query(None, max_length=100)):
    return task_service.list_tasks(store, elder_id, shift_id, assigned_to, status, limit, offset,
                                   current['sub'], current['role'], envelope, q)


@router.get('/{task_id}', response_model=CareTask)
def detail(task_id: str, current: StaffUser, store: Store):
    from app.services.presentation_service import task_context
    data = store.read()
    return task_context(data, task_service.task_view(find(data, 'care_tasks', task_id, 'task_not_found')),
                        current['sub'], current['role'])


@router.patch('/{task_id}', response_model=CareTask)
def update(task_id: str, payload: TaskUpdateRequest, current: ManagementUser, store: Store):
    return task_service.update(store, task_id, payload, current['sub'])


@router.post('/{task_id}/transition', response_model=CareTask)
def transition(task_id: str, payload: TaskTransitionRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return task_service.transition(store, task_id, payload, current['sub'], current['role'], idempotency_key)


@router.post("/{task_id}/complete", response_model=CareTask)
def complete(task_id: str, payload: TaskCompleteRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None) -> CareTask:
    return task_service.complete(store, task_id, current['sub'], current['role'], payload.result, idempotency_key)


@router.get('/{task_id}/memory-references', response_model=TaskMemoryResponse)
def memory_references(task_id: str, _: StaffUser, store: Store):
    return task_memory_service.get(store, task_id)


@router.post('/{task_id}/memory-references', response_model=TaskMemoryResponse, status_code=201)
def adopt_memory(task_id: str, payload: TaskMemoryAdoptRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return task_memory_service.adopt(store, task_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{task_id}/memory-references/{reference_id}/withdraw', response_model=TaskMemoryResponse)
def withdraw_memory(task_id: str, reference_id: str, payload: TaskMemoryWithdrawRequest, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return task_memory_service.withdraw(store, task_id, reference_id, payload, current['sub'], current['role'], idempotency_key)


@router.get('/{task_id}/condition', response_model=TaskConditionResponse)
def condition(task_id: str, _: StaffUser, store: Store):
    return task_condition_service.get(store, task_id)


@router.post('/{task_id}/condition/configure', response_model=TaskConditionResponse)
def configure_condition(task_id: str, payload: ConditionConfigureRequest, current: ManagementUser, store: Store,
                        idempotency_key: IdempotencyKey = None):
    return task_condition_service.configure(store, task_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{task_id}/condition/claim', response_model=TaskConditionResponse)
def claim_condition(task_id: str, payload: ConditionClaimRequest, current: StaffUser, store: Store,
                    idempotency_key: IdempotencyKey = None):
    return task_condition_service.claim(store, task_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{task_id}/condition/check', response_model=TaskConditionResponse)
def check_condition(task_id: str, payload: ConditionCheckRequest, current: StaffUser, store: Store,
                    idempotency_key: IdempotencyKey = None):
    return task_condition_service.check(store, task_id, payload, current['sub'], current['role'], idempotency_key)
