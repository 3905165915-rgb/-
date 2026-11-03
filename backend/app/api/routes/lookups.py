from typing import Literal

from fastapi import APIRouter, Query

from app.api.deps import StaffUser, Store
from app.services import lookup_service

router = APIRouter(tags=['lookups'])


@router.get('/options/{kind}')
def options(kind: Literal['elders', 'staff', 'shifts', 'incidents'], current: StaffUser, store: Store,
            q: str = Query('', max_length=100), elder_id: str | None = None, shift_id: str | None = None,
            status: str | None = Query(None, max_length=40),
            limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    return lookup_service.options(store, kind, current['sub'], current['role'], q, elder_id, shift_id, status, limit, offset)
