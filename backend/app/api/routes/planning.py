from fastapi import APIRouter, Query

from app.api.deps import ManagementUser, StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.planning import AssessmentCreate, AssessmentReview, PlanCreate, PlanReview, PlanGenerate, PlanReissue
from app.services import assessment_service as assessments, plan_service as plans
from app.services.workflow import find

router = APIRouter(tags=['planning'])


@router.get('/assessments/templates')
def templates(_: StaffUser):
    return assessments.templates()


@router.get('/assessments')
def list_assessments(current: StaffUser, store: Store, elder_id: str | None = None,
                     limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return assessments.listing(store, current['sub'], current['role'], elder_id, limit, offset)


@router.get('/assessments/{assessment_id}')
def get_assessment(assessment_id: str, current: StaffUser, store: Store):
    return assessments.get(store, assessment_id, current['sub'], current['role'])


@router.post('/assessments', status_code=201)
def create_assessment(payload: AssessmentCreate, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return assessments.create(store, payload, current['sub'], current['role'], idempotency_key)


@router.post('/assessments/{assessment_id}/review')
def review_assessment(assessment_id: str, payload: AssessmentReview, current: ManagementUser, store: Store,
                      idempotency_key: IdempotencyKey = None):
    return assessments.review(store, assessment_id, payload, current['sub'], current['role'], idempotency_key)


@router.get('/care-plans')
def list_plans(current: StaffUser, store: Store, elder_id: str | None = None,
               limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return plans.listing(store, current['role'], elder_id, limit, offset, current['sub'])


@router.get('/care-plans/{plan_id}')
def get_plan(plan_id: str, current: StaffUser, store: Store):
    return plans.get(store, plan_id, current['role'])


@router.post('/care-plans', status_code=201)
def create_plan(payload: PlanCreate, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return plans.create(store, payload, current['sub'], current['role'], idempotency_key)


@router.post('/care-plans/{plan_id}/review')
def review_plan(plan_id: str, payload: PlanReview, current: ManagementUser, store: Store,
                idempotency_key: IdempotencyKey = None):
    return plans.review(store, plan_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/care-plans/{plan_id}/generate')
def generate(plan_id: str, payload: PlanGenerate, current: ManagementUser, store: Store,
              idempotency_key: IdempotencyKey = None):
    return plans.generate(store, plan_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/care-plans/{plan_id}/reissue', status_code=201)
def reissue(plan_id: str, payload: PlanReissue, current: ManagementUser, store: Store,
            idempotency_key: IdempotencyKey = None):
    return plans.reissue(store, plan_id, payload, current['sub'], current['role'], idempotency_key)


@router.get('/tasks/{task_id}/plan-check')
def task_plan_check(task_id: str, _: StaffUser, store: Store):
    data = store.read()
    item = find(data, 'care_tasks', task_id, 'task_not_found')
    return {'task_id': task_id, 'task_revision': item.get('revision', 1),
            'historical_only': item['status'] in {'completed', 'cancelled'}, 'current': plans.task_state(data, item)}
