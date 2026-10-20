"""Transaction-boundary regressions found while reviewing the previous milestones."""
import pytest

from app.schemas.api import CorrectRecordRequest
from app.services import record_service
from app.services.workflow import DomainError


@pytest.mark.parametrize('operation', ['correct', 'reject'])
@pytest.mark.parametrize('change', ['disabled', 'role_changed'])
def test_record_mutations_recheck_account_in_transaction(api, operation, change):
    client, store, headers = api
    record = client.post('/api/v1/records/manual', headers=headers(), json={
        'elder_id': 'E1', 'raw_text': '午餐进食一半。'}).json()['record']
    draft = client.post('/api/v1/records/extract', headers=headers(), json={
        'elder_id': 'E1', 'text': '老人说今天先休息。'}).json()
    def revoke(data):
        actor = next(row for row in data['users'] if row['id'] == 'staff')
        actor.update(active=False) if change == 'disabled' else actor.update(role='supervisor')
    store.mutate(revoke)
    before = store.path.read_bytes()
    with pytest.raises(DomainError) as failure:
        if operation == 'correct':
            record_service.correct(store, record['id'], CorrectRecordRequest(
                expected_revision=1, reason='重新核实', observations=['更正后的观察']), 'staff', 'caregiver')
        else:
            record_service.reject(store, draft['id'], 'staff', 'caregiver', '人工放弃')
    assert failure.value.status_code == 403
    assert store.path.read_bytes() == before
