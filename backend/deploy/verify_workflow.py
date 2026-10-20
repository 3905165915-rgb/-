"""Explicit operator smoke test. Creates labelled fictional records via the deployed API."""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:8100/api/v1')
parser.add_argument('--ai', action='store_true')
args = parser.parse_args()
accounts = {row['username']: row for row in json.loads(Path('/etc/hulaozhijiao/demo-accounts.json').read_text())}
with httpx.Client(base_url=args.base_url + '/', timeout=90) as client:
    def call(method, path, body=None, headers=None, status=200):
        result = client.request(method, path, json=body, headers=headers)
        if result.status_code != status:
            raise RuntimeError(f'{method} {path}: expected {status}, got {result.status_code}; {result.text[:200]}')
        return result.json()
    def login(name):
        row = accounts[name]
        result = call('POST', 'auth/login', {'username': row['username'], 'password': row['password']})
        return result, {'Authorization': 'Bearer ' + result['access_token']}
    manager, management = login('admin')
    caregiver, staff = login('caregiver')
    _, family = login('family')
    assert call('GET', 'health')['schema_version'] == 4
    elder = call('GET', 'elders', headers=staff)[0]['id']
    assert client.get('quality/checks', headers=staff).status_code == 403
    assert client.get('tasks', headers=family).status_code == 403

    # Choose a future unused window so running this verification twice cannot overlap.
    existing = call('GET', 'shifts?limit=200', headers=management)
    latest = max([datetime.now(timezone.utc)] + [datetime.fromisoformat(row['end_at'].replace('Z', '+00:00')) for row in existing])
    start = (latest + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    def shift(name, begin, members):
        return call('POST', 'shifts', {'name': name, 'start_at': begin.isoformat(), 'end_at': (begin + timedelta(hours=12)).isoformat(), 'caregiver_ids': members}, management, 201)
    source = shift('虚构验收交班', start, [caregiver['user_id']])
    target = shift('虚构验收接班', start + timedelta(hours=12), [manager['user_id']])
    payload = {'elder_id': elder, 'shift_id': source['id'], 'raw_text': '虚构验收：午餐进食一半，稍后联系家属反馈。',
               'observations': ['虚构验收：午餐进食一半'], 'task_candidates': [{'title': '虚构验收：联系家属反馈'}]}
    record_headers = {**staff, 'Idempotency-Key': 'verify-' + uuid4().hex}
    created = call('POST', 'records/manual', payload, record_headers, 201)
    assert call('POST', 'records/manual', payload, record_headers, 201)['record']['id'] == created['record']['id']
    task_id = created['tasks'][0]['id']
    handover = call('POST', 'handovers', {'source_shift_id': source['id'], 'target_shift_id': target['id']}, staff, 201)
    ho = 'handovers/' + handover['id']
    if args.ai:
        draft = call('POST', 'records/extract', {'elder_id': elder, 'text': '虚构验收：老人今天没有外出，午餐进食约一半。'}, staff)
        assert draft['provider'].startswith('deepseek:') and draft['status'] == 'pending_review'
        call('POST', f'records/drafts/{draft["id"]}/reject', {'reason': '虚构验收完成，放弃该草稿'}, staff)
        handover = call('POST', ho + '/ai-summary', {'expected_revision': handover['revision']}, staff)
        assert handover['ai_summary']['status'] == 'pending_review'
        assert handover['ai_summary']['provider'].startswith('deepseek:')
        assert call('GET', ho, headers=staff)['status'] == 'draft'
    report = call('POST', 'quality/checks', {'handover_id': handover['id'], 'include_ai': args.ai}, management, 201)
    assert 'task_unassigned' in {row['code'] for row in report['issues']}
    if args.ai:
        assert report['provider'].startswith('deepseek:')
    first = report['issues'][0]
    call('POST', f'quality/checks/{report["id"]}/issues/{first["id"]}/resolve', {'status': 'acknowledged', 'note': '虚构验收：已核对，由接班人员继续处理'}, management)
    handover = call('POST', ho + '/submit', {'expected_revision': handover['revision'], 'summary': '虚构验收交班', 'approve_ai_summary': args.ai}, staff)
    for item in handover['items']:
        call('POST', ho + f'/items/{item["id"]}/receive', {'status': 'received', 'assigned_to': manager['user_id']}, management)
    carried = call('GET', 'tasks/' + task_id, headers=management)
    assert carried['id'] == task_id and carried['shift_id'] == target['id'] and carried['continuity_key'] == task_id
    done = call('POST', 'tasks/' + task_id + '/complete', {'result': '虚构验收：已反馈'}, management)
    assert done['status'] == 'completed'
    actions = {row['action'] for row in call('GET', 'items/' + task_id + '/timeline', headers=management)}
    assert {'create_manual_record', 'create_task', 'carry_task', 'complete_task', 'submit_handover'} <= actions
    assert call('GET', ho, headers=management)['status'] == 'received'
    print('PASS: manual idempotency, quality review, handover, same-task continuity, completion, timeline, permissions')
    if args.ai:
        print('PASS: real DeepSeek extraction, quoted summary and quality checks; human review preserved')
