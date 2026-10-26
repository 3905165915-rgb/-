"""Initialize a single-server demo without storing credentials in the repository."""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import sys

CONFIG = Path('/etc/hulaozhijiao')
DATA = Path('/var/lib/hulaozhijiao')
ENV = CONFIG / 'backend.env'
CONFIG.mkdir(mode=0o700, parents=True, exist_ok=True)
DATA.mkdir(mode=0o700, parents=True, exist_ok=True)

if not ENV.exists():
    api_key_path = CONFIG / 'deepseek.key'
    api_key = api_key_path.read_text().strip() if api_key_path.exists() else ''
    values = {
        'APP_ENV': 'demo',
        'SECRET_KEY': secrets.token_urlsafe(48),
        'ACCESS_TOKEN_MINUTES': '120',
        'DATA_DIR': str(DATA),
        'AI_PROVIDER': 'deepseek' if api_key else 'mock',
        'DEEPSEEK_API_KEY': api_key,
        'DEEPSEEK_BASE_URL': 'https://api.deepseek.com/v1',
        'DEEPSEEK_MODEL': 'deepseek-flash',
        'DEEPSEEK_TIMEOUT_SECONDS': '45',
        'AI_FALLBACK_MOCK': 'false',
        'CORS_ORIGINS': 'https://sdau.fun,https://www.sdau.fun,http://localhost:5173,http://localhost:5174',
    }
    ENV.write_text(''.join(f'{k}={v}\n' for k, v in values.items()), encoding='utf-8')
    ENV.chmod(0o600)

from dotenv import load_dotenv
load_dotenv(ENV)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.passwords import hash_password
from app.storage.json_store import JsonStore, EMPTY_STORE
import copy

store = JsonStore(DATA)
if not store.path.exists():
    data = copy.deepcopy(EMPTY_STORE)
    accounts = []
    for role in ('admin', 'supervisor', 'caregiver', 'family'):
        password = secrets.token_urlsafe(18)
        accounts.append({'username': role, 'password': password, 'role': role})
        data['users'].append({
            'id': f'USER-{role.upper()}', 'username': role,
            'display_name': f'演示{role}', 'role': role,
            'password_hash': hash_password(password), 'active': True,
        })
    data['elders'] = [{
        'id': 'ELDER-305', 'name': '王阿姨', 'bed_id': 'BED-305',
        'status': 'active', 'contact_name': '虚构演示家属', 'contact_phone': '',
        'notes': '虚构演示数据，不用于真实照护',
    }]
    data['beds'] = [{'id': 'BED-305', 'room': '305', 'status': 'occupied', 'elder_id': 'ELDER-305'}]
    store.replace(data)
    account_file = CONFIG / 'demo-accounts.json'
    account_file.write_text(json.dumps(accounts, ensure_ascii=False, indent=2), encoding='utf-8')
    account_file.chmod(0o600)
    print('Synthetic demo data initialized; passwords saved in root-only configuration.')
else:
    store.read()
    print('Existing data preserved.')
print('Configuration ready. Secrets were not printed.')
