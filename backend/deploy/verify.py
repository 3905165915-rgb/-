"""Verify the deployed API; all credentials are read from a root-only file."""
import argparse
import json
from pathlib import Path
import httpx

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:8100/api/v1')
parser.add_argument('--ai', action='store_true')
args = parser.parse_args()
accounts = {u['username']: u for u in json.loads(Path('/etc/hulaozhijiao/demo-accounts.json').read_text())}
with httpx.Client(base_url=args.base_url + '/', timeout=60) as client:
    assert client.get('health').json()['status'] == 'ok'
    assert client.get('elders').status_code == 401
    assert client.post('auth/login', json={'username': 'admin', 'password': 'demo123'}).status_code == 401
    def headers(username):
        user = accounts[username]
        r = client.post('auth/login', json={'username': user['username'], 'password': user['password']})
        r.raise_for_status()
        return {'Authorization': 'Bearer ' + r.json()['access_token']}
    staff = headers('caregiver')
    family = headers('family')
    assert client.get('tasks', headers=family).status_code == 403
    assert client.get('elders', headers=staff).status_code == 200
    assert client.get('elders/not-found', headers=staff).status_code == 404
    assert client.post('records/not-found/confirm', json={}, headers=staff).status_code == 404
    print('PASS: health, login, authentication, family restrictions, missing resource handling')
    if args.ai:
        before = client.get('tasks', headers=staff).json()
        result = client.post('records/extract', json={'elder_id': 'ELDER-305', 'text': '演示观察：王阿姨午餐吃了一半。请联系女儿反馈情况，具体时间待确认。'}, headers=staff)
        print('AI_EXTRACT_HTTP', result.status_code)
        result.raise_for_status()
        draft = result.json()
        assert draft['provider'].startswith('deepseek:')
        assert draft['status'] == 'pending_review'
        assert client.get('tasks', headers=staff).json() == before
        payload = {'observations': draft['observations'], 'task_candidates': [{'title': '演示：联系家属反馈情况'}]}
        first = client.post(f'records/{draft["id"]}/confirm', json=payload, headers=staff)
        first.raise_for_status()
        again = client.post(f'records/{draft["id"]}/confirm', json=payload, headers=staff)
        assert again.json()['record']['id'] == first.json()['record']['id']
        task = first.json()['tasks'][0]
        done = client.post(f'tasks/{task["id"]}/complete', json={'result': '虚构演示：已联系并反馈'}, headers=staff)
        assert done.json()['status'] == 'completed'
        print('PASS: real AI extraction, human confirmation, idempotency, task completion')
