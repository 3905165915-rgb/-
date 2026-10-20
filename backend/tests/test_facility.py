"""Resident lifecycle invariants, transactional occupancy, history and staff security."""
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.schemas.facility import AdmissionCreate, ElderUpdate
from app.services import facility_service as service, store_service
from app.services.ai_service import MockAIProvider
from app.services.workflow import DomainError

ROOT = '/api/v1'


def post(api, path, payload, actor='manager', expected=201, key=None):
    client, _, headers = api
    auth = headers(actor)
    if key:
        auth['Idempotency-Key'] = key
    result = client.post(ROOT + path, headers=auth, json=payload)
    assert result.status_code == expected, result.text
    return result.json()


def bed(api, label='1号床', key=None):
    return post(api, '/beds', {'room': '305', 'label': label}, key=key)


def elder(api, name='虚构入住老人', key=None):
    return post(api, '/elders', {'name': name}, key=key)


def admit(api, resident, target, kind='admit', expected=201, key=None):
    return post(api, f'/elders/{resident["id"]}/admissions', {
        'expected_elder_revision': resident.get('revision', 1), 'bed_id': target['id'],
        'expected_bed_revision': target.get('revision', 1), 'kind': kind, 'reason': '已人工核实登记资料',
    }, expected=expected, key=key)


def action(api, state, verb, target=None, expected=200, key=None):
    payload = {'expected_revision': state['admission']['revision'],
               'expected_elder_revision': state['elder']['revision'], 'action': verb, 'reason': '本人及主管已核实本次变动'}
    if target:
        payload.update(bed_id=target['id'], expected_bed_revision=target['revision'])
    return post(api, f'/admissions/{state["admission"]["id"]}/actions', payload, expected=expected, key=key)


def patch(api, path, payload, actor='manager', expected=200):
    client, _, headers = api
    result = client.patch(ROOT + path, json=payload, headers=headers(actor))
    assert result.status_code == expected, result.text
    return result.json()


def legacy(api):
    return admit(api, {'id': 'E1', 'revision': 1}, bed(api), kind='legacy_registration')


def test_new_profile_requires_explicit_admission_and_cannot_patch_identity(api):
    client, store, headers = api
    resident = elder(api, key='create-profile')
    assert resident['status'] == 'pending' and resident['bed_id'] is None
    assert elder(api, key='create-profile') == resident
    assert len(store.read()['elders']) == 2
    for fields in ({'id': 'forged'}, {'bed_id': 'forged'}, {'status': 'active'}, {'name': None}):
        patch(api, '/elders/' + resident['id'], {'expected_revision': 1, 'reason': '尝试绕过流程', **fields}, expected=422)
    edited = patch(api, '/elders/' + resident['id'], {'expected_revision': 1, 'reason': '更正联系人',
                  'contact_name': '虚构家属', 'notes': '演示资料'})
    assert edited['revision'] == 2 and edited['id'] == resident['id']
    patch(api, '/elders/' + resident['id'], {'expected_revision': 1, 'reason': '陈旧更新', 'name': '另一个名字'}, expected=409)
    cleared = patch(api, '/elders/' + resident['id'], {'expected_revision': 2, 'reason': '撤销备注', 'notes': None})
    assert cleared['notes'] is None
    assert client.get(ROOT + '/elders', headers=headers()).status_code == 200


def test_complete_lifecycle_preserves_elder_and_all_previous_stays(api):
    client, store, headers = api
    first, second = bed(api), bed(api, '2号床')
    resident = elder(api)
    state = admit(api, resident, first, key='admit-1')
    assert admit(api, resident, first, key='admit-1') == state
    first_admission = state['admission']['id']
    moved = action(api, state, 'transfer', second)
    assert moved['elder']['id'] == resident['id'] and moved['elder']['bed_id'] == second['id']
    assert moved['admission']['bed_stays'][0]['ended_at']
    assert len(moved['admission']['bed_stays']) == 2
    outside = action(api, moved, 'out')
    assert outside['bed']['status'] == 'occupied' and outside['elder']['status'] == 'out'
    returned = action(api, outside, 'return')
    closed = action(api, returned, 'discharge', key='discharge-1')
    assert action(api, returned, 'discharge', key='discharge-1') == closed
    assert closed['elder']['bed_id'] is None and closed['elder']['current_admission_id'] is None
    assert closed['admission']['bed_id'] == second['id'] and closed['admission']['discharged_at']
    assert closed['bed']['status'] == 'available'
    reopened = admit(api, closed['elder'], closed['bed'])
    assert reopened['admission']['id'] != first_admission
    assert reopened['elder']['id'] == resident['id']
    history = client.get(ROOT + f'/elders/{resident["id"]}/admissions', headers=headers('manager')).json()
    assert len(history['admissions']) == 2 and not history['needs_legacy_registration']
    old = next(row for row in store.read()['admissions'] if row['id'] == first_admission)
    assert old == closed['admission']
    assert [event['action'] for event in old['events']] == ['admit', 'transfer', 'out', 'return', 'discharge']
    events = client.get(ROOT + f'/items/{resident["id"]}/timeline', headers=headers('manager')).json()
    assert {'admission_admit', 'admission_transfer', 'admission_out', 'admission_return', 'admission_discharge'} <= {e['action'] for e in events}


def test_legacy_registration_keeps_identity_without_inventing_past_time(api):
    client, store, headers = api
    before = store.path.read_bytes()
    result = client.get(ROOT + '/elders/E1/admissions', headers=headers('manager')).json()
    assert result['needs_legacy_registration'] and not result['admissions']
    assert store.path.read_bytes() == before
    target = bed(api)
    admit(api, {'id': 'E1'}, target, expected=409)
    state = admit(api, {'id': 'E1'}, target, kind='legacy_registration')
    assert state['elder']['id'] == 'E1' and state['admission']['admitted_at'] is None
    assert state['admission']['registered_at'] and state['admission']['bed_stays'][0]['started_at'] is None
    admit(api, state['elder'], state['bed'], kind='legacy_registration', expected=409)


def test_deployed_legacy_occupied_bed_and_out_elder_supported(api):
    client, store, headers = api
    def seed(data):
        data['elders'][0].update(bed_id='BED-305', status='out')
        data['beds'] = [{'id': 'BED-305', 'room': '305', 'status': 'occupied', 'elder_id': 'E1'}]
    store.mutate(seed)
    target = client.get(ROOT + '/beds', headers=headers()).json()[0]
    assert target['status'] == 'occupied' and target['revision'] == 1
    state = admit(api, {'id': 'E1'}, target, kind='legacy_registration')
    assert state['elder']['status'] == 'out'
    assert action(api, state, 'return')['elder']['status'] == 'active'


def test_out_keeps_bed_and_transfer_requires_return(api):
    client, store, headers = api
    state = action(api, legacy(api), 'out')
    destination = bed(api, '2号床')
    before = store.path.read_bytes()
    action(api, state, 'transfer', destination, expected=409)
    assert store.path.read_bytes() == before
    other = elder(api)
    admit(api, other, state['bed'], expected=409)
    assert client.get(ROOT + '/beds?status=available', headers=headers()).json()[0]['id'] == destination['id']


@pytest.mark.parametrize('verb', ['out', 'return', 'transfer', 'discharge'])
def test_closed_admission_is_immutable(api, verb):
    state = action(api, legacy(api), 'discharge')
    target = bed(api, '2号床') if verb == 'transfer' else None
    _, store, _ = api
    before = store.path.read_bytes()
    action(api, state, verb, target, expected=409)
    assert store.path.read_bytes() == before


def test_discharge_requires_human_resolution_of_outstanding_tasks(api, manual_payload):
    client, store, headers = api
    state = legacy(api)
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    before = store.path.read_bytes()
    result = action(api, state, 'discharge', expected=409)
    assert result['detail'] == 'resolve_outstanding_tasks_before_discharge'
    assert store.path.read_bytes() == before
    post(api, f'/tasks/{task["id"]}/transition', {'expected_revision': 1, 'action': 'cancel',
         'note': '离院后不再开展此任务，人工取消并保留历史'}, expected=200)
    closed = action(api, state, 'discharge')
    assert closed['elder']['status'] == 'discharged'
    assert store.read()['care_tasks'][0]['status'] == 'cancelled'


@pytest.mark.parametrize('state', ['pending', 'discharged'])
def test_inactive_elder_cannot_create_new_records_or_ai_drafts(api, manual_payload, state):
    client, store, headers = api
    store.mutate(lambda data: data['elders'][0].update(status=state))
    before = store.path.read_bytes()
    post(api, '/records/manual', manual_payload, actor='staff', expected=409)
    post(api, '/records/extract', {'elder_id': 'E1', 'text': '记录内容'}, actor='staff', expected=409)
    post(api, '/records/context-extract', {'elder_id': 'E1', 'scene': 'activity', 'text': '记录内容'}, actor='staff', expected=409)
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('verb', ['start', 'complete'])
def test_legacy_discharge_blocks_existing_task_execution(api, manual_payload, verb):
    _, store, _ = api
    task = post(api, '/records/manual', manual_payload, actor='staff')['tasks'][0]
    store.mutate(lambda data: data['elders'][0].update(status='discharged'))
    before = store.path.read_bytes()
    body = {'result': '完成'} if verb == 'complete' else {'action': 'start', 'expected_revision': 1}
    suffix = 'complete' if verb == 'complete' else 'transition'
    assert post(api, f'/tasks/{task["id"]}/{suffix}', body, actor='staff', expected=409)['detail'] == 'elder_not_in_care'
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('contextual', [False, True])
def test_old_ai_draft_not_reused_after_discharge_readmit(api, contextual):
    client, store, headers = api
    state = legacy(api)
    suffix = '/records/context-extract' if contextual else '/records/extract'
    body = {'elder_id': 'E1', 'text': '老人表示今天先休息。'}
    if contextual:
        body['scene'] = 'activity'
    draft = post(api, suffix, body, actor='staff', expected=200)
    closed = action(api, state, 'discharge')
    admit(api, closed['elder'], closed['bed'])
    before = store.path.read_bytes()
    post(api, f'/records/{draft["id"]}/confirm', {'observations': ['已人工核对'], 'task_candidates': []}, actor='staff', expected=409)
    assert store.path.read_bytes() == before


def test_ordinary_ai_call_rechecks_lifecycle_before_save(api, monkeypatch):
    _, store, _ = api
    state = legacy(api)
    class RacingProvider(MockAIProvider):
        def extract(self, *args):
            result = super().extract(*args)
            action(api, state, 'out')
            return result
    monkeypatch.setattr(store_service, 'get_ai_provider', lambda: RacingProvider())
    post(api, '/records/extract', {'elder_id': 'E1', 'text': '本次记录'}, actor='staff', expected=409)
    assert not store.read()['ai_drafts']


def test_bed_disable_duplicate_and_stale_update_guards(api):
    _, store, _ = api
    first = bed(api, key='new-bed')
    assert bed(api, key='new-bed') == first
    post(api, '/beds', {'room': '305', 'label': '1号床'}, expected=409)
    disabled = patch(api, '/beds/' + first['id'], {'expected_revision': 1, 'reason': '暂不使用', 'enabled': False})
    admit(api, elder(api), disabled, expected=409)
    patch(api, '/beds/' + first['id'], {'expected_revision': 1, 'reason': '陈旧请求', 'enabled': True}, expected=409)
    enabled = patch(api, '/beds/' + first['id'], {'expected_revision': 2, 'reason': '恢复床位', 'enabled': True})
    assert admit(api, elder(api), enabled)['bed']['status'] == 'occupied'


def test_occupied_bed_cannot_be_disabled_or_directly_assigned(api):
    state = legacy(api)
    patch(api, '/beds/' + state['bed']['id'], {'expected_revision': 2, 'reason': '停用占用床位', 'enabled': False}, expected=409)
    patch(api, '/beds/' + state['bed']['id'], {'expected_revision': 2, 'reason': '绕过入住', 'elder_id': 'other'}, expected=422)


def test_conflicting_legacy_links_never_offer_available_bed(api):
    client, store, headers = api
    target = bed(api)
    def corrupt(data):
        data['beds'][0].update(elder_id='missing-elder', status='occupied')
    store.mutate(corrupt)
    assert client.get(ROOT + '/beds', headers=headers()).json()[0]['status'] == 'conflict'
    assert client.get(ROOT + '/beds?status=available', headers=headers()).json() == []
    resident = elder(api)
    before = store.path.read_bytes()
    assert admit(api, resident, target, expected=409)['detail'] == 'bed_relation_inconsistent'
    assert store.path.read_bytes() == before


def test_transfer_into_occupied_bed_rolls_back_every_relation(api):
    _, store, _ = api
    state = legacy(api)
    target = bed(api, '2号床')
    other_state = admit(api, elder(api), target)
    before = store.path.read_bytes()
    action(api, state, 'transfer', other_state['bed'], expected=409)
    assert store.path.read_bytes() == before


def test_admission_and_profile_revision_conflicts_roll_back(api):
    _, store, _ = api
    state = legacy(api)
    changed = patch(api, '/elders/E1', {'expected_revision': 2, 'reason': '修正备注', 'notes': '演示'})
    before = store.path.read_bytes()
    action(api, state, 'out', expected=409)
    assert store.path.read_bytes() == before
    fresh = {**state, 'elder': changed}
    outside = action(api, fresh, 'out')
    before = store.path.read_bytes()
    action(api, fresh, 'out', expected=409)
    assert store.path.read_bytes() == before and outside['admission']['revision'] == 2


def test_simultaneous_admissions_cannot_double_book(api):
    _, store, _ = api
    first, second, target = elder(api), elder(api, '另一位虚构老人'), bed(api)
    def attempt(resident):
        try:
            return service.admit(store, resident['id'], AdmissionCreate(
                expected_elder_revision=1, bed_id=target['id'], expected_bed_revision=1, reason='同时申请床位'),
                'manager', 'supervisor')['elder']['id']
        except DomainError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [first, second]))
    assert len([item for item in results if item in {first['id'], second['id']}]) == 1
    assert results.count('stale_revision') == 1
    assert len(store.read()['admissions']) == 1


@pytest.mark.parametrize('path,payload', [('/elders', {'name': '虚构老人'}),
    ('/beds', {'room': '1', 'label': '1'}),
    ('/elders/E1/admissions', {'expected_elder_revision': 1, 'bed_id': 'B', 'expected_bed_revision': 1, 'reason': '登记'}),
    ('/staff', {'username': 'new-user', 'display_name': '新员工', 'password': 'test-secret-password'})])
@pytest.mark.parametrize('actor', ['staff', 'family'])
def test_management_mutations_cannot_be_called_by_caregiver_or_family(api, path, payload, actor):
    post(api, path, payload, actor=actor, expected=403)


def test_admission_history_and_timeline_only_management(api):
    client, _, headers = api
    state = legacy(api)
    for path in ('/elders/E1/admissions', '/items/' + state['admission']['id'] + '/timeline'):
        assert client.get(ROOT + path, headers=headers()).status_code == 403
        assert client.get(ROOT + path, headers=headers('family')).status_code == 403
    events = client.get(ROOT + '/items/E1/timeline', headers=headers()).json()
    assert not any(event['action'].startswith('admission_') for event in events)


def test_service_rechecks_manager_before_mutation(api):
    _, store, _ = api
    store.mutate(lambda data: data['users'][2].update(active=False))
    before = store.path.read_bytes()
    with pytest.raises(DomainError) as exc:
        service.update_elder(store, 'E1', ElderUpdate(expected_revision=1, name='更名', reason='测试权限'), 'manager', 'supervisor')
    assert exc.value.status_code == 403 and store.path.read_bytes() == before


def test_idempotency_key_cannot_change_lifecycle_payload(api):
    state = legacy(api)
    action(api, state, 'out', key='lifecycle-command')
    assert action(api, state, 'discharge', key='lifecycle-command', expected=409)['detail'] == 'idempotency_key_payload_mismatch'


def test_transfer_keeps_record_task_memory_identity_and_bed_snapshot(api, manual_payload):
    client, store, headers = api
    state = legacy(api)
    created = post(api, '/records/manual', manual_payload, actor='staff')
    old_record = created['record']
    old_task = created['tasks'][0]
    target = bed(api, '2号床')
    moved = action(api, state, 'transfer', target)
    patch(api, '/beds/' + target['id'], {'expected_revision': 2, 'reason': '更正房间名称', 'room': '306'})
    data = store.read()
    assert data['care_records'][0] == old_record and data['care_tasks'][0] == old_task
    history = client.get(ROOT + '/elders/E1/admissions', headers=headers('manager')).json()['admissions'][0]
    assert history['bed_stays'][-1]['room'] == '305'  # original bed snapshot
    assert moved['elder']['id'] == old_task['elder_id'] == old_record['elder_id'] == 'E1'


def test_admission_transaction_rolls_back_all_changes_on_late_failure(api, monkeypatch):
    _, store, _ = api
    resident, target = elder(api), bed(api)
    before = store.path.read_bytes()
    def fail_audit(*args, **kwargs):
        raise RuntimeError('simulated late transaction failure')
    monkeypatch.setattr(service, 'audit', fail_audit)
    with pytest.raises(RuntimeError, match='simulated late'):
        service.admit(store, resident['id'], AdmissionCreate(
            expected_elder_revision=1, bed_id=target['id'], expected_bed_revision=1, reason='测试原子提交'),
            'manager', 'supervisor', 'rollback-key')
    assert store.path.read_bytes() == before


def test_legacy_wrong_destination_and_multiple_bed_links_rejected(api):
    client, store, headers = api
    first, second = bed(api), bed(api, '2号床')
    store.mutate(lambda data: data['elders'][0].update(bed_id=first['id']))
    assert admit(api, {'id': 'E1'}, second, kind='legacy_registration', expected=409)['detail'] == 'legacy_registration_must_keep_existing_bed'
    store.mutate(lambda data: data['beds'][1].update(elder_id='E1', status='occupied'))
    before = store.path.read_bytes()
    assert admit(api, {'id': 'E1'}, first, kind='legacy_registration', expected=409)['detail'] == 'bed_relation_inconsistent'
    assert store.path.read_bytes() == before
    rows = client.get(ROOT + '/beds', headers=headers()).json()
    assert all(row['status'] == 'conflict' for row in rows)


def test_legacy_inactive_bed_metadata_edit_does_not_reactivate(api):
    _, store, _ = api
    store.mutate(lambda data: data['beds'].append({'id': 'legacy-disabled', 'room': '100', 'status': 'inactive'}))
    changed = patch(api, '/beds/legacy-disabled', {'expected_revision': 1, 'reason': '更正标识', 'label': 'A床'})
    assert changed['status'] == 'inactive' and changed['enabled'] is False
