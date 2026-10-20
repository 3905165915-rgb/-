"""Isolated Linux acceptance, opt-in real vendors, no deployment or live business writes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))
from scripts.evaluate_ai import evaluate  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--synthetic-audio', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    baseline = Path('/var/lib/hulaozhijiao/store.json')
    original_hash = hashlib.sha256(baseline.read_bytes()).hexdigest() if baseline.exists() else None
    stamp = datetime.now(timezone.utc).isoformat()
    results = {'started_at': stamp, 'python': platform.python_version(), 'platform': platform.system(),
               'deployed': False, 'live_store_unchanged': None, 'steps': {}}
    values = dotenv_values(args.env_file)
    cloud = {key: str(values.get(key) or '') for key in (
        'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL', 'SILICONFLOW_API_KEY')}
    if not cloud['DEEPSEEK_MODEL']:
        cloud['DEEPSEEK_MODEL'] = 'deepseek-flash'
    if not cloud['DEEPSEEK_BASE_URL']:
        cloud['DEEPSEEK_BASE_URL'] = 'https://api.deepseek.com/v1'
    results['model'] = cloud['DEEPSEEK_MODEL']
    results['configured'] = {'deepseek': bool(cloud['DEEPSEEK_API_KEY']), 'speech': bool(cloud['SILICONFLOW_API_KEY'])}
    def run(name, command, env):
        print('ACCEPTANCE_STEP ' + name, flush=True)
        result = subprocess.run(command, cwd=ROOT, env=env, check=False)
        results['steps'][name] = {'returncode': result.returncode}
        return result.returncode
    try:
        with tempfile.TemporaryDirectory(prefix='hulao-isolated-') as data:
            env = {**os.environ, 'DATA_DIR': data, 'APP_ENV': 'demo', 'AI_PROVIDER': 'mock',
                   'AI_FALLBACK_MOCK': 'false', 'SECRET_KEY': secrets.token_urlsafe(48), 'PYTHONPATH': str(BACKEND),
                   'DEEPSEEK_API_KEY': '', 'SILICONFLOW_API_KEY': '', 'RUN_REAL_AI': '0'}
            unit = run('linux_regression', [sys.executable, '-m', 'pytest', str(BACKEND / 'tests'), '-q',
                '-p', 'no:cacheprovider', '--basetemp', str(args.output_dir / 'pytest-unit'),
                '--junitxml', str(args.output_dir / 'unit.xml')], env)
            runtime = run('real_http_runtime', [sys.executable, str(BACKEND / 'scripts' / 'verify_local_runtime.py'),
                                               '--output', str(args.output_dir / 'runtime.json')], env)
            deps = run('dependency_check', [sys.executable, '-m', 'pip', 'check'], env)
            # Validate the incoming Nginx template without loading or reloading it.
            wrapper = args.output_dir / 'nginx-acceptance.conf'
            wrapper.write_text(f'pid {args.output_dir}/nginx-test.pid;\nerror_log {args.output_dir}/nginx-test.log;\n'
                f'events {{}}\nhttp {{ access_log off; include /etc/nginx/mime.types; include {BACKEND / "deploy" / "nginx.conf"}; }}\n', encoding='utf-8')
            run('nginx_template_syntax', ['nginx', '-t', '-c', str(wrapper), '-p', str(args.output_dir)], env)
            if unit == 0 and runtime == 0 and deps == 0:
                live_env = {**env, **cloud, 'RUN_REAL_AI': '1', 'AI_PROVIDER': 'deepseek',
                            'LIVE_EVIDENCE_DIR': str(args.output_dir / 'vendor-evidence'),
                            'LIVE_SYNTHETIC_AUDIO': str(args.synthetic_audio)}
                run('real_vendor', [sys.executable, '-m', 'pytest', str(BACKEND / 'tests' / 'test_real_ai.py'),
                    '-vv', '--tb=short', '-p', 'no:cacheprovider', '--basetemp', str(args.output_dir / 'pytest-live'),
                    '--junitxml', str(args.output_dir / 'vendor.xml')], live_env)
                cases = json.loads((BACKEND / 'evaluation' / 'cases.json').read_text(encoding='utf-8'))
                predictions = [json.loads(path.read_text(encoding='utf-8'))['prediction']
                               for path in sorted((args.output_dir / 'vendor-evidence').glob('extract-*.json'))]
                (args.output_dir / 'extraction-score.json').write_text(
                    json.dumps(evaluate(cases, predictions), ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        after_hash = hashlib.sha256(baseline.read_bytes()).hexdigest() if baseline.exists() else None
        results['live_store_unchanged'] = original_hash == after_hash
        results['finished_at'] = datetime.now(timezone.utc).isoformat()
        results['passed'] = (all(row['returncode'] == 0 for row in results['steps'].values()) and
                             'real_vendor' in results['steps'] and results['live_store_unchanged'])
        (args.output_dir / 'acceptance-summary.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
        print('ACCEPTANCE_SUMMARY ' + json.dumps(results), flush=True)
    return 0 if results['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
