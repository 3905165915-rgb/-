"""Opt-in vendor checks. Synthetic data only; ordinary pytest never calls a cloud API.

Run through deploy/acceptance.py. Keys are inherited from a private EnvironmentFile,
never supplied as command-line arguments or written to the evidence directory.
"""
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import time

import pytest

from app.core import config
from app.services import ai_service, speech_service
from scripts.evaluate_ai import evaluate
from test_facility import ROOT, legacy, post
from test_assistant import create_memory
from test_handovers import prepare
from test_planning import source, assessment_body, plan_body, review_assessment, review_plan

pytestmark = pytest.mark.skipif(os.getenv('RUN_REAL_AI') != '1', reason='Opt-in real vendor acceptance only')
CASES = json.loads((Path(__file__).resolve().parents[1] / 'evaluation' / 'cases.json').read_text(encoding='utf-8'))


def evidence(name, value):
    directory = Path(os.environ['LIVE_EVIDENCE_DIR'])
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


@pytest.fixture
def real_ai(api, monkeypatch, request):
    actual = config.get_settings()
    assert actual.deepseek_api_key, 'Real DeepSeek key is not configured'
    assert actual.deepseek_model == 'deepseek-flash', 'Acceptance must use the user-approved model'
    configured = replace(config.settings, ai_provider='deepseek', ai_fallback_mock=False,
                         deepseek_api_key=actual.deepseek_api_key, deepseek_model=actual.deepseek_model,
                         deepseek_base_url=actual.deepseek_base_url, deepseek_timeout_seconds=45,
                         siliconflow_api_key=actual.siliconflow_api_key, speech_model=actual.speech_model)
    monkeypatch.setattr(ai_service, 'settings', configured)
    monkeypatch.setattr(speech_service, 'settings', configured)
    original_post = ai_service.httpx.post
    original_async_post = speech_service.httpx.AsyncClient.post
    calls = []
    def traced_post(url, **kwargs):
        started = time.monotonic()
        metadata = {'service': 'deepseek', 'requested_model': kwargs.get('json', {}).get('model')}
        try:
            response = original_post(url, **kwargs)  # Real network, unchanged response.
            metadata['http_status'] = response.status_code
            try:
                body = response.json()
                metadata['returned_model'] = body.get('model')
                metadata['tokens'] = {key: body.get('usage', {}).get(key) for key in ('prompt_tokens', 'completion_tokens', 'total_tokens')}
                choices = body.get('choices')
                if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                    message = choices[0].get('message')
                    if isinstance(message, dict) and isinstance(message.get('content'), str):
                        # Synthetic opt-in inputs only. Capture rejected output too;
                        # no request headers, keys or live elder records are logged.
                        name = hashlib.sha256(request.node.nodeid.encode()).hexdigest()[:12]
                        evidence('provider-output-' + name, {'test': request.node.name, 'content': message['content']})
            except (ValueError, AttributeError):
                pass
            return response
        except ai_service.httpx.HTTPError as exc:
            metadata['transport_error_type'] = type(exc).__name__
            raise
        finally:
            metadata['elapsed_seconds'] = round(time.monotonic() - started, 3)
            calls.append(metadata)
    async def traced_async_post(client, url, **kwargs):
        started = time.monotonic()
        metadata = {'service': 'speech', 'requested_model': kwargs.get('data', {}).get('model')}
        try:
            response = await original_async_post(client, url, **kwargs)
            metadata['http_status'] = response.status_code
            return response
        except speech_service.httpx.HTTPError as exc:
            metadata['transport_error_type'] = type(exc).__name__
            raise
        finally:
            metadata['elapsed_seconds'] = round(time.monotonic() - started, 3)
            calls.append(metadata)
    monkeypatch.setattr(ai_service.httpx, 'post', traced_post)
    monkeypatch.setattr(speech_service.httpx.AsyncClient, 'post', traced_async_post)
    try:
        yield api
    finally:
        evidence('network-' + hashlib.sha256(request.node.nodeid.encode()).hexdigest()[:12],
                 {'test': request.node.name, 'calls': calls})


@pytest.mark.parametrize('case', CASES, ids=[row['id'] for row in CASES])
def test_real_extraction(real_ai, case):
    client, store, headers = real_ai
    started = time.monotonic()
    result = client.post(ROOT + '/records/extract', json={'elder_id': 'E1', 'text': case['text']}, headers=headers())
    elapsed = time.monotonic() - started
    assert result.status_code == 200, result.text
    draft = result.json()
    # The API decorates validated model tasks with server-generated review
    # notes. The offline evaluator expects the strict provider object; verify
    # the decoration separately and remove only this known transport field.
    extracted_tasks = []
    for task in draft['task_candidates']:
        candidate = dict(task)
        notes = candidate.pop('review_notes', [])
        assert isinstance(notes, list) and all(isinstance(note, str) for note in notes)
        extracted_tasks.append(candidate)
    prediction = {'case_id': case['id'], 'provider': draft['provider'],
                  'output': {**{field: draft[field] for field in ('observations', 'evidence', 'warnings')},
                             'task_candidates': extracted_tasks}}
    score = evaluate([case], [prediction])
    evidence('extract-' + case['id'], {'prediction': prediction, 'score': score, 'elapsed_seconds': round(elapsed, 3)})
    assert draft['provider'] == 'deepseek:deepseek-flash'
    assert draft['status'] == 'pending_review'
    assert not store.read()['care_tasks'] and not store.read()['care_records']
    assert score['valid_structure_and_quotes']['count'] == 1
    assert score['required_span_coverage']['hits'] == score['required_span_coverage']['total']
    assert score['task_recall']['hits'] == score['task_recall']['expected']
    assert score['task_precision']['hits'] == score['task_precision']['predicted']


def test_real_context_separates_current_wish_and_effective_history(real_ai):
    api = real_ai
    client, store, headers = api
    legacy(api)
    create_memory(api)
    rec = source(api)
    assessment = review_assessment(api, post(api, '/assessments', assessment_body(rec)))
    plan = review_plan(api, post(api, '/care-plans', plan_body(assessment)))
    text = '老人本人说今天不想参加活动，今天想先休息，请明天再问本人意愿。'
    before_records = len(store.read()['care_records'])
    before_tasks = len(store.read()['care_tasks'])
    result = client.post(ROOT + '/records/context-extract', json={'elder_id': 'E1', 'scene': 'activity', 'text': text}, headers=headers())
    assert result.status_code == 200, result.text
    draft = result.json()
    evidence('context', draft)
    assert draft['provider'] == 'deepseek:deepseek-flash' and draft['status'] == 'pending_review'
    assert all(row in text for row in draft['observations'])
    sources = draft['context_snapshot']['sources']
    assert any(row['kind'] == 'memory' for row in sources)
    assert any(row['object_id'] == plan['id'] for row in sources)
    assert draft['context_notes'], 'Real contextual reminders should cite the supplied history'
    assert any(row['category'] == 'temporary_wish' for row in draft['memory_candidates'])
    assert not any(row['category'] == 'stable_preference' for row in draft['memory_candidates'])
    assert len(store.read()['care_records']) == before_records and len(store.read()['care_tasks']) == before_tasks
    assert all(row['status'] != 'candidate' for row in store.read()['care_memories'])


def test_real_handover_and_quality_remain_human_reviewed(real_ai):
    api = real_ai
    client, store, headers = api
    text = '老人今天没有外出，午餐吃了一半。如果晚餐仍进食较少，再联系家属。'
    payload = {'elder_id': 'E1', 'raw_text': text, 'observations': ['老人今天没有外出', '午餐吃了一半'],
               'task_candidates': [{'title': '联系家属反馈进餐情况', 'condition': '如果晚餐仍进食较少'}]}
    _, _, created, handover = prepare(api, payload)
    url = f'/handovers/{handover["id"]}'
    before = store.read()['care_tasks']
    summary = post(api, url + '/ai-summary', {'expected_revision': handover['revision']}, actor='staff', expected=200)
    evidence('handover', summary)
    assert summary['status'] == 'draft' and summary['ai_summary']['status'] == 'pending_review'
    assert summary['ai_summary']['provider'] == 'deepseek:deepseek-flash'
    # Staff responses deliberately omit unrestricted internal source IDs.
    # Check complete coverage against the persisted generation, then verify
    # the staff-facing result contains evidence for the authorized task.
    persisted = next(row for row in store.read()['handovers'] if row['id'] == handover['id'])
    assert not persisted['ai_summary']['uncovered_task_ids']
    assert any(c['source_id'] == created['tasks'][0]['id']
               for point in summary['ai_summary']['points'] for c in point['citations'])
    assert '没有外出' in summary['ai_summary']['text']
    assert '如果晚餐仍进食较少' in summary['ai_summary']['text']
    assert store.read()['care_tasks'] == before
    report = post(api, '/quality/checks', {'handover_id': handover['id'], 'include_ai': True})
    evidence('quality', report)
    assert report['provider'] == 'deepseek:deepseek-flash'
    assert all(row['status'] == 'pending_review' for row in report['issues'])
    assert store.read()['care_tasks'] == before
    assert client.post(ROOT + f'/tasks/{created["tasks"][0]["id"]}/complete', json={'result': '条件尚未核验不能完成'}, headers=headers()).status_code == 409
    submitted = post(api, url + '/submit', {'expected_revision': summary['revision'], 'approve_ai_summary': True}, actor='staff', expected=200)
    assert submitted['ai_summary']['status'] == 'confirmed'


def test_real_speech_preserves_negation_and_does_not_save(real_ai):
    client, store, headers = real_ai
    assert speech_service.settings.siliconflow_api_key, 'Real speech key is not configured'
    audio = Path(os.environ['LIVE_SYNTHETIC_AUDIO']).read_bytes()
    speech_service.validate_wav(audio)
    before = hashlib.sha256(store.path.read_bytes()).hexdigest()
    result = client.post(ROOT + '/speech/transcriptions', content=audio,
                         headers={**headers(), 'Content-Type': 'audio/wav'})
    assert result.status_code == 200, result.text
    body = result.json()
    evidence('speech', body)
    assert body['provider'] == 'siliconflow' and body['model'] == speech_service.settings.speech_model
    assert body['requires_confirmation'] is True and body['saved'] is False
    assert '没有外出' in body['text']
    assert hashlib.sha256(store.path.read_bytes()).hexdigest() == before


def test_real_configuration_failure_retains_manual_entry(real_ai, monkeypatch):
    client, store, headers = real_ai
    monkeypatch.setattr(ai_service, 'settings', replace(ai_service.settings, deepseek_api_key=''))
    failed = client.post(ROOT + '/records/extract', json={'elder_id': 'E1', 'text': '仅用于缺密钥错误处理验收'}, headers=headers())
    assert failed.status_code == 503
    body = failed.json()
    assert body['draft_preserved'] is True
    drafts = store.read()['ai_drafts']
    assert len(drafts) == 1 and drafts[0]['id'] == body['draft_id']
    assert drafts[0]['status'] == 'failed' and drafts[0]['model_status'] == 'failed'
    assert drafts[0]['raw_text'] == '仅用于缺密钥错误处理验收'
    assert not drafts[0]['observations'] and not drafts[0]['task_candidates']
    manual = client.post(ROOT + '/records/manual', json={'elder_id': 'E1', 'raw_text': 'AI不可用时仍可人工登记。'}, headers=headers())
    assert manual.status_code == 201 and len(store.read()['care_records']) == 1


def test_real_impression_review_activation_and_scene_hint(real_ai):
    """Exercise the complete new chain with synthetic records, never live data."""
    from test_impressions import PATH, records

    client, store, headers = real_ai
    rows = records(real_ai, 6)
    before_tasks = store.read()['care_tasks']
    generated = client.post(PATH + '/generate', headers=headers())
    assert generated.status_code == 200, generated.text
    report = generated.json()
    evidence('impression', report)
    assert report['provider'] == 'deepseek:deepseek-flash'
    assert report['coverage']['record_count'] == 6 and report['source_current']
    assert not store.read()['care_memories']
    eligible = [p for p in report['points'] if p['kind'] == 'trend' and p['category'] != 'attention']
    assert eligible, 'Six dated fictional preference statements should yield a grounded repeated pattern'
    point = eligible[0]
    endpoint = PATH + f'/{report["id"]}/points/{point["id"]}'
    reviewed = client.post(endpoint + '/review', headers=headers('manager'), json={
        'expected_revision': point['revision'], 'decision': 'confirmed',
        'note': '仅为虚构接口验收：已核实生活偏好，当次意愿优先'})
    assert reviewed.status_code == 200, reviewed.text
    point = next(p for p in reviewed.json()['points'] if p['id'] == point['id'])
    citation = point['citations'][0]
    source = next(r for r in rows if r['id'] == citation['source_id'])
    body = {'expected_revision': point['revision'], 'reason': '虚构验收：主管明确同意加入活动提示',
        'content': '午后活动前询问是否愿意听吕剧，当次意愿优先',
        'category': 'stable_preference', 'scenes': ['activity'], 'attributed_to': 'elder',
        'source_record_id': source['id'], 'source_revision': source['revision'],
        'source_field': 'observations', 'source_quote': citation['quote']}
    activated = client.post(endpoint + '/activate-memory', headers={
        **headers('manager'), 'Idempotency-Key': 'real-synthetic-memory'}, json=body)
    assert activated.status_code == 200, activated.text
    memory = activated.json()
    assert memory['effective'] and memory['status'] == 'confirmed'
    scene = client.get('/api/v1/memories/context?elder_id=E1&scene=activity', headers=headers()).json()
    assert [m['id'] for m in scene['memories']] == [memory['id']]
    assert client.get('/api/v1/memories/context?elder_id=E1&scene=dining', headers=headers()).json()['memories'] == []
    assert store.read()['care_tasks'] == before_tasks
    evidence('impression-scene-hint', {'memory': memory, 'scene': scene})
