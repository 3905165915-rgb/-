from app.services.ai_service import AIProviderError, MockAIProvider
from dataclasses import replace

from app.services import assistant_service, store_service


def test_mock_outputs_expose_review_fields_and_never_claim_real_model():
    provider = MockAIProvider()
    draft = provider.extract('E1', None, '老人今天想听戏')
    assert draft.model_status == 'demo'
    assert draft.suggestion
    assert draft.missing == [] and draft.ambiguity == []

    context = provider.extract_context('老人今天想听戏', {'sources': [], 'scene': 'activity'})
    assert context['model_status'] == 'demo'
    assert {'missing', 'ambiguity', 'suggestion'} <= context.keys()


def test_ai_failure_returns_safe_contract_and_preserves_original_text(api, monkeypatch):
    client, store, headers = api

    class BrokenProvider:
        name = 'deepseek:test-model'

        def extract(self, *_):
            raise AIProviderError('provider body must never reach the client')

    monkeypatch.setattr(store_service, 'get_ai_provider', lambda: BrokenProvider())
    text = '这段原文只应保存在失败草稿中'
    response = client.post('/api/v1/records/extract', headers=headers(), json={
        'elder_id': 'E1', 'text': text,
    })
    assert response.status_code == 503
    body = response.json()
    assert body['error_code'] == 'ai_unavailable'
    assert body['safe_message'] and text not in str(body)
    assert body['retryable'] is True and body['draft_preserved'] is True
    failed = next(row for row in store.read()['ai_drafts'] if row['id'] == body['draft_id'])
    assert failed['status'] == 'failed'
    assert failed['model_status'] == 'failed'
    assert failed['raw_text'] == text
    assert failed['observations'] == [] and failed['task_candidates'] == []


def test_context_ai_failure_preserves_context_kind_and_safe_error(api, monkeypatch):
    client, store, headers = api

    class BrokenProvider:
        name = 'deepseek:test-model'

        def extract_context(self, *_):
            raise AIProviderError('provider failure')

    monkeypatch.setattr(assistant_service, 'get_ai_provider', lambda: BrokenProvider())
    response = client.post('/api/v1/records/context-extract', headers=headers(), json={
        'elder_id': 'E1', 'scene': 'activity', 'text': '明天再看看',
    })
    assert response.status_code == 503
    body = response.json()
    assert body['draft_preserved'] is True and body['error_code'] == 'ai_unavailable'
    failed = next(row for row in store.read()['ai_drafts'] if row['id'] == body['draft_id'])
    assert failed['generation_kind'] == 'context_record'
    assert failed['raw_text'] == '明天再看看'


def test_ai_output_validation_rejects_model_claiming_unquoted_facts():
    text = '老人今天想听戏'
    output = {
        'observations': [text], 'task_candidates': [],
        'evidence': [{'text': text, 'type': 'observation'}], 'warnings': [],
        'missing': ['具体时间'], 'ambiguity': [], 'suggestion': ['向老人确认'],
        'model_status': 'available',
    }
    output['observations'] = ['老人需要住院']
    from app.services.ai_outputs import validate_extraction
    try:
        validate_extraction(output, text)
    except ValueError as exc:
        assert 'verbatim' in str(exc) or 'substring' in str(exc)
    else:
        raise AssertionError('unquoted observation was accepted')


def test_mock_fallback_is_always_labelled_as_demo(api, monkeypatch):
    client, _, headers = api

    class BrokenProvider:
        name = 'deepseek:test-model'

        def extract(self, *_):
            raise AIProviderError('unavailable')

    monkeypatch.setattr(store_service, 'settings', replace(store_service.settings, ai_fallback_mock=True))
    monkeypatch.setattr(store_service, 'get_ai_provider', lambda: BrokenProvider())
    response = client.post('/api/v1/records/extract', headers=headers(), json={
        'elder_id': 'E1', 'text': '老人想休息',
    })
    assert response.status_code == 200, response.text
    assert response.json()['provider'] == 'mock' and response.json()['model_status'] == 'demo'
    assert any('降级' in message for message in response.json()['warnings'])


def test_failure_recovery_cannot_attach_old_input_to_a_changed_admission(api, monkeypatch):
    client, store, headers = api
    class RacingFailure:
        name = 'deepseek:test-model'
        def extract(self, *_):
            store.mutate(lambda d: d['elders'][0].update(care_state_version=1, current_admission_id='NEW-STAY'))
            raise AIProviderError('timeout after lifecycle changed')
    monkeypatch.setattr(store_service, 'get_ai_provider', lambda: RacingFailure())
    response = client.post('/api/v1/records/extract', headers=headers(), json={'elder_id': 'E1', 'text': '旧批次原文'})
    assert response.status_code == 409, response.text
    assert response.json()['detail'] == 'draft_elder_state_changed'
    assert store.read()['ai_drafts'] == []


def test_context_without_shift_still_excludes_unrelated_shift_tasks(api):
    client, store, headers = api
    def seed(data):
        data['shifts'] = [{'id': 'S-OTHER', 'caregiver_ids': ['other'], 'status': 'open'}]
        data['care_tasks'] = [
            {'id': 'PRIVATE-TASK', 'elder_id': 'E1', 'title': '非本班私有事项', 'status': 'pending',
             'shift_id': 'S-OTHER', 'assigned_to': None, 'revision': 1},
            {'id': 'SHARED-TASK', 'elder_id': 'E1', 'title': '待认领事项', 'status': 'pending',
             'shift_id': None, 'assigned_to': None, 'revision': 1},
        ]
    store.mutate(seed)
    url = '/api/v1/records/context?elder_id=E1&scene=activity'
    before = store.path.read_bytes()
    response = client.get(url, headers=headers())
    assert response.status_code == 200, response.text
    assert {row['object_id'] for row in response.json()['sources']} == {'SHARED-TASK'}
    assert 'PRIVATE-TASK' not in response.text
    assert client.get(url, headers=headers('family')).status_code == 403
    assert store.path.read_bytes() == before
    response = client.post('/api/v1/records/context-extract', headers=headers(), json={
        'elder_id': 'E1', 'text': '今天想休息', 'scene': 'activity',
    })
    assert response.status_code == 200, response.text
    assert 'PRIVATE-TASK' not in str(response.json()['context_snapshot'])


def test_validation_error_does_not_echo_private_care_narrative(api):
    client, _, headers = api
    private = 'PRIVATE-CARE-NARRATIVE-MUST-NOT-ECHO'
    response = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': 'E1', 'raw_text': private, 'observations': [{'content': private}],
    })
    assert response.status_code == 422
    assert response.json()['error_code'] == 'invalid_request'
    assert private not in response.text and 'input' not in str(response.json()['detail'])
