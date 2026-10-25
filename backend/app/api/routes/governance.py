from typing import Literal

from fastapi import APIRouter

from app.api.deps import ManagementUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.governance import EvaluationSubmit
from app.services import governance_service as service

router = APIRouter(prefix='/ai-governance', tags=['ai-governance'])


@router.get('/operations')
def operations(current: ManagementUser, store: Store):
    return service.operations(store, current['sub'], current['role'])


@router.post('/evaluations', status_code=201)
def submit(payload: EvaluationSubmit, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.submit(store, payload, current['sub'], current['role'], idempotency_key)


@router.get('/comparison')
def compare(dataset_version: str, feature: str, split: Literal['development', 'holdout'],
            current: ManagementUser, store: Store):
    return service.compare(store, dataset_version, feature, split, current['sub'], current['role'])
