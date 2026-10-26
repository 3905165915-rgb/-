"""Verify hosted speech through HTTPS with an explicitly supplied synthetic WAV."""
import argparse
import hashlib
import json
from pathlib import Path

import httpx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='https://sdau.fun/api/v1')
parser.add_argument('--audio', type=Path, required=True, help='Synthetic PCM16 mono 16kHz WAV; never real care audio')
args = parser.parse_args()
accounts = {row['username']: row for row in json.loads(Path('/etc/hulaozhijiao/demo-accounts.json').read_text())}
data_file = Path('/var/lib/hulaozhijiao/store.json')
before = hashlib.sha256(data_file.read_bytes()).hexdigest()
with httpx.Client(base_url=args.base_url + '/', timeout=70) as client:
    def login(name):
        account = accounts[name]
        result = client.post('auth/login', json={'username': account['username'], 'password': account['password']})
        result.raise_for_status()
        return {'Authorization': 'Bearer ' + result.json()['access_token']}
    staff, family = login('caregiver'), login('family')
    state = client.get('speech/status', headers=staff)
    state.raise_for_status()
    assert state.json()['configured'] is True
    assert state.json()['model'] == 'FunAudioLLM/SenseVoiceSmall'
    assert client.get('speech/status').status_code == 401
    assert client.get('speech/status', headers=family).status_code == 403
    page = client.get('speech/demo')
    assert page.status_code == 200 and '护理语音录入' in page.text
    result = client.post('speech/transcriptions', content=args.audio.read_bytes(), headers={**staff, 'Content-Type': 'audio/wav'})
    print('PUBLIC_SPEECH_HTTP', result.status_code)
    result.raise_for_status()
    transcription = result.json()
    assert transcription['provider'] == 'siliconflow' and transcription['requires_confirmation'] is True
    assert transcription['saved'] is False and transcription['text'].strip()
    print('SYNTHETIC_TRANSCRIPT', transcription['text'])
    assert '没有外出' in transcription['text']
    assert hashlib.sha256(data_file.read_bytes()).hexdigest() == before
    print('PASS: HTTPS hosted transcription, negation, role restrictions, demo page, no automatic persistence')
