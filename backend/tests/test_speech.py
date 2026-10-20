from dataclasses import replace
from io import BytesIO
import wave

import httpx
import pytest

from app.services import speech_service as service
from app.services.workflow import DomainError


def wav(seconds=0.1, channels=1, rate=16000, width=2):
    output = BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setparams((channels, width, rate, 0, 'NONE', 'not compressed'))
        writer.writeframes(b'\x00' * int(seconds * rate) * channels * width)
    return output.getvalue()


@pytest.fixture
def speech(monkeypatch):
    monkeypatch.setattr(service, 'settings', replace(service.settings, siliconflow_api_key='fake-test-speech-key'))
    monkeypatch.setattr(service, 'limits', service.SpeechLimits())


def provider_mock(monkeypatch, handler):
    original = httpx.AsyncClient
    def factory(**options):
        assert options['follow_redirects'] is False
        assert options['trust_env'] is False
        return original(transport=httpx.MockTransport(handler), **options)
    monkeypatch.setattr(service.httpx, 'AsyncClient', factory)


def upload(client, headers, audio, **extra_headers):
    return client.post('/api/v1/speech/transcriptions', content=audio,
                       headers={**headers(), 'Content-Type': 'audio/wav', **extra_headers})


def test_status_and_upload_require_staff_auth(api, speech):
    client, _, headers = api
    assert client.get('/api/v1/speech/status').status_code == 401
    assert client.get('/api/v1/speech/status', headers=headers('family')).status_code == 403
    assert client.post('/api/v1/speech/transcriptions', content=wav(), headers=headers('family')).status_code == 403
    result = client.get('/api/v1/speech/status', headers=headers()).json()
    assert result['configured'] is True and 'fake-test-speech-key' not in str(result)
    assert result['audio_persisted_by_backend'] is False


def test_demo_serves_no_credentials_and_does_not_bypass_api_auth(api):
    client, _, _ = api
    page = client.get('/api/v1/speech/demo')
    assert page.status_code == 200 and page.headers['cache-control'] == 'no-store'
    assert '护理语音录入' in page.text and 'SILICONFLOW_API_KEY' not in page.text
    assert 'new Blob' in page.text and '16000' in page.text
    assert client.get('/api/v1/speech/status').status_code == 401


def test_unconfigured_returns_real_unavailable_without_saving(api, monkeypatch):
    client, store, headers = api
    monkeypatch.setattr(service, 'settings', replace(service.settings, siliconflow_api_key=''))
    original = store.path.read_bytes()
    result = upload(client, headers, wav())
    assert result.status_code == 503 and result.json()['detail'] == 'speech_not_configured_use_manual_entry'
    assert store.path.read_bytes() == original


def test_success_preserves_text_and_requires_separate_confirmation(api, speech, monkeypatch):
    client, store, headers = api
    audio = wav()
    transcript = '没有外出，饮水200毫升，若晚餐仍进食较少再联系家属。'
    def handle(request):
        assert str(request.url) == service.ENDPOINT
        assert request.headers['Authorization'] == 'Bearer fake-test-speech-key'
        assert request.headers['Content-Type'].startswith('multipart/form-data; boundary=')
        assert audio in request.content and service.MODEL.encode() in request.content
        return httpx.Response(200, json={'text': transcript})
    provider_mock(monkeypatch, handle)
    before = store.path.read_bytes()
    result = upload(client, headers, audio)
    assert result.status_code == 200
    assert result.json()['text'] == transcript
    assert result.json()['requires_confirmation'] is True and result.json()['saved'] is False
    assert result.json()['duration_seconds'] == 0.1
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('audio,code', [
    (b'', 422), (b'pretending to be audio', 422), (wav()[:-10], 422),
    (wav(channels=2), 415), (wav(rate=48000), 415), (wav(width=1), 415),
    (wav(seconds=60.01), 422),
], ids=['empty', 'not-wav', 'truncated', 'stereo', 'wrong-rate', 'wrong-width', 'too-long'])
def test_invalid_audio_never_reaches_provider(api, speech, monkeypatch, audio, code):
    client, _, headers = api
    def handle(_):
        pytest.fail('Invalid audio must not be sent to provider')
    provider_mock(monkeypatch, handle)
    assert upload(client, headers, audio).status_code == code


def test_size_and_content_type_limits_apply_before_provider(api, speech):
    client, _, headers = api
    assert upload(client, headers, b'x' * (service.MAX_BYTES + 1)).status_code == 413
    assert upload(client, headers, b'x' * (service.MAX_BYTES + 1), **{'Content-Length': '1'}).status_code == 413
    assert upload(client, headers, wav(), **{'Content-Type': 'application/json'}).status_code == 415
    assert upload(client, headers, wav(), **{'Content-Encoding': 'gzip'}).status_code == 415
    assert upload(client, headers, wav(), **{'Content-Length': '-1'}).status_code == 400


@pytest.mark.parametrize('provider_status,expected', [(400, 422), (401, 503), (403, 503), (429, 429), (503, 503), (307, 503)])
def test_provider_failure_does_not_leak_body_or_create_success(api, speech, monkeypatch, provider_status, expected):
    client, store, headers = api
    provider_mock(monkeypatch, lambda _: httpx.Response(provider_status, json={'error': 'sensitive-provider-body'}))
    before = store.path.read_bytes()
    result = upload(client, headers, wav())
    assert result.status_code == expected
    assert 'sensitive-provider-body' not in result.text and 'fake-test-speech-key' not in result.text
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('body,expected', [({}, 503), ({'text': 123}, 503), ({'text': ''}, 422),
                                          ({'text': '  '}, 422), ({'text': 'x' * 10001}, 503), ([], 503)])
def test_invalid_and_empty_provider_text(api, speech, monkeypatch, body, expected):
    client, _, headers = api
    provider_mock(monkeypatch, lambda _: httpx.Response(200, json=body))
    assert upload(client, headers, wav()).status_code == expected


@pytest.mark.parametrize('exception,expected', [(httpx.ReadTimeout, 504), (httpx.ConnectError, 503)])
def test_network_errors_release_slots(api, speech, monkeypatch, exception, expected):
    client, _, headers = api
    def handle(_):
        raise exception('secret-provider-exception')
    provider_mock(monkeypatch, handle)
    result = upload(client, headers, wav())
    assert result.status_code == expected and 'secret-provider-exception' not in result.text
    assert not service.limits._active


def test_parallel_slots_rate_limit_and_exception_cleanup():
    limiter = service.SpeechLimits()
    with limiter.slot('one'):
        with pytest.raises(DomainError) as repeated:
            with limiter.slot('one'):
                pass
        assert repeated.value.status_code == 429
        with limiter.slot('two'):
            with pytest.raises(DomainError):
                with limiter.slot('three'):
                    pass
    for _ in range(5):
        with limiter.slot('one'):
            pass
    with pytest.raises(DomainError):
        with limiter.slot('one'):
            pass
    with pytest.raises(RuntimeError):
        with limiter.slot('fresh'):
            raise RuntimeError('test failure')
    assert not limiter._active
