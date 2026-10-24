"""Run a real isolated Uvicorn process and synthetic HTTP workflows, without cloud calls."""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import httpx

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.services.passwords import hash_password  # noqa: E402
from app.storage.json_store import JsonStore, CURRENT_SCHEMA_VERSION  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=BACKEND / '.test-runs' / 'runtime-result.json')
    args = parser.parse_args()
    temp_root = BACKEND / '.test-runs'
    temp_root.mkdir(exist_ok=True)
    checks = []
    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)
    with tempfile.TemporaryDirectory(prefix='runtime-', dir=temp_root) as temp:
        directory = Path(temp)
        password = secrets.token_urlsafe(24)
        store = JsonStore(directory / 'data')
        store.ensure()
        def seed(data):
            data['users'] = [{'id': name, 'username': name, 'display_name': '虚构运行验收账号', 'role': role,
                              'active': True, 'password_hash': hash_password(password)}
                             for name, role in [('manager', 'supervisor'), ('worker', 'caregiver'), ('family', 'family')]]
        store.mutate(seed)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        child_env = {**os.environ, 'DATA_DIR': str(directory / 'data'), 'APP_ENV': 'demo',
                     'SECRET_KEY': secrets.token_urlsafe(48), 'AI_PROVIDER': 'mock', 'AI_FALLBACK_MOCK': 'false',
                     'DEEPSEEK_API_KEY': '', 'SILICONFLOW_API_KEY': ''}
        with (directory / 'uvicorn.log').open('w', encoding='utf-8') as log:
            process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--app-dir', str(BACKEND),
                '--host', '127.0.0.1', '--port', str(port), '--no-access-log'], cwd=BACKEND, env=child_env,
                stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                with httpx.Client(base_url=f'http://127.0.0.1:{port}/api/v1', timeout=15, trust_env=False) as client:
                    last_status = 'no_response'
                    for _ in range(100):
                        if process.poll() is not None:
                            raise RuntimeError('Isolated server exited before readiness; inspect script/configuration')
                        try:
                            ready = client.get('/health')
                            last_status = str(ready.status_code)
                            if ready.status_code == 200:
                                break
                        except httpx.TransportError as exc:
                            last_status = type(exc).__name__
                        time.sleep(0.1)
                    else:
                        raise RuntimeError('Isolated server readiness timeout: ' + last_status)
                    check('real_uvicorn_health', client.get('/health').json()['schema_version'] == CURRENT_SCHEMA_VERSION)
                    check('anonymous_denied', client.get('/elders').status_code == 401)
                    auth = {}
                    for actor in ('manager', 'worker', 'family'):
                        response = client.post('/auth/login', json={'username': actor, 'password': password})
                        check(f'login_{actor}', response.status_code == 200)
                        auth[actor] = {'Authorization': 'Bearer ' + response.json()['access_token']}
                    def call(method, path, body=None, actor='manager', expected=200, key=None):
                        headers = dict(auth[actor])
                        if key:
                            headers['Idempotency-Key'] = key
                        response = client.request(method, path, json=body, headers=headers)
                        if response.status_code != expected:
                            # Bodies contain synthetic data only, but avoid logging tokens/passwords.
                            raise AssertionError(f'{method} {path}: expected {expected}, got {response.status_code}')
                        check('no_store_' + str(len(checks)), response.headers.get('Cache-Control') == 'no-store')
                        return response.json()
                    def post(path, body, **kwargs):
                        return call('POST', path, body, **kwargs)
                    def get(path, **kwargs):
                        return call('GET', path, **kwargs)
                    def utc(days=0):
                        return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
                    local = datetime.now(timezone(timedelta(hours=8)))
                    day = local.date()
                    elder = post('/elders', {'name': '虚构运行验收老人'}, expected=201)
                    eid = elder['id']
                    bed = post('/beds', {'room': '演示区', 'label': '测试床'}, expected=201)
                    state = post(f'/elders/{eid}/admissions', {'expected_elder_revision': 1, 'bed_id': bed['id'],
                        'expected_bed_revision': 1, 'kind': 'admit', 'reason': '虚构运行验收入住'}, expected=201)
                    aid = state['admission']['id']
                    record = post('/records/manual', {'elder_id': eid, 'raw_text': '本人说喜欢安静进餐，已协助饮水。'}, actor='worker', expected=201)['record']
                    check('record_has_admission_provenance', record['admission_id'] == aid)
                    evidence = [{'record_id': record['id'], 'revision': 1, 'quote': '喜欢安静进餐'}]
                    template = get('/assessments/templates')[0]
                    scores = {r['key']: r['options'][-1]['score'] for r in template['items']}
                    assessment = post('/assessments', {'elder_id': eid, 'scores': scores, 'assessed_at': utc(-0.01),
                        'review_due_at': utc(3), 'note': '虚构逐项观察', 'evidence': evidence}, expected=201)
                    assessment = post(f'/assessments/{assessment["id"]}/review', {'expected_revision': 1, 'action': 'confirm',
                        'reason': '虚构人工审核', 'care_level_label': '演示档', 'care_level_basis': '演示机构规则，不能用于收费'})
                    plan = post('/care-plans', {'elder_id': eid, 'assessment_id': assessment['id'],
                        'expected_assessment_revision': assessment['revision'], 'title': '演示协助进餐计划', 'goal': '尊重本人意愿',
                        'starts_on': day.isoformat(), 'ends_on': (day + timedelta(days=1)).isoformat(),
                        'items': [{'key': 'dining', 'title': '询问并协助进餐', 'scene': 'dining', 'instruction': '先询问本人', 'times': ['00:01']}]}, expected=201)
                    plan = post(f'/care-plans/{plan["id"]}/review', {'expected_revision': 1, 'action': 'approve', 'reason': '演示人工审批'})
                    midnight = datetime.combine(day, datetime.min.time(), local.tzinfo)
                    shift = post('/shifts', {'name': '虚构全天验收班', 'start_at': midnight.isoformat(),
                        'end_at': (midnight + timedelta(days=1)).isoformat(), 'caregiver_ids': ['worker']}, expected=201)
                    generate_body = {'expected_revision': plan['revision'], 'service_date': day.isoformat(),
                                     'shift_id': shift['id'], 'assigned_to': 'worker'}
                    generated = post(f'/care-plans/{plan["id"]}/generate', generate_body, key='generate')
                    check('plan_generated_once', len(generated['created_tasks']) == 1)
                    repeated = post(f'/care-plans/{plan["id"]}/generate', generate_body, key='generate-second')
                    check('different_keys_do_not_duplicate_occurrence', repeated['created_tasks'] == [])
                    task = generated['created_tasks'][0]
                    post(f'/tasks/{task["id"]}/complete', {'result': '虚构服务已人工核对完成'}, actor='worker')
                    memory = post('/memories', {'elder_id': eid, 'content': '本人喜欢安静进餐', 'category': 'stable_preference',
                        'scenes': ['dining'], 'attributed_to': 'elder', 'source_record_id': record['id'], 'source_revision': 1,
                        'source_quote': '喜欢安静进餐'}, actor='worker', expected=201)
                    post(f'/memories/{memory["id"]}/review', {'expected_revision': 1, 'action': 'confirm', 'reason': '人工核对原文'})
                    draft = post('/records/context-extract', {'elder_id': eid, 'scene': 'dining', 'text': '本人今天想安静休息。'}, actor='worker')
                    check('mock_is_marked_and_pending', draft['provider'] == 'mock' and draft['status'] == 'pending_review')
                    post(f'/records/{draft["id"]}/confirm', {'task_candidates': []}, actor='worker')
                    grant = post('/family/bindings', {'elder_id': eid, 'admission_id': aid, 'family_id': 'family',
                        'relationship': '虚构亲属', 'consent_reference': '虚构已核实授权凭证', 'scopes': ['summary', 'feedback'], 'expires_at': utc(5)}, expected=201)
                    summary = post('/family/summaries', {'elder_id': eid, 'admission_id': aid, 'period_start': utc(-1),
                        'period_end': utc(), 'text': '已协助饮水并尊重进餐意愿。', 'evidence': evidence}, expected=201)
                    family_path = f'/family/me/bindings/{grant["id"]}'
                    check('unreviewed_summary_hidden', get(family_path + '/summaries', actor='family') == [])
                    post(f'/family/summaries/{summary["id"]}/review', {'expected_revision': 1, 'action': 'publish', 'reason': '人工核对对外内容'})
                    visible = get(family_path + '/summaries', actor='family')
                    check('reviewed_summary_has_no_raw_evidence', len(visible) == 1 and 'evidence' not in visible[0])
                    feedback_body = {'binding_id': grant['id'], 'text': '请继续尊重本人意愿'}
                    feedback = post('/family/me/feedback', feedback_body, actor='family', key='family-retry', expected=201)
                    post(f'/family/feedback/{feedback["id"]}/reply', {'expected_revision': 1, 'reply': '已转告工作人员', 'reason': '内部处理已核对'})
                    check('family_feedback_closed', get(family_path + '/feedback', actor='family')[0]['status'] == 'closed')
                    incident = post('/incidents', {'elder_id': eid, 'admission_id': aid, 'occurred_at': utc(), 'description': '虚构服务风险报告',
                        'immediate_action': '先核对现场情况', 'evidence': evidence}, actor='worker', expected=201)
                    incident = post(f'/incidents/{incident["id"]}/triage', {'expected_revision': 1, 'category': 'other', 'severity': 'low',
                        'classification_basis': '仅演示主管判断', 'assigned_to': 'worker', 'due_at': utc(1), 'corrective_plan': '核查服务记录',
                        'evidence': evidence, 'reason': '虚构整改安排'})
                    rect = incident['rectification']
                    submitted = post(f'/rectifications/{rect["id"]}/submit', {'expected_revision': rect['revision'],
                        'expected_incident_revision': incident['revision'], 'result': '已核查服务记录', 'evidence': evidence}, actor='worker')
                    closed = post(f'/rectifications/{rect["id"]}/review', {'expected_revision': submitted['rectification']['revision'],
                        'expected_incident_revision': submitted['revision'], 'decision': 'accept', 'note': '另一人复查虚构整改'})
                    check('incident_closed_by_independent_review', closed['status'] == 'closed')
                    metrics = get(f'/reports/metrics?start={day.isoformat()}&end={(day + timedelta(days=1)).isoformat()}')
                    check('metrics_count_unique_generated_occurrence', metrics['generated_plan_occurrences']['completion']['numerator'] == 1)
                    exported = post(f'/reports/elders/{eid}/export', {'reason': '虚构案例验收'})
                    check('export_is_pseudonymized', exported['mode'] == 'pseudonymized_metadata' and record['raw_text'] not in json.dumps(exported, ensure_ascii=False))
                    post('/quality/checks', {'elder_id': eid, 'include_ai': False}, expected=201)
                    call('GET', '/records', actor='family', expected=403)
                    post(f'/records/{record["id"]}/corrections', {'expected_revision': 1, 'observations': ['更正：今天更愿意与他人一起进餐。'],
                        'reason': '虚构来源更正'}, actor='worker')
                    check('published_summary_hidden_after_source_correction', get(family_path + '/summaries', actor='family') == [])
                    check('memory_source_correction_blocks_old_reminder', not get(f'/memories/{memory["id"]}', actor='worker')['effective'])
                    check('plan_basis_requires_recheck_after_correction', not get(f'/care-plans/{plan["id"]}', actor='worker')['current']['effective'])
                    post(f'/family/bindings/{grant["id"]}/revoke', {'expected_revision': 1, 'reason': '虚构撤销授权'})
                    post('/family/me/feedback', feedback_body, actor='family', key='family-retry', expected=403)
                    check('family_cannot_replay_after_revoke', get('/family/me/bindings', actor='family') == [])
                    check('speech_unconfigured_is_explicit', not get('/speech/status', actor='worker')['configured'])
            finally:
                if os.name == 'nt' and process.poll() is None:
                    # Windows venv Python may spawn a base-interpreter child.
                    # Stop only the process tree created by this smoke test.
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=10)
                elif process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = {'status': 'passed', 'transport': 'real_uvicorn_tcp_http', 'python': sys.version.split()[0],
              'platform': sys.platform, 'api_version': '0.4.0', 'schema_version': 4,
              'data': 'temporary_synthetic_only', 'vendor_calls': 0, 'production_mutations': 0, 'checks': checks}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'PASS: {len(checks)} runtime assertions over real HTTP; temporary server stopped; report written.')


if __name__ == '__main__':
    main()
