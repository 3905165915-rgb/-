from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest

from app.services import ai_service, quality_service, record_job_service
from app.services.candidate_service import groups
from app.schemas.api import QualityScanRequest
from test_facility import post, ROOT
from test_notifications import notices
from test_incidents import report as incident


def test_pagination_filters_counts_and_legacy_responses(api, manual_payload):
    client, _, headers = api
    for title in ('联系家属', '安排散步', '整理床铺'):
        post(api, '/records/manual', {**manual_payload, 'task_candidates': [{'title': title}]}, actor='staff')
    for path in ('/records', '/tasks'):
        assert isinstance(client.get(ROOT + path, headers=headers()).json(), list)
        result = client.get(ROOT + path + '?envelope=true&limit=1&offset=1', headers=headers()).json()
        assert result['total'] == 3 and len(result['items']) == 1
        assert result['timezone'] == 'Asia/Shanghai'
    result = client.get(ROOT+'/tasks?envelope=true&q=联系', headers=headers()).json()
    assert result['total'] == 1 and result['items'][0]['title'] == '联系家属'
    assert client.get(ROOT+'/records?envelope=true', headers=headers('family')).status_code == 403


def test_background_job_receipt_failure_retry_and_no_second_record(api, monkeypatch):
    client, store, headers = api
    result = post(api, '/elders/E1/record', {'text': '王爷爷喜欢听京剧。', 'background': True}, actor='staff', key='record')
    assert result['saved'] and result['job']['status'] == 'queued'
    assert result['job']['job_id'] and result['job']['source_revision'] == 1
    class Broken(ai_service.MockAIProvider):
        def extract(self, *args):
            raise ai_service.AIProviderError('private-provider-response')
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: Broken())
    assert record_job_service.process_inline_next(store)
    path = '/elders/E1/records/' + result['record']['id']
    failed = client.get(ROOT + path+'/analysis', headers=headers()).json()
    assert failed['job']['retryable'] and failed['job']['status'] == 'failed'
    assert 'private-provider' not in str(failed)
    post(api, path+'/analyze?background=true', None, actor='staff', expected=200)
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: ai_service.MockAIProvider())
    assert record_job_service.process_inline_next(store)
    ready = client.get(ROOT + path+'/analysis', headers=headers()).json()
    assert ready['job']['result_ref'] and ready['job']['attempts'] == 2
    assert len(store.read()['care_records']) == 1


def test_quality_config_partial_empty_and_idempotency(api, manual_payload, monkeypatch):
    from dataclasses import replace
    from app.core import config
    client, store, headers = api
    monkeypatch.setattr(config, 'settings', replace(config.settings, quality_ai_enabled=True))
    class Broken(ai_service.MockAIProvider):
        def quality(self, sources):
            raise ai_service.AIProviderError('private')
    monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: Broken())
    empty = post(api, '/quality/checks', {'elder_id': 'E1'})
    assert not empty['has_sources'] and empty['model_status'] == 'not_requested'
    post(api, '/records/manual', manual_payload, actor='staff')
    first = post(api, '/quality/checks', {'elder_id': 'E1'}, key='scan')
    assert first['execution_status'] == 'partial' and first['rule_status'] == 'completed'
    assert first['model_status'] == 'failed' and first['issues']
    assert post(api, '/quality/checks', {'elder_id': 'E1'}, key='scan') == first
    post(api, '/quality/checks', {'include_ai': False}, key='scan', expected=409)
    assert len(store.read()['quality_checks']) == 2
    assert client.get(ROOT+'/quality/checks?envelope=true&limit=1', headers=headers('manager')).json()['total'] == 2


def test_quality_deduplicates_findings_and_revalidates_sources(api, manual_payload, monkeypatch):
    client, _, headers = api
    record = post(api, '/records/manual', manual_payload, actor='staff')['record']
    class Repeated(ai_service.MockAIProvider):
        def quality(self, sources):
            item = {'title': '请核对', 'explanation': '可能有歧义',
                    'citations': [{'source_id': record['id'], 'quote': manual_payload['raw_text']}]}
            return {'findings': [item, item]}
    monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: Repeated())
    body = {'elder_id': 'E1', 'include_ai': True}
    qc = post(api, '/quality/checks', body, key='findings-replay')
    assert post(api, '/quality/checks', body, key='findings-replay') == qc
    assert len(api[1].read()['quality_checks']) == 1
    assert sum(i['type'] == 'ai_suggestion' for i in qc['issues']) == 1
    post(api, '/records/'+record['id']+'/corrections', {'expected_revision': 1,
         'observations': ['午餐已人工复核'], 'reason': '现场核实'}, actor='staff', expected=200)
    current = client.get(ROOT+'/quality/checks/'+qc['id'], headers=headers('manager')).json()
    assert not current['source_current']
    post(api, '/quality/checks/'+qc['id']+'/issues/'+qc['issues'][0]['id']+'/resolve',
         {'status': 'acknowledged', 'note': '旧依据不能直接确认'}, expected=409)


def test_concurrent_scans_keep_one_unchanged_report(api, manual_payload):
    post(api, '/records/manual', manual_payload, actor='staff')
    store = api[1]
    def scan(_):
        return quality_service.scan(store, QualityScanRequest(elder_id='E1', include_ai=False), 'manager')['id']
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert len(set(pool.map(scan, range(2)))) == 1


def test_batch_transfer_is_previewed_isolated_idempotent_and_management_only(api, manual_payload):
    client, store, headers = api
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    body = {'action': 'transfer', 'note': '同班转交', 'items': [
        {'id': task['id'], 'expected_revision': 1, 'assigned_to': 'other'},
        {'id': 'missing-task', 'expected_revision': 1, 'assigned_to': 'other'}]}
    before = store.path.read_bytes()
    preview = post(api, '/tasks/batch/preview', body, expected=200)
    assert preview['succeeded'] == 1 and preview['failed'] == 1
    assert store.path.read_bytes() == before
    result = post(api, '/tasks/batch/transfer', body, key='transfer', expected=200)
    assert result['items'][1]['error_code'] == 'task_not_found'
    assert post(api, '/tasks/batch/transfer', body, key='transfer', expected=200) == result
    assert store.read()['care_tasks'][0]['revision'] == 2
    post(api, '/tasks/batch/transfer', body, actor='staff', key='no', expected=403)
    post(api, '/tasks/batch/transfer', {**body, 'note': 'different'}, key='transfer', expected=409)
    post(api, '/tasks/batch/transfer', {**body, 'items': [body['items'][0]]*51}, key='too-many', expected=422)
    post(api, '/tasks/batch/transfer', {**body, 'items': [body['items'][0]]*2}, key='duplicate', expected=422)


def test_batch_read_never_closes_incidents_or_other_users_messages(api):
    _, store, _ = api
    incident(api)
    notice = notices(api)[0]
    body = {'action': 'read', 'items': [{'id': notice['id'], 'expected_revision': notice['revision']},
                                     {'id': 'not-found', 'expected_revision': 1}]}
    denied = post(api, '/notifications/batch/read', body, actor='other', key='denied', expected=200)
    assert denied['succeeded'] == 0 and denied['items'][0]['status_code'] == 403
    result = post(api, '/notifications/batch/read', body, key='read', expected=200)
    assert result['succeeded'] == result['failed'] == 1
    assert post(api, '/notifications/batch/read', body, key='read', expected=200) == result
    assert store.read()['incidents'][0]['status'] == 'reported'
    assert notices(api, unread=True) == []
    assert notices(api, pending=True)


def test_display_grouping_keeps_negation_time_and_evidence():
    rows = [{'id': 'a', 'content': '喜欢听京剧', 'category': 'preference', 'evidence': ['R1']},
            {'id': 'b', 'content': '喜欢听京剧。', 'category': 'preference', 'evidence': ['R2']},
            {'id': 'c', 'content': '今天不喜欢听京剧', 'category': 'preference', 'evidence': ['R3']}]
    result = groups(rows)
    assert len(result) == 2 and result[0]['count'] == 2
    assert [i['evidence'] for i in result[0]['items']] == [['R1'], ['R2']]
    assert result[1]['items'][0]['content'] == '今天不喜欢听京剧'


def test_followup_pagination_keeps_latest_issue_per_source(api, manual_payload):
    client, store, headers = api
    post(api, '/records/manual', manual_payload, actor='staff')
    qc = post(api, '/quality/checks', {'elder_id': 'E1', 'include_ai': False})
    def older(data):
        from copy import deepcopy
        copy = deepcopy(qc)
        copy['id'] = 'older'
        for issue in copy['issues']:
            issue['id'] += '-older'
        data['quality_checks'].insert(0, copy)
    store.mutate(older)
    result = client.get(ROOT+'/followups?elder_id=E1&limit=1&state=review', headers=headers('manager')).json()
    assert result['total'] == len(qc['issues']) and len(result['items']) == 1
    assert result['counts']['review'] == result['total']


def test_today_checks_use_policy_without_holding_write_lock(api, manual_payload, monkeypatch):
    from dataclasses import replace
    from app.core import config
    post(api, '/records/manual', manual_payload, actor='staff')
    monkeypatch.setattr(config, 'settings', replace(config.settings, quality_ai_enabled=True))
    calls = []
    class Concurrent(ai_service.MockAIProvider):
        def quality(self, sources):
            # A separate writer must finish while the provider is still running.
            with ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(api[1].mutate, lambda d: d.update(test_measurement='lock-free')).result(timeout=3)
            calls.append(True)
            raise ai_service.AIProviderError('unavailable')
    monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: Concurrent())
    result = post(api, '/elders/E1/followups/check-today', {}, expected=200, key='partial-today')
    assert [r['status'] for r in result['checks']] == ['partial', 'completed']
    assert calls == [True]
    assert post(api, '/elders/E1/followups/check-today', {}, expected=200, key='partial-today') == result
    assert len(calls) == 1 and len(api[1].read()['quality_checks']) == 1


def test_quality_large_scope_preserves_rules_and_historical_report_is_readable(api, manual_payload, monkeypatch):
    from copy import deepcopy
    record = post(api, '/records/manual', manual_payload, actor='staff')['record']
    def many(data):
        for i in range(101):
            data['care_records'].append({**deepcopy(record), 'id': 'many-'+str(i)})
    api[1].mutate(many)
    monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: pytest.fail('oversize input must not reach model'))
    qc = post(api, '/quality/checks', {'elder_id': 'E1', 'include_ai': True})
    assert qc['execution_status'] == 'partial' and qc['rule_status'] == 'completed' and qc['issues']
    def legacy(data):
        data['quality_checks'][0].pop('source_fingerprint')
    api[1].mutate(legacy)
    view = api[0].get(ROOT+'/quality/checks/'+qc['id'], headers=api[2]('manager')).json()
    assert view['source_current'] is False


def test_concurrent_scans_with_one_key_persist_one_receipt_even_after_double_click_window(api, manual_payload, monkeypatch):
    from threading import Barrier
    post(api, '/records/manual', manual_payload, actor='staff')
    barrier = Barrier(2)
    class Concurrent(ai_service.MockAIProvider):
        def quality(self, sources):
            barrier.wait(timeout=5)
            return {'findings': []}
    monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: Concurrent())
    def scan(_):
        return quality_service.scan(api[1], QualityScanRequest(elder_id='E1', include_ai=True), 'manager', 'same-key')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(scan, range(2)))
    assert results[0] == results[1]
    assert len(api[1].read()['quality_checks']) == 1
    assert len([r for r in api[1].read()['idempotency_keys'] if r['action'] == 'quality_scan_request']) == 1


@pytest.mark.parametrize('text,expected', [
    ('今晚九点联系家属', '2026-10-28T21:00:00+08:00'),
    ('明晚九点联系家属', '2026-10-29T21:00:00+08:00'),
    ('今早九点联系家属', '2026-10-28T09:00:00+08:00'),
    ('明早九点联系家属', '2026-10-29T09:00:00+08:00')])
def test_relative_clock_anchors_to_event_in_beijing(text, expected):
    from app.services.elder_workspace_service import time_proposal
    record = {'happened_at': '2026-10-27T23:30:00Z', 'created_at': '2026-10-30T10:00:00Z'}
    result = time_proposal(text, record)
    assert result['suggested_at'] == expected and result['original_expression'] == text
    assert result['timezone'] == 'Asia/Shanghai'


def test_grouping_never_combines_different_expiry_or_negation():
    rows = [{'id': 'a', 'content': '喜欢听京剧', 'expires_at': '2026-10-28T21:00:00+08:00'},
            {'id': 'b', 'content': '喜欢听京剧', 'expires_at': '2026-10-29T21:00:00+08:00'},
            {'id': 'c', 'content': '不喜欢听京剧', 'expires_at': '2026-10-28T21:00:00+08:00'}]
    assert len(groups(rows)) == 3


def test_batch_missing_key_stale_revision_and_condition_require_individual_review(api, manual_payload):
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    body = {'action': 'transfer', 'items': [{'id': task['id'], 'expected_revision': 99, 'assigned_to': 'other'}]}
    post(api, '/tasks/batch/transfer', body, expected=422)
    result = post(api, '/tasks/batch/transfer', body, key='old-version', expected=200)
    assert result['failed'] == 1 and result['items'][0]['error_code'] == 'stale_revision'
    api[1].mutate(lambda d: d['care_tasks'][0].update(condition='本人愿意'))
    body['items'][0]['expected_revision'] = 1
    result = post(api, '/tasks/batch/transfer', body, key='conditional', expected=200)
    assert result['failed'] == 1 and result['items'][0]['error_code'] == 'batch_task_requires_individual_review'
    assert api[1].read()['care_tasks'][0]['revision'] == 1


def test_rejected_evidence_is_suppressed_but_new_version_can_be_reviewed_and_edits_count(api, monkeypatch):
    from copy import deepcopy
    from test_impressions import records, Provider
    from app.services import impression_service
    monkeypatch.setattr(impression_service, 'get_ai_provider', lambda: Provider())
    records(api)
    report = post(api, '/elders/E1/impressions/generate', None, actor='staff', expected=200)
    point = report['points'][0]
    path = '/elders/E1/understanding/'+report['id']+'/'+point['id']+'/decision'
    post(api, path, {'expected_revision': 1, 'decision': 'reject'}, expected=200)
    def new_report(data):
        row = deepcopy(report)
        row['id'] = 'new-report'
        row['points'][0].update(status='candidate', revision=1)
        data['elder_impressions'].append(row)
    api[1].mutate(new_report)
    def view():
        return api[0].get(ROOT+'/elders/E1/understanding', headers=api[2]('manager')).json()
    assert view()['observations'] == []
    def corrected(data):
        data['care_records'][0]['revision'] = 2
        data['elder_impressions'][-1]['sources'][0]['revision'] = 2
    api[1].mutate(corrected)
    assert len(view()['observations']) == 1
    post(api, '/elders/E1/understanding/new-report/'+point['id']+'/decision',
         {'expected_revision': 1, 'decision': 'adopt', 'content': '午后喜欢听吕剧，先询问本人意愿'}, expected=200)
    stats = api[0].get(ROOT+'/ai-governance/operations', headers=api[2]('manager')).json()['personal_impressions']
    assert stats == {'reviewed': 2, 'adopted': 1, 'rejected': 1, 'edited': 1}


def test_http_errors_have_chinese_safe_feedback(api):
    for path in ('/api/v1/not-existing', '/api/v1/elders/E1'):
        response = api[0].get(path)
        assert response.status_code in {401, 404}
        assert any('\u4e00' <= char <= '\u9fff' for char in response.json()['safe_message'])


def test_duplicate_candidates_preview_archive_and_conflict_without_deleting_sources(api):
    from test_memories import propose
    record = post(api, '/records/manual', {'elder_id': 'E1', 'raw_text': '本人说喜欢听京剧',
         'observations': ['本人说喜欢听京剧']}, actor='staff')['record']
    body = {'elder_id': 'E1', 'content': '喜欢听京剧', 'category': 'stable_preference',
            'scenes': ['activity'], 'attributed_to': 'elder', 'source_record_id': record['id'],
            'source_revision': 1, 'source_quote': '本人说喜欢听京剧', 'valid_from': '2026-10-28T08:00:00+08:00'}
    a, b = propose(api, body), propose(api, body)
    request = {'keep': {'id': a['id'], 'expected_revision': 1},
               'duplicates': [{'id': b['id'], 'expected_revision': 1}], 'reason': '主管核对确为同一原文重复候选'}
    path = '/elders/E1/understanding/duplicates/'
    before = api[1].path.read_bytes()
    preview = post(api, path+'preview', request, expected=200)
    assert preview['keep']['status'] == 'candidate' and api[1].path.read_bytes() == before
    result = post(api, path+'confirm', request, expected=200, key='duplicates')
    assert result['keep']['status'] == 'candidate' and result['duplicates'][0]['status'] == 'rejected'
    assert result['duplicates'][0]['duplicate_of'] == a['id']
    assert post(api, path+'confirm', request, expected=200, key='duplicates') == result
    assert len(api[1].read()['care_memories']) == 2 and len(api[1].read()['care_records']) == 1
    post(api, path+'confirm', request, expected=409, key='stale-duplicates')
    post(api, path+'preview', request, actor='staff', expected=403)
    # A different content or independent source must not be silently folded away.
    c = propose(api, {**body, 'content': '今天不想听京剧'})
    post(api, path+'preview', {'keep': {'id': a['id'], 'expected_revision': 2},
         'duplicates': [{'id': c['id'], 'expected_revision': 1}], 'reason': '核对差异'}, expected=409)


def test_unchanged_confirmed_trait_keeps_new_evidence_without_repeated_review(api, monkeypatch):
    from test_impressions import records, Provider
    from app.services import impression_service
    from copy import deepcopy
    monkeypatch.setattr(impression_service, 'get_ai_provider', lambda: Provider())
    records(api)
    report = post(api, '/elders/E1/impressions/generate', None, actor='staff', expected=200)
    point = report['points'][0]
    post(api, '/elders/E1/understanding/'+report['id']+'/'+point['id']+'/decision',
         {'expected_revision': 1, 'decision': 'adopt'}, expected=200)
    def repeat(data):
        current = deepcopy(report)
        current['id'] = 'same-confirmed-trait'
        data['elder_impressions'].append(current)
    api[1].mutate(repeat)
    response = api[0].get(ROOT+'/elders/E1/understanding', headers=api[2]()).json()
    assert response['observations'] == [] and len(response['unchanged_observations']) == 1
    assert response['unchanged_observations'][0]['citations'] == point['citations']
    pending = api[0].get(ROOT+'/decisions/me', headers=api[2]('manager')).json()
    assert not any(r['kind'] == 'understanding' for r in pending['items'])


@pytest.mark.parametrize('text,needs_expiry', [('老人说今天不愿意散步', False), ('老人说暂时不愿意散步', True)])
def test_temporary_wish_never_becomes_indefinite_trait(api, text, needs_expiry):
    result = post(api, '/elders/E1/record', {'text': text, 'happened_at': '2026-10-28T10:00:00+08:00'}, actor='staff')
    suggestion = result['analysis']['preference_suggestions'][0]
    assert suggestion['applicability']['needs_time_confirmation'] == needs_expiry
    path = '/elders/E1/records/'+result['record']['id']+'/analysis/'+result['analysis']['id']+'/confirm'
    decision = {'suggestion_id': suggestion['id'], 'decision': 'adopt'}
    body = {'expected_revision': 1, 'preference_decisions': [decision]}
    if needs_expiry:
        post(api, path, body, actor='staff', expected=422)
        assert api[1].read()['care_memories'] == []
        decision['expires_at'] = '2026-10-29T00:00:00+08:00'
    approved = post(api, path, body, actor='staff', expected=200)
    memory = api[1].read()['care_memories'][0]
    assert memory['expires_at'] == '2026-10-29T00:00:00+08:00'
    assert memory['valid_from'].startswith('2026-10-28')
    assert approved['record']['id'] == result['record']['id']


def test_runtime_measurements_store_versions_and_safe_failure_only(api):
    from app.services.governance_service import instrument
    class Broken(ai_service.MockAIProvider):
        def quality(self, sources):
            raise ai_service.AIProviderError('sensitive provider text')
    provider = instrument(Broken(), api[1].path.parent)
    with pytest.raises(ai_service.AIProviderError):
        provider.quality([{'source_id': 'R1', 'revision': 2, 'text': 'private care text'}])
    run = api[1].read()['ai_evaluations'][-1]
    assert run['source_versions'] == {'R1': 2} and run['outcome'] == 'failed'
    assert run['error_code'] and 'sensitive' not in str(run) and 'private care text' not in str(run)
