def grant(api, elder_id, user_id='staff'):
    """Explicit test authorization, independent from evidence/ownership rules."""
    api[1].mutate(lambda data: data['care_assignments'].append({
        'id': f'FIXTURE-{elder_id}-{user_id}', 'elder_id': elder_id, 'caregiver_id': user_id,
        'kind': 'explicit_assignment', 'status': 'active', 'revision': 1,
        'start_at': '2020-01-01T00:00:00+00:00', 'end_at': '2099-01-01T00:00:00+00:00'}))
