"""Unlock team AI test keys into a private .env; never print keys or accept passwords in argv."""
from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
from pathlib import Path
import secrets
import tempfile

from dotenv import dotenv_values, set_key

BACKEND = Path(__file__).resolve().parents[1]
BUNDLE = BACKEND / 'config' / 'ai-test-secrets.enc.json'
AAD = b'hulaozhijiao-ai-test-config:v1'
FORMAT = 'hulaozhijiao-ai-test-config'
KEY_NAMES = {'DEEPSEEK_API_KEY', 'SILICONFLOW_API_KEY'}
MAX_BUNDLE_BYTES = 16384


class SetupError(ValueError):
    pass


def crypto():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
    except ImportError:
        raise SetupError('请先安装：python -m pip install -r backend/requirements-setup.txt') from None
    return AESGCM, Scrypt


def validate_keys(values):
    if not isinstance(values, dict) or set(values) != KEY_NAMES:
        raise SetupError('配置字段不合法')
    if any(not isinstance(value, str) or not value.strip() or len(value) > 2048 or
           any(char in value for char in '\r\n\x00') for value in values.values()):
        raise SetupError('配置字段不合法')
    return {key: value.strip() for key, value in values.items()}


def derive_key(password, salt):
    if not isinstance(password, str) or len(password) < 16:
        raise SetupError('解锁口令至少16个字符，请使用单独提供的完整口令')
    _, Scrypt = crypto()
    return Scrypt(salt=salt, length=32, n=32768, r=8, p=1).derive(password.encode('utf-8'))


def encrypt_config(values, password):
    """Used by the authorized maintainer; only ciphertext is committed."""
    payload = json.dumps(validate_keys(values), sort_keys=True).encode('utf-8')
    salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
    AESGCM, _ = crypto()
    ciphertext = AESGCM(derive_key(password, salt)).encrypt(nonce, payload, AAD)
    return {'format': FORMAT, 'version': 1, 'kdf': 'scrypt-32768-8-1',
            'salt': base64.b64encode(salt).decode('ascii'),
            'nonce': base64.b64encode(nonce).decode('ascii'),
            'ciphertext': base64.b64encode(ciphertext).decode('ascii')}


def decrypt_config(bundle, password):
    try:
        if not isinstance(bundle, dict) or set(bundle) != {'format', 'version', 'kdf', 'salt', 'nonce', 'ciphertext'}:
            raise ValueError()
        if bundle['format'] != FORMAT or type(bundle['version']) is not int or bundle['version'] != 1 or bundle['kdf'] != 'scrypt-32768-8-1':
            raise ValueError()
        salt, nonce, ciphertext = [base64.b64decode(bundle[key], validate=True) for key in ('salt', 'nonce', 'ciphertext')]
        if len(salt) != 16 or len(nonce) != 12 or not 16 <= len(ciphertext) <= MAX_BUNDLE_BYTES:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise SetupError('加密文件格式不正确或已损坏') from None
    AESGCM, _ = crypto()
    key = derive_key(password, salt)
    from cryptography.exceptions import InvalidTag
    try:
        plain = AESGCM(key).decrypt(nonce, ciphertext, AAD)
        values = json.loads(plain)
    except (InvalidTag, ValueError, UnicodeError):
        raise SetupError('口令不正确或加密文件已损坏；未写入配置') from None
    return validate_keys(values)


def write_environment(path, values, replace_keys=False):
    """Preserve existing config and atomically install the unlocked keys."""
    values = validate_keys(values)
    path = Path(path)
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise SetupError('配置目标必须为普通文件')
    previous = dotenv_values(path, interpolate=False) if path.exists() else {}
    if not replace_keys and any(previous.get(key) and previous[key] != value for key, value in values.items()):
        raise SetupError('已有不同的云Key，未覆盖；确认要替换时使用--replace-keys')
    updated = {**values, 'AI_PROVIDER': 'deepseek', 'DEEPSEEK_BASE_URL': 'https://api.deepseek.com/v1',
               'DEEPSEEK_MODEL': 'deepseek-flash', 'AI_FALLBACK_MOCK': 'false',
               'DEEPSEEK_TIMEOUT_SECONDS': '45', 'SPEECH_TIMEOUT_SECONDS': '45'}
    for key, default in {'APP_ENV': 'demo', 'DATA_DIR': str(BACKEND / 'data'),
                         'CORS_ORIGINS': 'http://localhost:5173,http://localhost:5174,http://localhost:4173'}.items():
        if not previous.get(key):
            updated[key] = default
    if previous.get('SECRET_KEY') in (None, '', 'dev-only-change-me-please-use-a-long-secret', 'replace-with-a-long-random-value'):
        updated['SECRET_KEY'] = secrets.token_urlsafe(48)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.env.setup-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(path.read_bytes() if path.exists() else b'')
        for key, value in updated.items():
            set_key(temporary, key, value, quote_mode='always')
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='只验证解锁，不写.env')
    parser.add_argument('--replace-keys', action='store_true', help='明确替换已有云Key，其他配置保留')
    args = parser.parse_args(argv)
    try:
        raw = BUNDLE.read_bytes()
        if len(raw) > MAX_BUNDLE_BYTES:
            raise SetupError('加密文件过大')
        try:
            bundle = json.loads(raw)
        except (ValueError, UnicodeError):
            raise SetupError('加密文件格式不正确') from None
        password = getpass.getpass('请输入单独提供的AI配置解锁口令（输入隐藏）: ')
        values = decrypt_config(bundle, password)
        password = None
        if args.check:
            print('解锁校验通过；未写入配置，未调用厂商。')
        else:
            write_environment(BACKEND / '.env', values, replace_keys=args.replace_keys)
            print('已生成backend/.env：DeepSeek和语音Key已配置，模型deepseek-flash；密钥未打印。')
            print('重启后端后生效；不会修改账号、初始化或覆盖业务数据。')
        return 0
    except (SetupError, OSError) as exc:
        print(f'配置失败：{exc}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
