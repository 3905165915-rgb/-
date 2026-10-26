from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse
from pydantic import AwareDatetime
from starlette.concurrency import run_in_threadpool

from app.api.deps import StaffUser, ManagementUser, Store
from app.api.routes.records import IdempotencyKey
from app.schemas.photo import PhotoReview, PhotoLink, ImageReview, PhotoFamilyShare
from app.services import attachment_service as service
from app.services import vision_service as vision
from app.services.workflow import DomainError

router = APIRouter(prefix='/attachments', tags=['attachments'])


@router.get('/vision/status')
def vision_status(_: StaffUser):
    return vision.status()


@router.post('/{attachment_id}/analyze')
def analyze(attachment_id: str, current: StaffUser, store: Store, idempotency_key: IdempotencyKey = None):
    return vision.analyze(store, attachment_id, current['sub'], current['role'], idempotency_key)


@router.get('/analyses/{analysis_id}')
def analysis(analysis_id: str, current: StaffUser, store: Store):
    return vision.detail(store, analysis_id, current['sub'], current['role'])


@router.post('/analyses/{analysis_id}/review')
def review_analysis(analysis_id: str, payload: ImageReview, current: StaffUser, store: Store,
                    idempotency_key: IdempotencyKey = None):
    return vision.review(store, analysis_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('', status_code=201)
async def upload(request: Request, current: StaffUser, store: Store, elder_id: str, occurred_at: AwareDatetime,
                 caption: str = Query('', max_length=1000), idempotency_key: IdempotencyKey = None):
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > service.MAX_BYTES:
            raise DomainError('attachment_size_invalid', 413)
    return await run_in_threadpool(service.upload, store, elder_id, occurred_at, caption, bytes(content),
                                   request.headers.get('content-type', '').split(';')[0].strip(),
                                   current['sub'], current['role'], idempotency_key)


@router.get('')
def listing(elder_id: str, current: StaffUser, store: Store,
            limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0)):
    return service.listing(store, elder_id, current['sub'], current['role'], limit, offset)


@router.get('/{attachment_id}')
def detail(attachment_id: str, current: StaffUser, store: Store):
    return service.get(store, attachment_id, current['sub'], current['role'])


@router.get('/{attachment_id}/content')
def content(attachment_id: str, current: StaffUser, store: Store):
    path = service.get(store, attachment_id, current['sub'], current['role'], download=True)
    return FileResponse(path, media_type='image/jpeg', filename='观察照片.jpg')


@router.post('/{attachment_id}/review')
def review(attachment_id: str, payload: PhotoReview, current: ManagementUser, store: Store,
           idempotency_key: IdempotencyKey = None):
    return service.review(store, attachment_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{attachment_id}/links')
def link(attachment_id: str, payload: PhotoLink, current: StaffUser, store: Store,
         idempotency_key: IdempotencyKey = None):
    return service.link(store, attachment_id, payload, current['sub'], current['role'], idempotency_key)


@router.post('/{attachment_id}/family-sharing')
def family_sharing(attachment_id: str, payload: PhotoFamilyShare, current: ManagementUser, store: Store,
                   idempotency_key: IdempotencyKey = None):
    return service.family_sharing(store, attachment_id, payload, current['sub'], current['role'], idempotency_key)
