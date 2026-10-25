from datetime import date

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import Field

from app.api.deps import ManagementUser, Store
from app.schemas.change_review import StrictRequest, Text
from app.services import report_service as service
from app.services import dashboard_service

router = APIRouter(prefix='/reports', tags=['reports'])


@router.get('/dashboard')
def dashboard(start: date, end: date, current: ManagementUser, store: Store,
              elder_id: str | None = None, shift_id: str | None = None, status: str | None = None):
    return dashboard_service.dashboard(store, start, end, current['sub'], current['role'], elder_id, shift_id, status)


class ExportRequest(StrictRequest):
    include_text: bool = Field(default=False, strict=True)
    reason: Text


@router.get('/metrics')
def metrics(start: date, end: date, current: ManagementUser, store: Store):
    return service.metrics(store, start, end, current['sub'], current['role'])


@router.post('/elders/{elder_id}/export')
def export(elder_id: str, payload: ExportRequest, current: ManagementUser, store: Store):
    result = service.export_case(store, elder_id, payload.include_text, payload.reason, current['sub'], current['role'])
    return JSONResponse(content=result, headers={'Content-Disposition': f'attachment; filename="{result["export_id"]}.json"'})
