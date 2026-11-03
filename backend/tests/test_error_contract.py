import asyncio
import ast
import json
from pathlib import Path

from starlette.exceptions import HTTPException

from app.main import http_error_handler, unexpected_error_handler
from app.services.error_contract import body
from test_facility import post


def test_validation_points_to_field_without_repeating_submitted_values(api):
    client, _, headers = api
    response = client.post('/api/v1/shifts', headers=headers('manager'), json={
        'name': '合成测试班次', 'start_at': '2027-01-01T08:00:00',
        'end_at': '2027-01-01T16:00:00+08:00', 'caregiver_ids': ['staff']})
    assert response.status_code == 422
    error = response.json()
    assert error['field_paths'] == ['body.start_at']
    assert error['field_errors'][0]['path'] == 'body.start_at'
    assert '2027-01-01T08:00:00' not in response.text


def test_revision_conflict_links_existing_read_resource(api, manual_payload):
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    error = post(api, '/tasks/' + task['id'] + '/transition',
                 {'action': 'cancel', 'expected_revision': task['revision'] + 1, 'note': '普通版本冲突测试'}, expected=409)
    assert error['detail'] == error['error_code'] == 'stale_revision'
    assert error['conflict_type'] == 'revision' and not error['retryable']
    resource = error['reload_resource']
    assert resource['path'] == '/tasks/' + task['id']
    client, _, headers = api
    assert client.get('/api/v1' + resource['path'], headers=headers('manager')).status_code == 200


def test_domain_time_error_locates_only_fields_in_request_model(api, manual_payload):
    from datetime import datetime, timedelta, timezone
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    result = post(api, '/records/manual', {**manual_payload, 'happened_at': future}, actor='staff', expected=422)
    assert result['field_paths'] == ['body.happened_at']


def test_public_error_contract_has_safe_defaults_for_http_failures():
    for status in (401, 403, 409, 422, 429, 500, 503):
        result = body('synthetic_error', status)
        assert result['safe_message'] and isinstance(result['field_paths'], list)
        assert result['retryable'] is (status in {429, 503})
    result = asyncio.run(http_error_handler(None, HTTPException(503, 'synthetic private provider message')))
    assert 'private provider' not in result.body.decode()
    internal = asyncio.run(unexpected_error_handler(None, RuntimeError('synthetic diagnostic only')))
    assert json.loads(internal.body)['error_code'] == 'internal_error'


def test_error_catalog_covers_literal_business_codes():
    from app.services.error_catalog import ERROR_MESSAGES, ERROR_FIELDS
    codes = set()
    for path in (Path(__file__).parents[1] / 'app').rglob('*.py'):
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            index = 0 if node.func.id == 'DomainError' else 3 if node.func.id == 'find' else None
            if index is not None and len(node.args) > index and isinstance(node.args[index], ast.Constant):
                if isinstance(node.args[index].value, str):
                    codes.add(node.args[index].value)
    assert not codes - ERROR_MESSAGES.keys()
    assert all(message and any('\u4e00' <= c <= '\u9fff' for c in message) for message in ERROR_MESSAGES.values())
    assert not ERROR_FIELDS.keys() - ERROR_MESSAGES.keys()
