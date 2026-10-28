from fastapi import APIRouter, HTTPException, Query
from app.api.deps import ManagementUser, Store
from app.schemas.api import QualityScanRequest, QualityResolveRequest
from app.services import quality_service
from app.services.ai_service import AIProviderError
from app.services.workflow import find
from app.api.routes.records import IdempotencyKey

router = APIRouter(prefix='/quality', tags=['quality'])


@router.post('/checks', status_code=201)
def scan(payload: QualityScanRequest, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    try:
        return quality_service.scan(store, payload, current['sub'], idempotency_key)
    except AIProviderError as exc:
        raise HTTPException(503, detail='AI unavailable or output invalid; retry with include_ai=false') from exc


@router.get('/checks')
def listing(_: ManagementUser, store: Store, elder_id: str | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), envelope: bool = False):
    from app.services.listing_service import page
    data = store.read()
    reports = [row for row in reversed(data['quality_checks']) if not elder_id or row.get('elder_id') == elder_id]
    result = page(reports, limit, offset, {'elder_id': elder_id}, envelope)
    rows = result['items'] if envelope else result
    rows[:] = [quality_service.report_view(data, row) for row in rows]
    return result


@router.get('/checks/{report_id}')
def detail(report_id: str, _: ManagementUser, store: Store):
    data = store.read()
    return quality_service.report_view(data, find(data, 'quality_checks', report_id, 'quality_report_not_found'))


@router.post('/checks/{report_id}/issues/{issue_id}/resolve')
def resolve(report_id: str, issue_id: str, payload: QualityResolveRequest, current: ManagementUser, store: Store):
    return quality_service.resolve(store, report_id, issue_id, payload, current['sub'])
