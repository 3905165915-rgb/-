"""Loopback-only browser acceptance server with an isolated synthetic store.

Never runs against the production store; refuses an existing data directory.
All model responses are explicitly mock. This is a test helper, not a release.
"""
import argparse
import io
import os
from pathlib import Path
import runpy
import secrets
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True, type=Path)
    args = parser.parse_args()
    directory = args.data_dir.resolve()
    if directory.exists():
        raise SystemExit('请使用一个不存在的隔离测试目录；不会覆盖已有资料。')
    directory.mkdir(parents=True)
    temporary = directory / 'temporary'
    temporary.mkdir()
    tempfile.tempdir = str(temporary)
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    os.environ.update(DATA_DIR=str(directory), APP_ENV='development',
                      SECRET_KEY=secrets.token_urlsafe(48), AI_PROVIDER='mock', AI_FALLBACK_MOCK='false')
    from PIL import Image
    from app.storage.json_store import JsonStore
    from app.schemas.photo import PhotoLink, PhotoReview
    from app.services import attachment_service
    from app.services.workflow import parse_time

    module = runpy.run_path(str(root / 'scripts/reset_acceptance_demo.py'))
    accounts = module['ACCOUNT_NAMES']
    previous = {'users': [{'id': 'SYNTHETIC-' + username, 'username': username, 'role': role,
                           'display_name': display, 'active': True, 'password_hash': 'unused'}
                          for username, (role, display) in accounts.items()]}
    # Deliberately non-production credential, used only on this loopback fixture.
    data = module['build_demo'](previous, 'family-browser-test')
    store = JsonStore(directory)
    store.replace(data)
    record = data['care_records'][0]
    content = io.BytesIO()
    Image.new('RGB', (160, 120), '#a3bea3').save(content, 'PNG')
    photo = attachment_service.upload(store, record['elder_id'], parse_time(record['happened_at']),
        '虚构联调配图', content.getvalue(), 'image/png', 'SYNTHETIC-admin', 'admin')
    photo = attachment_service.link(store, photo['id'], PhotoLink(target_type='record', target_id=record['id']),
                                    'SYNTHETIC-admin', 'admin')
    attachment_service.review(store, photo['id'], PhotoReview(expected_revision=photo['revision'],
        decision='approve', note='仅为合成联调图片', share_with_family=True), 'SYNTHETIC-admin', 'admin')
    print('虚构家属联调服务已准备，地址仅限本机；未接入真实模型。', flush=True)
    import uvicorn
    uvicorn.run('app.main:app', host='127.0.0.1', port=8769, log_level='warning', access_log=False)


if __name__ == '__main__':
    main()
