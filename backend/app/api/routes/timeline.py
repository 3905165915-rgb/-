from datetime import datetime
from fastapi import APIRouter, Query
from app.api.deps import StaffUser, Store
from app.services.timeline_service import timeline, item_timeline

router = APIRouter(tags=['timeline'])


@router.get('/items/{item_id}/timeline')
def events(item_id: str, current: StaffUser, store: Store, limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0),
           envelope: bool = False, event_type: list[str] = Query(default=[]),
           start: datetime | None = None, end: datetime | None = None):
    if envelope:
        return item_timeline(store, item_id, current['sub'], current['role'], limit, offset, event_type, start, end)
    return timeline(store, item_id, limit, offset, current['sub'], current['role'], event_type, start, end)
