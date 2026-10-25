"""Explicit opt-in DeepSeek vision acceptance with synthetic images and private keys.

RUN_REAL_VISION=1 enables cloud calls. Ordinary regression never calls a vendor.
Neither the live JSON store nor real resident photos are read or modified.
"""
from dataclasses import replace
from io import BytesIO
import json
import os
from pathlib import Path

import httpx
from PIL import Image, ImageDraw
import pytest

from app.core import config
from app.services import vision_service as vision
from test_facility import ROOT, post
from test_photos import scope, upload


pytestmark = pytest.mark.skipif(
    os.getenv('RUN_REAL_VISION') != '1', reason='Opt-in real DeepSeek vision acceptance only')


def sample_image(blank=False):
    """Code-drawn blanket, water cup and table; not a clinical/photo-quality benchmark."""
    image = Image.new('RGB', (640, 480), '#080808' if blank else '#eee7dc')
    if not blank:
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((30, 45, 335, 420), radius=20, fill='#346dcc')
        for y in range(75, 400, 35):
            draw.line((45, y, 320, y), fill='#739ce7', width=3)
        draw.rounded_rectangle((425, 120, 550, 355), radius=12,
                               fill='#f6fbff', outline='#718496', width=5)
        draw.rectangle((432, 245, 543, 340), fill='#a8d6ec')
        draw.ellipse((425, 108, 550, 132), fill='#eefaff', outline='#718496', width=4)
        draw.arc((520, 165, 605, 290), 260, 100, fill='#718496', width=8)
    content = BytesIO()
    image.save(content, 'PNG')
    return content.getvalue()


@pytest.fixture
def live_vision(api, monkeypatch, request):
    actual = config.get_settings()
    assert actual.vision_api_key, 'Private vision key is not configured'
    assert actual.vision_model == 'deepseek-flash', 'Use the approved DeepSeek Flash model'
    assert actual.vision_base_url in {'https://api.deepseek.com', 'https://api.deepseek.com/v1'}
    monkeypatch.setattr(config, 'settings', replace(
        config.settings, vision_api_key=actual.vision_api_key,
        vision_model=actual.vision_model, vision_base_url=actual.vision_base_url,
        vision_timeout_seconds=45))
    scope(api)
    metadata = {'test': request.node.name, 'input': 'synthetic_code_drawn_image',
                'model': actual.vision_model, 'production_mutations': 0, 'calls': []}
    original = vision._request

    def traced(content, settings):
        row = {'provider': 'deepseek'}
        metadata['calls'].append(row)
        try:
            result = original(content, settings)
            row['result'] = 'returned'
            return result
        except httpx.HTTPStatusError as exc:
            row.update(result='http_error', status_code=exc.response.status_code)
            raise
        except Exception as exc:
            row.update(result='failed', error_type=type(exc).__name__)
            raise

    monkeypatch.setattr(vision, '_request', traced)
    try:
        yield api, metadata
    finally:
        directory = Path(os.getenv('LIVE_VISION_EVIDENCE_DIR', '.test-runs/real-vision-evidence'))
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (request.node.name + '.json')).write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')


def test_real_deepseek_vision_review_and_record_link(live_vision):
    api, evidence = live_vision
    client, store, headers = api
    photo = upload(api, content=sample_image())
    path = ROOT + '/attachments/' + photo['id'] + '/analyze'
    options = {**headers(), 'Idempotency-Key': 'real-vision-synthetic'}
    response = client.post(path, headers=options)
    assert response.status_code == 200
    draft = response.json()
    evidence['analysis'] = draft
    assert draft['model_status'] == 'visible_observations', 'Inspect private synthetic evidence for provider status'
    assert draft['warning'] == vision.WARNING and draft['status'] == 'pending_review'
    assert draft['output']['observations']
    assert not store.read()['care_records'], 'Model output must not become a record automatically'
    assert client.post(path, headers=options).json() == draft
    assert len(evidence['calls']) == 1, 'Idempotent retry must not repeat a paid call'
    assert client.get(ROOT + '/attachments/' + photo['id'] + '/content', headers=headers('family')).status_code == 403

    pending = post(api, '/attachments/analyses/' + draft['id'] + '/review', {
        'expected_revision': draft['revision'], 'decision': 'request_management',
        'observations': ['演示图中可见蓝色布面和杯子，已人工修改核对。'],
        'note': '合成演示图，仅用于接口验收'}, actor='staff', expected=200)
    payload = {'expected_revision': pending['revision'], 'decision': 'confirm',
               'observations': ['经人工核对，演示图中可见蓝色布面和杯子。'],
               'note': '合成图人工确认，不作医疗判断'}
    confirmed = post(api, '/attachments/analyses/' + draft['id'] + '/review', payload,
                     expected=200, key='real-vision-review')
    assert post(api, '/attachments/analyses/' + draft['id'] + '/review', payload,
                expected=200, key='real-vision-review') == confirmed
    data = store.read()
    assert len(data['care_records']) == 1 and not data['care_tasks'] and not data['care_memories']
    record = data['care_records'][0]
    assert record['source_attachment_ids'] == [photo['id']]
    assert record['source_image_analysis_id'] == draft['id']
    assert confirmed['reviews'][-1]['edited']
    evidence['review'] = confirmed
    evidence['verified'] = ['real_image_input', 'non_diagnostic_warning', 'human_edit',
                            'management_review', 'atomic_record_link', 'idempotency', 'family_denied']


def test_real_deepseek_vision_dark_image_is_unknown_and_discardable(live_vision):
    api, evidence = live_vision
    photo = upload(api, content=sample_image(blank=True))
    draft = post(api, '/attachments/' + photo['id'] + '/analyze', {},
                 actor='staff', expected=200, key='real-vision-dark')
    evidence['analysis'] = draft
    assert draft['model_status'] == 'unable_to_determine', 'Dark image must not produce invented observations'
    assert draft['output']['observations'] == [] and draft['notice'] == vision.UNKNOWN
    rejected = post(api, '/attachments/analyses/' + draft['id'] + '/review', {
        'expected_revision': draft['revision'], 'decision': 'reject', 'observations': [],
        'note': '过暗无法核实，放弃本次识别'}, actor='staff', expected=200)
    assert rejected['status'] == 'rejected' and not api[1].read()['care_records']
    assert len(evidence['calls']) == 1
    evidence['verified'] = ['real_image_input', 'unknown_without_claims', 'human_reject_no_record']
