import asyncio
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from starlette.requests import ClientDisconnect

from app.api.deps import StaffUser
from app.services import speech_service as service
from app.services.workflow import DomainError

router = APIRouter(prefix='/speech', tags=['speech'])


@router.get('/demo', include_in_schema=False)
def demo():
    return FileResponse(Path(__file__).resolve().parents[2] / 'static' / 'speech-demo.html',
                        media_type='text/html', headers={'Cache-Control': 'no-store'})


@router.get('/status')
def status(_: StaffUser):
    return service.status()


@router.post('/transcriptions', response_model=service.TranscriptionResponse, openapi_extra={
    'requestBody': {'required': True, 'content': {'audio/wav': {'schema': {'type': 'string', 'format': 'binary'}}}},
    'description': 'Raw WAV body, not multipart. PCM16, mono, 16 kHz, at most 60 seconds / 3 MiB. '
                   'Cloud recognition only; human correction and a separate record-confirm action are required.',
})
async def transcribe(request: Request, current: StaffUser):
    if not service.status()['configured']:
        raise DomainError('speech_not_configured_use_manual_entry', 503)
    if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() not in {'audio/wav', 'audio/x-wav'}:
        raise DomainError('speech_content_type_must_be_audio_wav', 415)
    if request.headers.get('content-encoding', 'identity').lower() != 'identity':
        raise DomainError('speech_compressed_http_body_not_supported', 415)
    length = request.headers.get('content-length')
    if length:
        try:
            declared = int(length)
        except ValueError as exc:
            raise DomainError('speech_invalid_content_length', 400) from exc
        if declared < 0:
            raise DomainError('speech_invalid_content_length', 400)
        if declared > service.MAX_BYTES:
            raise DomainError('speech_audio_too_large', 413)
    with service.limits.slot(current['sub']):
        async def read_limited():
            audio = bytearray()
            async for chunk in request.stream():
                if len(audio) + len(chunk) > service.MAX_BYTES:
                    raise DomainError('speech_audio_too_large', 413)
                audio.extend(chunk)
            return bytes(audio)
        try:
            audio = await asyncio.wait_for(read_limited(), timeout=20)
        except asyncio.TimeoutError as exc:
            raise DomainError('speech_upload_timeout', 408) from exc
        except ClientDisconnect as exc:
            raise DomainError('speech_upload_interrupted', 400) from exc
        return await service.transcribe(audio)
