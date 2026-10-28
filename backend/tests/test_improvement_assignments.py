from datetime import datetime, timedelta, timezone

from test_facility import post
from test_family import get


def test_assignment_history_cross_browser_filters_and_revoke(api):
    now = datetime.now(timezone.utc)
    body = {'elder_id': 'E1', 'caregiver_id': 'staff', 'kind': 'temporary_support',
            'start_at': (now - timedelta(minutes=1)).isoformat(),
            'end_at': (now + timedelta(hours=1)).isoformat(), 'reason': '当班支援'}
    created = post(api, '/elders/work-assignments', body)
    result = get(api, '/elders/work-assignments?caregiver_id=staff&limit=1', 'manager')
    assert result['total'] == 2 and len(result['items']) == 1
    assert result['items'][0]['id'] == created['id']
    detail = get(api, '/elders/work-assignments/' + created['id'], 'manager')
    assert detail['effective_status'] == 'active' and detail['allowed_actions'] == ['revoke']
    assert detail['revocation_impact']['open_task_count'] == 0
    post(api, '/elders/work-assignments/' + created['id'] + '/revoke',
         {'expected_revision': detail['revision'], 'reason': '本次支援结束'}, expected=200)
    assert get(api, '/elders/work-assignments?status=revoked', 'manager')['total'] == 1
    get(api, '/elders/work-assignments', 'staff', 403)
    get(api, '/elders/work-assignments/' + created['id'], 'family', 403)


def test_assignment_expiry_and_stale_revision_cannot_revoke(api):
    store = api[1]
    store.mutate(lambda d: d['care_assignments'].append({**d['care_assignments'][0],
        'id': 'EXPIRED', 'end_at': '2020-01-02T00:00:00Z'}))
    assert get(api, '/elders/work-assignments?status=expired', 'manager')['total'] == 1
    post(api, '/elders/work-assignments/EXPIRED/revoke',
         {'expected_revision': 1, 'reason': '过期分配不能操作'}, expected=409)
    post(api, '/elders/work-assignments/FIXTURE-staff/revoke',
         {'expected_revision': 99, 'reason': '旧页面'}, expected=409)
