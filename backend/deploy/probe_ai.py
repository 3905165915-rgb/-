"""Probe provider and model availability without exposing the API credential."""
import json
from pathlib import Path
import httpx

key = Path('/etc/hulaozhijiao/deepseek.key').read_text().strip()
with httpx.Client(timeout=30) as client:
    response = client.get('https://api.deepseek.com/models', headers={'Authorization': f'Bearer {key}'})
    print('DEEPSEEK_MODELS_HTTP', response.status_code)
    if response.is_success:
        models = [item['id'] for item in response.json().get('data', [])]
        print('AVAILABLE_MODELS', json.dumps(models))
        print('CONFIGURED_MODEL_AVAILABLE', 'deepseek-flash' in models)
    else:
        print('Provider did not return a usable model list.')
