from datetime import date

from fastapi import APIRouter, Query
from pydantic import AwareDatetime, Field
from typing import Literal

from app.api.deps import ManagementUser, Store
from app.schemas.change_review import StrictRequest, ObjectId, Text
from app.services import insight_service as service

router = APIRouter(tags=['operational-insights'])


class CoverageReview(StrictRequest):
    elder_id: ObjectId
    service_date: date
    occurrence_key: ObjectId
    expected_fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')
    decision: Literal['needs_followup', 'not_applicable', 'reopen_review']
    note: Text


class ChangeAcknowledgement(StrictRequest):
    event_ids: list[ObjectId] = Field(min_length=1, max_length=200)


@router.get('/insights/coverage')
def coverage(elder_id: str, service_date: date, current: ManagementUser, store: Store):
    return service.coverage(store, elder_id, service_date, current['sub'], current['role'])


@router.post('/insights/coverage/reviews')
def review(payload: CoverageReview, current: ManagementUser, store: Store):
    return service.review_coverage(store, payload, current['sub'], current['role'])


@router.get('/insights/changes')
def changes(current: ManagementUser, store: Store, since: AwareDatetime | None = None, elder_id: str | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.changes(store, current['sub'], current['role'], since, elder_id, limit, offset)


@router.post('/insights/changes/acknowledge')
def acknowledge(payload: ChangeAcknowledgement, current: ManagementUser, store: Store):
    return service.acknowledge(store, payload.event_ids, current['sub'], current['role'])


@router.get('/care-plans/{plan_id}/impact')
def impact(plan_id: str, current: ManagementUser, store: Store):
    return service.plan_impact(store, plan_id, current['sub'], current['role'])
