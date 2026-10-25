from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, HTTPException

from app.api.deps import ManagementUser, FamilyUser, Store
from app.schemas import family as schema
from app.services import family_service as service
from app.services.staff_service import staff_view

router = APIRouter(tags=['family'])
Key = Annotated[str | None, Header(alias='Idempotency-Key', min_length=1, max_length=200)]


@router.post('/family/summaries/suggest', status_code=201)
def suggest_summary(payload: schema.SummarySuggest, current: ManagementUser, store: Store, idempotency_key: Key = None):
    from app.services.ai_service import AIProviderError
    from pydantic import ValidationError
    try:
        return service.suggest_summary(store, payload, current['sub'], current['role'], idempotency_key)
    except (AIProviderError, ValidationError) as exc:
        raise HTTPException(503, '简报整理暂不可用，请手工填写；尚未向家属发布任何内容') from exc


@router.patch('/family/summaries/{summary_id}')
def edit_summary(summary_id: str, payload: schema.SummaryEdit, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.edit_summary(store, summary_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/family/accounts', status_code=201)
def create_account(payload: schema.FamilyAccountCreate, current: ManagementUser, store: Store):
    return service.create_account(store, payload, current['sub'], current['role'])


@router.get('/family/accounts')
def accounts(_: ManagementUser, store: Store, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return [staff_view(row) for row in store.read()['users'] if row['role'] == 'family'][offset:offset + limit]


@router.patch('/family/accounts/{account_id}')
def update_account(account_id: str, payload: schema.FamilyAccountUpdate, current: ManagementUser, store: Store):
    return service.update_account(store, account_id, payload, current['sub'], current['role'])


@router.post('/family/accounts/{account_id}/reset-password')
def reset_password(account_id: str, payload: schema.StaffPasswordReset, current: ManagementUser, store: Store):
    return service.update_account(store, account_id, payload, current['sub'], current['role'], password=True)


@router.get('/family/cases')
def cases(_: ManagementUser, store: Store, kind: Literal['binding', 'summary', 'feedback'], elder_id: str | None = None,
          limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    data = store.read()
    return [{**row, 'effective': service.effective(data, row)} if kind == 'binding' else row
            for row in reversed(service.rows(data, kind)) if elder_id is None or row['elder_id'] == elder_id][offset:offset + limit]


@router.post('/family/bindings', status_code=201)
def bind(payload: schema.BindingCreate, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.create_binding(store, payload, current['sub'], current['role'], idempotency_key)


@router.post('/family/bindings/{binding_id}/revoke')
def revoke(binding_id: str, payload: schema.FamilyDecision, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.revoke(store, binding_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/family/summaries', status_code=201)
def create_summary(payload: schema.SummaryCreate, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.create_summary(store, payload, current['sub'], current['role'], idempotency_key)


@router.post('/family/summaries/{summary_id}/review')
def review_summary(summary_id: str, payload: schema.SummaryReview, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.review_summary(store, summary_id, payload, current['sub'], current['role'], idempotency_key)


@router.get('/family/me/bindings')
def my_bindings(current: FamilyUser, store: Store):
    return service.my_bindings(store, current['sub'])


@router.get('/family/me/bindings/{binding_id}/summaries')
def summaries(binding_id: str, current: FamilyUser, store: Store, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.summaries(store, binding_id, current['sub'], limit, offset)


@router.post('/family/me/feedback', status_code=201)
def feedback(payload: schema.FeedbackCreate, current: FamilyUser, store: Store, idempotency_key: Key = None):
    return service.feedback(store, payload, current['sub'], idempotency_key)


@router.get('/family/me/bindings/{binding_id}/feedback')
def my_feedback(binding_id: str, current: FamilyUser, store: Store, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.my_feedback(store, binding_id, current['sub'], limit, offset)


@router.post('/family/feedback/{feedback_id}/reply')
def reply(feedback_id: str, payload: schema.FeedbackResponse, current: ManagementUser, store: Store, idempotency_key: Key = None):
    return service.reply(store, feedback_id, payload, current['sub'], current['role'], idempotency_key)
