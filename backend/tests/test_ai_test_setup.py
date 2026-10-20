import base64
import copy
import json

import pytest
from dotenv import dotenv_values

pytest.importorskip('cryptography', reason='Optional setup checks require requirements-setup.txt')
from scripts import setup_ai_test as setup

PASSWORD = 'synthetic-test-passphrase-only'
VALUES = {'DEEPSEEK_API_KEY': 'synthetic-deepseek-value', 'SILICONFLOW_API_KEY': 'synthetic-speech-value'}


def test_encryption_round_trip_is_random_and_contains_no_plain_keys():
    first, second = setup.encrypt_config(VALUES, PASSWORD), setup.encrypt_config(VALUES, PASSWORD)
    assert first != second
    assert setup.decrypt_config(first, PASSWORD) == VALUES
    assert all(value not in json.dumps(first) for value in VALUES.values())


def test_wrong_password_and_tampering_fail_without_plaintext():
    bundle = setup.encrypt_config(VALUES, PASSWORD)
    with pytest.raises(setup.SetupError, match='口令不正确'):
        setup.decrypt_config(bundle, 'another-synthetic-password')
    tampered = copy.deepcopy(bundle)
    cipher = bytearray(base64.b64decode(tampered['ciphertext']))
    cipher[0] ^= 1
    tampered['ciphertext'] = base64.b64encode(cipher).decode()
    with pytest.raises(setup.SetupError, match='已损坏'):
        setup.decrypt_config(tampered, PASSWORD)


@pytest.mark.parametrize('field,value', [('version', 2), ('version', True), ('kdf', 'scrypt-unbounded'),
    ('salt', 'not-base64'), ('nonce', 'AA=='), ('ciphertext', 'AA=='), ('unexpected', 'field')])
def test_untrusted_envelope_is_strict_and_cannot_choose_kdf_cost(field, value):
    bundle = setup.encrypt_config(VALUES, PASSWORD)
    bundle[field] = value
    with pytest.raises(setup.SetupError, match='格式不正确'):
        setup.decrypt_config(bundle, PASSWORD)


def test_only_cloud_keys_are_exportable():
    with pytest.raises(setup.SetupError):
        setup.encrypt_config({**VALUES, 'SERVER_PASSWORD': 'synthetic-only'}, PASSWORD)
    with pytest.raises(setup.SetupError):
        setup.encrypt_config({**VALUES, 'DEEPSEEK_API_KEY': 'value\nINJECTED=yes'}, PASSWORD)
    with pytest.raises(setup.SetupError):
        setup.encrypt_config(VALUES, 'short')


def test_write_preserves_existing_settings_and_is_idempotent(tmp_path):
    target = tmp_path / '.env'
    target.write_text('SECRET_KEY=keep-existing-local-signing-value\nDATA_DIR=keep-local-data\nCUSTOM_VALUE=preserved\n', encoding='utf-8')
    setup.write_environment(target, VALUES)
    setup.write_environment(target, VALUES)
    parsed = dotenv_values(target)
    assert all(parsed[key] == value for key, value in VALUES.items())
    assert parsed['SECRET_KEY'] == 'keep-existing-local-signing-value'
    assert parsed['DATA_DIR'] == 'keep-local-data' and parsed['CUSTOM_VALUE'] == 'preserved'
    assert parsed['AI_PROVIDER'] == 'deepseek' and parsed['AI_FALLBACK_MOCK'] == 'false'
    assert parsed['DEEPSEEK_MODEL'] == 'deepseek-flash'
    assert not list(tmp_path.glob('.env.setup-*'))


def test_existing_different_keys_require_explicit_replace(tmp_path):
    target = tmp_path / '.env'
    target.write_text('DEEPSEEK_API_KEY=existing-local-value\n', encoding='utf-8')
    before = target.read_bytes()
    with pytest.raises(setup.SetupError, match='未覆盖'):
        setup.write_environment(target, VALUES)
    assert target.read_bytes() == before
    setup.write_environment(target, VALUES, replace_keys=True)
    assert dotenv_values(target)['DEEPSEEK_API_KEY'] == VALUES['DEEPSEEK_API_KEY']


def test_failed_install_preserves_original_and_cleans_temp(tmp_path, monkeypatch):
    target = tmp_path / '.env'
    target.write_text('CUSTOM=preserved\n', encoding='utf-8')
    before = target.read_bytes()
    def fail(*args):
        raise OSError('synthetic write failure')
    monkeypatch.setattr(setup.os, 'replace', fail)
    with pytest.raises(OSError):
        setup.write_environment(target, VALUES)
    assert target.read_bytes() == before and not list(tmp_path.glob('.env.setup-*'))


def test_cli_check_wrong_password_and_setup_never_print_keys(tmp_path, monkeypatch, capsys):
    bundle = tmp_path / 'encrypted.json'
    bundle.write_text(json.dumps(setup.encrypt_config(VALUES, PASSWORD)), encoding='utf-8')
    monkeypatch.setattr(setup, 'BUNDLE', bundle)
    monkeypatch.setattr(setup, 'BACKEND', tmp_path)
    monkeypatch.setattr(setup.getpass, 'getpass', lambda _: PASSWORD)
    assert setup.main(['--check']) == 0 and not (tmp_path / '.env').exists()
    assert setup.main([]) == 0
    original = (tmp_path / '.env').read_bytes()
    monkeypatch.setattr(setup.getpass, 'getpass', lambda _: 'wrong-synthetic-passphrase')
    assert setup.main([]) == 1
    assert (tmp_path / '.env').read_bytes() == original
    output = capsys.readouterr().out
    assert PASSWORD not in output and all(value not in output for value in VALUES.values())


def test_normal_api_fixture_does_not_inherit_live_keys(api):
    from app.services import ai_service, speech_service
    assert ai_service.settings.ai_provider == 'mock'
    assert ai_service.settings.deepseek_api_key == ''
    assert speech_service.settings.siliconflow_api_key == ''
