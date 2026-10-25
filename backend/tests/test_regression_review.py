"""Regression cases from the review of backend milestones 0.3.0 through 0.3.3."""
import copy

import pytest

from app.services import ai_service, quality_service, store_service
from app.services.ai_service import MockAIProvider
from test_handovers import prepare


@pytest.mark.parametrize('operation', ['complete', 'transition', 'update'])
def test_submitted_handover_freezes_source_shift_task_mutations(api, manual_payload, operation):
    client, store, headers = api
    _, _, created, handover = prepare(api, manual_payload)
    assert client.post(f'/api/v1/handovers/{handover["id"]}/submit', headers=headers(),
                       json={'expected_revision': 1}).status_code == 200
    task_id = created['tasks'][0]['id']
    before = store.path.read_bytes()
    if operation == 'complete':
        result = client.post(f'/api/v1/tasks/{task_id}/complete', headers=headers(), json={'result': '补记完成'})
    elif operation == 'transition':
        result = client.post(f'/api/v1/tasks/{task_id}/transition', headers=headers(),
                             json={'expected_revision': 1, 'action': 'start'})
    else:
        result = client.patch(f'/api/v1/tasks/{task_id}', headers=headers('manager'),
                              json={'expected_revision': 1, 'assigned_to': 'staff'})
    assert result.status_code == 409, result.text
    assert result.json()['detail'] == 'shift_closed'
    assert store.path.read_bytes() == before
    # Receipt is the controlled exception: carry the original task into the open target shift.
    for item in handover['items']:
        assert client.post(f'/api/v1/handovers/{handover["id"]}/items/{item["id"]}/receive',
                           headers=headers('other'), json={'status': 'received'}).status_code == 200
    assert client.post(f'/api/v1/tasks/{task_id}/complete', headers=headers('other'),
                       json={'result': '接班后完成'}).status_code == 200


@pytest.mark.parametrize('operation', ['complete', 'transition'])
def test_unassigned_task_still_requires_current_shift_membership(api, manual_payload, operation):
    client, store, headers = api
    _, _, created, _ = prepare(api, manual_payload)
    task_id = created['tasks'][0]['id']
    before = store.path.read_bytes()
    path, body = ('complete', {'result': '完成'}) if operation == 'complete' else (
        'transition', {'expected_revision': 1, 'action': 'start'})
    result = client.post(f'/api/v1/tasks/{task_id}/{path}', headers=headers('other'), json=body)
    assert result.status_code == 403, result.text
    assert result.json()['detail'] == 'not_a_shift_member'
    assert store.path.read_bytes() == before


def test_completed_task_retry_after_shift_closed_does_not_execute_again(api, manual_payload):
    client, store, headers = api
    _, _, created, handover = prepare(api, manual_payload)
    url = f'/api/v1/tasks/{created["tasks"][0]["id"]}/complete'
    first = client.post(url, headers=headers(), json={'result': '班内完成'})
    assert first.status_code == 200
    fresh = client.post(f'/api/v1/handovers/{handover["id"]}/refresh', headers=headers()).json()
    assert client.post(f'/api/v1/handovers/{handover["id"]}/submit', headers=headers(),
                       json={'expected_revision': fresh['revision']}).status_code == 200
    assert client.post(url, headers=headers(), json={'result': '班内完成'}).json() == first.json()
    assert len([row for row in store.read()['audit_logs'] if row['action'] == 'complete_task']) == 1


@pytest.mark.parametrize('root_kind', ['elder', 'task'])
def test_related_timeline_cannot_bypass_handover_membership(api, manual_payload, root_kind):
    client, store, headers = api
    _, _, created, handover = prepare(api, manual_payload)
    def seed_outsider(data):
        user = copy.deepcopy(data['users'][0])
        user.update(id='outsider', username='outsider', display_name='局外测试护理员')
        data['users'].append(user)
    store.mutate(seed_outsider)
    # Authorize the elder file while keeping this actor outside both shifts;
    # this regression specifically tests handover-content isolation.
    from scope_fixtures import grant
    grant(api, 'E1', 'outsider')
    url = f'/api/v1/handovers/{handover["id"]}'
    assert client.post(url + '/submit', headers=headers(), json={'expected_revision': 1}).status_code == 200
    task_item = next(row for row in handover['items'] if row['kind'] == 'task')
    private_note = '仅交接双方可见的澄清：请核实联系家属的先决条件。'
    assert client.post(url + f'/items/{task_item["id"]}/receive', headers=headers('other'), json={
        'status': 'clarifying', 'note': private_note}).status_code == 200
    assert client.get(url, headers=headers('outsider')).status_code == 403
    root = 'E1' if root_kind == 'elder' else created['tasks'][0]['id']
    timeline = f'/api/v1/items/{root}/timeline'
    response = client.get(timeline, headers=headers('outsider'))
    assert response.status_code == 200
    assert private_note not in response.text
    assert private_note in client.get(timeline, headers=headers()).text
    assert private_note in client.get(timeline, headers=headers('manager')).text


@pytest.mark.parametrize('kind', ['extract', 'summary', 'quality'])
@pytest.mark.parametrize('change', ['disabled', 'role_changed', 'demoted'])
def test_long_ai_call_rechecks_actor_before_saving(api, manual_payload, monkeypatch, kind, change):
    client, store, headers = api
    _, _, _, handover = prepare(api, manual_payload)
    actor = 'manager' if kind == 'quality' else 'staff'
    initial = store.read()
    def revoke():
        def mutate(data):
            user = next(row for row in data['users'] if row['id'] == actor)
            if change == 'disabled':
                user['active'] = False
            elif change == 'demoted':
                user['role'] = 'family'
            else:
                # Even a change between two management roles invalidates the original role.
                user['role'] = 'admin' if actor == 'manager' else 'supervisor'
        store.mutate(mutate)
    class RacingProvider(MockAIProvider):
        def extract(self, *args):
            output = super().extract(*args)
            revoke()
            return output
        def summarize(self, sources):
            output = super().summarize(sources)
            revoke()
            return output
        def quality(self, sources):
            output = super().quality(sources)
            revoke()
            return output
    provider = RacingProvider()
    if kind == 'extract':
        monkeypatch.setattr(store_service, 'get_ai_provider', lambda: provider)
        path = '/api/v1/records/extract'
        body = {'elder_id': 'E1', 'text': '本次记录：老人尚未外出。'}
    elif kind == 'summary':
        monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
        path = f'/api/v1/handovers/{handover["id"]}/ai-summary'
        body = {'expected_revision': 1}
    else:
        monkeypatch.setattr(quality_service, 'get_ai_provider', lambda: provider)
        path = '/api/v1/quality/checks'
        body = {'elder_id': 'E1', 'include_ai': True}
    auth = headers(actor)
    result = client.post(path, headers=auth, json=body)
    assert result.status_code == 403, result.text
    latest = store.read()
    for collection in ('ai_drafts', 'handovers', 'quality_checks', 'audit_logs'):
        assert latest[collection] == initial[collection]


def test_memory_confirmation_rechecks_current_manager_in_transaction(api):
    from app.schemas.memory import MemoryReviewRequest
    from app.services import memory_service
    from app.services.workflow import DomainError
    from test_assistant import create_memory
    _, store, _ = api
    memory, _ = create_memory(api, confirm=False)
    store.mutate(lambda data: data['users'][2].update(active=False))
    before = store.path.read_bytes()
    with pytest.raises(DomainError) as rejected:
        memory_service.review(store, memory['id'], MemoryReviewRequest(
            action='confirm', expected_revision=1, reason='已核实本人习惯'), 'manager', 'supervisor')
    assert rejected.value.status_code == 403
    assert store.path.read_bytes() == before
