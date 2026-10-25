from typing import Literal

from fastapi import APIRouter, Query
from pydantic import Field

from app.api.deps import StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.change_review import StrictRequest
from app.services import notification_service as service

router = APIRouter(prefix='/notifications', tags=['notifications'])


class NotificationAction(StrictRequest):
    expected_revision: int = Field(ge=1)
    action: Literal['read', 'accept']


@router.get('')
def listing(current: StaffUser, store: Store, unread: bool = False, pending: bool = False,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.listing(store, current['sub'], current['role'], unread, pending, limit, offset)


@router.post('/{notification_id}/actions')
def action(notification_id: str, payload: NotificationAction, current: StaffUser, store: Store,
           idempotency_key: IdempotencyKey = None):
    return service.act(store, notification_id, payload, current['sub'], current['role'], idempotency_key)
