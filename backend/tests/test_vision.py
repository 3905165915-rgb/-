from dataclasses import replace

import pytest

from app.core import config
from app.services import vision_service as vision
from test_facility import post
from test_photos import scope, upload


def configure(monkeypatch):
    monkeypatch.setattr(config, 'settings', replace(config.settings, vision_api_key='test-key',
                       vision_base_url='https://vision.example.test/v1', vision_model='test-vision'))


def visible(professional=False):
    return {'status': 'visible_observations', 'observations': ['照片中可见浅蓝色布面'],
            'missing_information': ['请补充拍摄时的现场情况'], 'verification_items': [],
            'requires_professional_review': professional}


def analyze(api, photo, key='analyze'):
    return post(api, '/attachments/' + photo['id'] + '/analyze', {}, actor='staff', expected=200, key=key)


def review(api, item, decision='confirm', actor='staff', expected=200, key=None):
    return post(api, '/attachments/analyses/' + item['id'] + '/review',
                {'expected_revision': item['revision'], 'decision': decision,
                 'observations': ['人工核对可见浅蓝色布面'], 'note': '已查看照片并核对可见情况'},
                actor=actor, expected=expected, key=key)


def test_real_provider_adapter_is_separate_from_record_save_and_confirmation_is_atomic(api, monkeypatch):
    scope(api)
    photo = upload(api)
    configure(monkeypatch)
    calls = []
    monkeypatch.setattr(vision, '_request', lambda content, settings: calls.append(content) or visible())
    item = analyze(api, photo)
    assert item['model'] == 'test-vision' and item['model_status'] == 'visible_observations'
    assert item['warning'] == vision.WARNING and item['attachment_id'] == photo['id']
    assert analyze(api, photo) == item and len(calls) == 1
    assert not api[1].read()['care_records']
    confirmed = review(api, item, key='confirm')
    assert review(api, item, key='confirm') == confirmed
    data = api[1].read()
    assert len(data['care_records']) == 1 and data['care_memories'] == []
    record = data['care_records'][0]
    assert record['source_attachment_ids'] == [photo['id']]
    assert record['source_image_analysis_id'] == item['id']
    assert record['observations'] == ['人工核对可见浅蓝色布面']
    assert confirmed['reviews'][0]['edited'] is True
    from app.services.impression_service import _snapshot
    assert _snapshot(data, 'E1', 'manager', 'supervisor')[1][0]['source_id'] == record['id']


def test_professional_review_cannot_be_self_bypassed(api, monkeypatch):
    scope(api)
    photo = upload(api)
    configure(monkeypatch)
    monkeypatch.setattr(vision, '_request', lambda *_: visible(True))
    item = analyze(api, photo)
    review(api, item, expected=403)
    pending = review(api, item, 'request_management')
    assert pending['status'] == 'pending_management'
    review(api, pending, expected=403)
    assert review(api, pending, actor='manager')['status'] == 'confirmed'


@pytest.mark.parametrize('output,expected', [
    ({'status': 'unable_to_determine', 'observations': [], 'missing_information': ['照片模糊'],
      'verification_items': [], 'requires_professional_review': False}, 'unable_to_determine'),
    ({**visible(), 'status': 'unable_to_determine'}, 'failed'),
    ({**visible(), 'observations': ['诊断为压疮，建议治疗']}, 'failed'),
    ({**visible(), 'confidence': 0.99}, 'failed'),
])
def test_unknown_and_invalid_outputs_do_not_create_facts(api, monkeypatch, output, expected):
    scope(api)
    photo = upload(api)
    configure(monkeypatch)
    monkeypatch.setattr(vision, '_request', lambda *_: output)
    item = analyze(api, photo)
    assert item['model_status'] == expected
    assert not api[1].read()['care_records']
    if expected == 'failed':
        assert item['output'] is None
    else:
        assert item['notice'] == vision.UNKNOWN and item['output']['observations'] == []
    assert review(api, item, 'reject')['status'] == 'rejected'


def test_unconfigured_vision_reports_unavailable_not_fake_success(api, monkeypatch):
    scope(api)
    photo = upload(api)
    monkeypatch.setattr(config, 'settings', replace(config.settings, vision_api_key='', vision_model='', vision_base_url=''))
    monkeypatch.setattr(vision, '_request', lambda *_: (_ for _ in ()).throw(AssertionError('no API call expected')))
    item = analyze(api, photo)
    assert item['model_status'] == 'unavailable' and item['error_code'] == 'vision_not_configured'
    assert item['output'] is None and item['warning'] == vision.WARNING


def test_vision_http_payload_and_no_secret_in_result(monkeypatch):
    import httpx
    configure(monkeypatch)
    settings = config.settings
    client_type = httpx.Client
    seen = []
    def handle(request):
        import json
        body = json.loads(request.content)
        assert request.url == 'https://vision.example.test/v1/chat/completions'
        assert body['model'] == 'test-vision'
        assert body['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,')
        seen.append(True)
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(visible())}}]})
    monkeypatch.setattr(vision.httpx, 'Client', lambda **kwargs: client_type(transport=httpx.MockTransport(handle), **kwargs))
    assert vision._request(b'image bytes', settings) == visible()
    assert seen == [True]


@pytest.mark.parametrize('base,deepseek', [
    ('https://api.deepseek.com/v1', True),
    ('https://api.deepseek.com', True),
    ('https://vision.example.test/v1', False),
])
def test_provider_options_keep_deepseek_output_structured_without_affecting_other_vendors(monkeypatch, base, deepseek):
    import json
    import httpx
    settings = replace(config.settings, vision_api_key='test-key', vision_base_url=base,
                       vision_model='deepseek-flash' if deepseek else 'test-vision')
    client_type = httpx.Client

    def handle(request):
        body = json.loads(request.content)
        if deepseek:
            assert body['thinking'] == {'type': 'disabled'}
            assert body['response_format'] == {'type': 'json_object'}
        else:
            assert 'thinking' not in body and 'response_format' not in body
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(visible())}}]})

    monkeypatch.setattr(vision.httpx, 'Client', lambda **kwargs: client_type(transport=httpx.MockTransport(handle), **kwargs))
    assert vision._request(b'synthetic', settings) == visible()


def test_permissions_changed_during_provider_call_discard_output_and_finish_job(api, monkeypatch):
    assignment = scope(api)
    photo = upload(api)
    configure(monkeypatch)
    def request(*_):
        api[1].mutate(lambda data: data.update(care_assignments=[]))
        return visible()
    monkeypatch.setattr(vision, '_request', request)
    client, store, headers = api
    response = client.post('/api/v1/attachments/' + photo['id'] + '/analyze', headers=headers())
    assert response.status_code == 409
    row = store.read()['image_analyses'][0]
    assert row['status'] == 'discarded' and row['output'] is None
    assert not store.read()['care_records']


def test_interrupted_job_becomes_visible_failure_instead_of_spinning_forever(api):
    scope(api)
    photo = upload(api)
    store = api[1]
    def seed(data):
        data['image_analyses'].append({'id': 'stuck', 'elder_id': 'E1', 'attachment_id': photo['id'],
            'created_by': 'staff', 'created_at': '2020-01-01T00:00:00Z', 'started_at': '2020-01-01T00:00:00Z',
            'status': 'processing', 'model_status': 'processing', 'output': None, 'revision': 1, 'reviews': []})
    store.mutate(seed)
    result = vision.detail(store, 'stuck', 'staff', 'caregiver')
    assert result['status'] == 'pending_review' and result['model_status'] == 'failed'
    assert result['error_code'] == 'vision_processing_interrupted'


def test_concurrent_retries_share_one_durable_model_call(api, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    scope(api)
    photo = upload(api)
    configure(monkeypatch)
    started, release = Event(), Event()
    calls = []
    def request(*_):
        calls.append(True)
        started.set()
        assert release.wait(10)
        return visible()
    monkeypatch.setattr(vision, '_request', request)
    store = api[1]
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(vision.analyze, store, photo['id'], 'staff', 'caregiver', 'same-key')
        try:
            assert started.wait(10)
            retry = pool.submit(vision.analyze, store, photo['id'], 'staff', 'caregiver', 'same-key').result(10)
            assert retry['status'] == 'processing'
        finally:
            release.set()
        result = first.result(10)
    assert len(calls) == 1 and len(store.read()['image_analyses']) == 1
    assert retry['id'] == result['id'] and result['status'] == 'pending_review'
