"""Hosted speech recognition. No local model, no audio persistence, no automatic records."""
from __future__ import annotations

from collections import defaultdict, deque
from contextlib import contextmanager
from io import BytesIO
import threading
import time
import wave

import httpx
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.workflow import DomainError

MODEL = 'Qwen/Qwen3-ASR-1.7B'
ENDPOINT = 'https://api.siliconflow.cn/v1/audio/transcriptions'
MAX_BYTES = 3 * 1024 * 1024
MAX_SECONDS = 60


class TranscriptionResponse(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    provider: str = 'siliconflow'
    model: str = MODEL
    duration_seconds: float
    requires_confirmation: bool = True
    saved: bool = False
    warnings: list[str] = Field(default_factory=lambda: ['请核对人名、数值、否定和条件；转写尚未保存为护理记录。'])


class SpeechLimits:
    """Single-server limits: two requests total, one per user, six attempts per minute."""
    def __init__(self):
        self._lock = threading.Lock()
        self._active = set()
        self._attempts = defaultdict(deque)

    @contextmanager
    def slot(self, user_id):
        with self._lock:
            current = time.monotonic()
            for user in list(self._attempts):
                queue = self._attempts[user]
                while queue and queue[0] <= current - 60:
                    queue.popleft()
                if not queue:
                    del self._attempts[user]
            if user_id in self._active or len(self._active) >= 2 or len(self._attempts.get(user_id, [])) >= 6:
                raise DomainError('speech_rate_limited_retry_later', 429)
            self._active.add(user_id)
            self._attempts[user_id].append(current)
        try:
            yield
        finally:
            with self._lock:
                self._active.remove(user_id)


limits = SpeechLimits()


def status():
    configured = bool(settings.siliconflow_api_key)
    return {'provider': 'siliconflow', 'model': settings.speech_model, 'configured': configured,
            'reason': None if configured else 'speech_not_configured',
            'max_bytes': MAX_BYTES, 'max_duration_seconds': MAX_SECONDS,
            'input': {'content_type': 'audio/wav', 'encoding': 'PCM_16', 'sample_rate': 16000, 'channels': 1},
            'audio_persisted_by_backend': False, 'requires_confirmation': True}


def validate_wav(audio: bytes) -> float:
    if not audio:
        raise DomainError('speech_audio_empty', 422)
    if len(audio) > MAX_BYTES:
        raise DomainError('speech_audio_too_large', 413)
    try:
        with wave.open(BytesIO(audio), 'rb') as reader:
            if (reader.getnchannels(), reader.getsampwidth(), reader.getframerate(), reader.getcomptype()) != (1, 2, 16000, 'NONE'):
                raise DomainError('speech_requires_16khz_mono_pcm16_wav', 415)
            count = reader.getnframes()
            duration = count / 16000
            if duration <= 0:
                raise DomainError('speech_audio_empty', 422)
            if duration > MAX_SECONDS:
                raise DomainError('speech_audio_longer_than_60_seconds', 422)
            if len(reader.readframes(count)) != count * 2:
                raise DomainError('speech_audio_truncated', 422)
            return duration
    except DomainError:
        raise
    except (wave.Error, EOFError, ValueError) as exc:
        raise DomainError('speech_audio_invalid_wav', 422) from exc


async def transcribe(audio: bytes) -> TranscriptionResponse:
    if not settings.siliconflow_api_key:
        raise DomainError('speech_not_configured_use_manual_entry', 503)
    duration = validate_wav(audio)
    try:
        # No automatic retries: a retry may repeat a billable or rate-limited provider request.
        async with httpx.AsyncClient(timeout=httpx.Timeout(settings.speech_timeout_seconds, connect=10),
                                     follow_redirects=False, trust_env=False) as client:
            response = await client.post(ENDPOINT,
                headers={'Authorization': 'Bearer ' + settings.siliconflow_api_key},
                data={'model': settings.speech_model}, files={'file': ('recording.wav', audio, 'audio/wav')})
        if response.status_code == 429:
            raise DomainError('speech_provider_rate_limited', 429)
        if response.status_code in {400, 413, 415, 422}:
            raise DomainError('speech_provider_rejected_audio', 422)
        if response.status_code in {401, 403}:
            raise DomainError('speech_provider_credentials_or_access_invalid', 503)
        if not 200 <= response.status_code < 300:
            raise DomainError('speech_provider_unavailable_use_manual_entry', 503)
        body = response.json()
        if not isinstance(body, dict) or not isinstance(body.get('text'), str) or len(body['text']) > 10000:
            raise ValueError('Invalid provider response')
        text = body['text'].strip()
        if not text:
            raise DomainError('speech_no_text_detected_retry_or_type', 422)
        return TranscriptionResponse(text=text, model=settings.speech_model, duration_seconds=round(duration, 3))
    except DomainError:
        raise
    except httpx.TimeoutException as exc:
        raise DomainError('speech_provider_timeout_use_manual_entry', 504) from exc
    except (httpx.HTTPError, ValueError) as exc:
        # Never expose provider bodies, URLs containing credentials, or raw recordings.
        raise DomainError('speech_provider_unavailable_or_invalid_response', 503) from exc
