from fastapi import APIRouter, Query
from app.api.deps import StaffUser, Store
from app.services.timeline_service import timeline

router = APIRouter(tags=['timeline'])


@router.get('/items/{item_id}/timeline')
def events(item_id: str, current: StaffUser, store: Store, limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0)):
    return timeline(store, item_id, limit, offset, current['sub'], current['role'])
