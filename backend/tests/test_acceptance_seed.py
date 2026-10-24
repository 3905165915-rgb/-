import copy
import runpy
from pathlib import Path

import pytest

from app.services import family_service, memory_service, plan_service, task_memory_service
from app.services.passwords import verify_password
from app.storage.json_store import JsonStore

module = runpy.run_path(str(Path(__file__).parents[1] / 'scripts/reset_acceptance_demo.py'))


def previous():
    return {'users': [
        {'id': 'USER-' + name.upper(), 'username': name, 'display_name': name,
         'role': role, 'active': True, 'password_hash': 'old-hash', 'token_version': 7}
        for name, (role, _) in module['ACCOUNT_NAMES'].items()
    ] + [{'id': 'OLD', 'username': 'old-debug-account', 'role': 'caregiver'}],
        'elders': [{'id': 'OLD', 'name': '虚构联调老人179250'}]}


def test_rebuild_two_clean_journeys_preserves_ids_and_revokes_sessions(tmp_path):
    old = previous()
    untouched = copy.deepcopy(old)
    data = module['build_demo'](old, 'test-only-password')
    assert old == untouched
    assert [row['name'] for row in data['elders']] == ['张阿姨', '李爷爷']
    assert len(data['users']) == 4
    for row in data['users']:
        original = next(user for user in old['users'] if user['username'] == row['username'])
        assert row['id'] == original['id']
        assert row['token_version'] == 8
        assert verify_password('test-only-password', row['password_hash'])
        assert not verify_password('old-password', row['password_hash'])
    store = JsonStore(tmp_path)
    store.replace(data)
    assert len(data['beds']) == 3 and len(data['admissions']) == 2
    assert len(data['care_tasks']) == 3
    assert sum(row['status'] == 'completed' for row in data['care_tasks']) == 1
    assert len(data['ai_drafts']) == 0  # no fabricated AI outputs
    assert len(data['handovers']) == 1 and data['handovers'][0]['status'] == 'draft'
    for elder in data['elders']:
        assert elder['status'] == 'active'
        bed = next(b for b in data['beds'] if b['id'] == elder['bed_id'])
        assert bed['elder_id'] == elder['id']
        assert memory_service.listing(store, elder['id'])[0]['effective']
        plan = plan_service.listing(store, 'supervisor', elder['id'])[0]
        assert plan['status'] == 'active'
    for task in data['care_tasks']:
        if task['status'] != 'completed':
            context = task_memory_service.get(store, task['id'])
            assert len(context['references']) == 1
            assert not context['needs_review']
    family_id = next(u['id'] for u in data['users'] if u['role'] == 'family')
    bindings = family_service.my_bindings(store, family_id)
    assert len(bindings) == 1
    assert bindings[0]['elder_id'] == data['elders'][0]['id']
    assert len(family_service.summaries(store, bindings[0]['id'], family_id)) == 1
    old_elder_ids = {elder['id'] for elder in data['elders']}
    for collection in data.values():
        if isinstance(collection, list):
            assert all(row.get('elder_id') in old_elder_ids
                       for row in collection if isinstance(row, dict) and row.get('elder_id'))


def test_missing_demo_account_cannot_reset_a_store():
    old = previous()
    old['users'] = [row for row in old['users'] if row['username'] != 'family']
    with pytest.raises(ValueError, match='family'):
        module['build_demo'](old, 'test-only-password')


def test_legacy_usernames_are_shortened_without_changing_identity():
    old = previous()
    aliases = module['PREVIOUS_USERNAMES']
    for row in old['users']:
        row['username'] = aliases.get(row['username'], row['username'])
    candidate = module['build_demo'](old, 'test-only-password')
    assert {row['username'] for row in candidate['users']} == {'admin', 'manager', 'nurse', 'family'}
    assert next(row for row in candidate['users'] if row['username'] == 'nurse')['id'] == 'USER-NURSE'
