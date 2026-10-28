from fastapi import APIRouter, Query, HTTPException
from app.api.deps import ManagementUser, StaffUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.api import ShiftCreateRequest, HandoverCreateRequest, HandoverSubmitRequest, HandoverReceiveRequest, ClarificationRequest, AIReviewRequest
from app.services.ai_service import AIProviderError
from app.services import handover_service as service
from app.services.workflow import find, parse_time

router = APIRouter(tags=['handovers'])


def scoped(result, store, current):
    data = store.read()
    item = find(data, 'handovers', result['id'], 'handover_not_found')
    return service.role_view(data, item, current['sub'], current['role'])


@router.post('/shifts', status_code=201)
def create_shift(payload: ShiftCreateRequest, current: ManagementUser, store: Store, idempotency_key: IdempotencyKey = None):
    return service.create_shift(store, payload, current['sub'], idempotency_key)


@router.get('/shifts')
def shifts(_: StaffUser, store: Store, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return sorted(store.read()['shifts'], key=lambda row: parse_time(row['start_at']), reverse=True)[offset:offset+limit]


@router.get('/shifts/{shift_id}')
def shift(shift_id: str, _: StaffUser, store: Store):
    return find(store.read(), 'shifts', shift_id, 'shift_not_found')


@router.post('/handovers', status_code=201)
def create(payload: HandoverCreateRequest, current: StaffUser, store: Store):
    return scoped(service.create(store, payload, current['sub'], current['role']), store, current)


@router.get('/handovers')
def listing(current: StaffUser, store: Store, shift_id: str | None = None,
            limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return service.list_handovers(store, current['sub'], current['role'], shift_id, limit, offset)


@router.get('/handovers/{handover_id}')
def detail(handover_id: str, current: StaffUser, store: Store):
    return service.get(store, handover_id, current['sub'], current['role'])


@router.post('/handovers/{handover_id}/refresh')
def refresh(handover_id: str, current: StaffUser, store: Store):
    return scoped(service.refresh(store, handover_id, current['sub'], current['role']), store, current)


@router.post('/handovers/{handover_id}/submit')
def submit(handover_id: str, payload: HandoverSubmitRequest, current: StaffUser, store: Store):
    return scoped(service.submit(store, handover_id, payload, current['sub'], current['role']), store, current)


@router.post('/handovers/{handover_id}/ai-summary')
def ai_summary(handover_id: str, payload: AIReviewRequest, current: StaffUser, store: Store):
    try:
        return scoped(service.generate_summary(store, handover_id, payload.expected_revision, current['sub'], current['role'], payload.text), store, current)
    except AIProviderError as exc:
        raise HTTPException(503, detail='AI unavailable or output invalid; use manual summary') from exc


@router.post('/handovers/{handover_id}/items/{item_id}/receive')
def receive(handover_id: str, item_id: str, payload: HandoverReceiveRequest, current: StaffUser, store: Store):
    return scoped(service.receive(store, handover_id, item_id, payload, current['sub'], current['role']), store, current)


@router.post('/handovers/{handover_id}/items/{item_id}/clarify')
def clarify(handover_id: str, item_id: str, payload: ClarificationRequest, current: StaffUser, store: Store):
    return scoped(service.clarify(store, handover_id, item_id, payload.note, current['sub'], current['role']), store, current)
