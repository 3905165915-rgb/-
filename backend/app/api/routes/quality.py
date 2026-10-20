from fastapi import APIRouter, HTTPException, Query
from app.api.deps import ManagementUser, Store
from app.schemas.api import QualityScanRequest, QualityResolveRequest
from app.services import quality_service
from app.services.ai_service import AIProviderError
from app.services.workflow import find

router = APIRouter(prefix='/quality', tags=['quality'])


@router.post('/checks', status_code=201)
def scan(payload: QualityScanRequest, current: ManagementUser, store: Store):
    try:
        return quality_service.scan(store, payload, current['sub'])
    except AIProviderError as exc:
        raise HTTPException(503, detail='AI unavailable or output invalid; retry with include_ai=false') from exc


@router.get('/checks')
def listing(_: ManagementUser, store: Store, elder_id: str | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    reports = [row for row in reversed(store.read()['quality_checks']) if not elder_id or row.get('elder_id') == elder_id]
    return reports[offset:offset+limit]


@router.get('/checks/{report_id}')
def detail(report_id: str, _: ManagementUser, store: Store):
    return find(store.read(), 'quality_checks', report_id, 'quality_report_not_found')


@router.post('/checks/{report_id}/issues/{issue_id}/resolve')
def resolve(report_id: str, issue_id: str, payload: QualityResolveRequest, current: ManagementUser, store: Store):
    return quality_service.resolve(store, report_id, issue_id, payload, current['sub'])
