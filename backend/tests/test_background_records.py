from app.services import ai_service, record_job_service as jobs, elder_workspace_service as workspace
from test_facility import ROOT, post


def test_background_save_never_calls_model_and_replays_one_record(api, monkeypatch):
    def forbidden():
        raise AssertionError('model must run outside the submission')
    monkeypatch.setattr(ai_service, 'get_ai_provider', forbidden)
    payload = {'text': '老人说今天想休息。', 'background': True}
    result = post(api, '/elders/E1/record', payload, key='durable-record')
    assert result['analysis_status'] == 'queued' and result['analysis'] is None
    repeated = post(api, '/elders/E1/record', payload, key='durable-record')
    assert repeated['record']['id'] == result['record']['id']
    assert len(api[1].read()['care_records']) == 1
    assert len([j for j in api[1].read()['care_jobs'] if j.get('kind') == 'inline']) == 1


def test_background_process_poll_and_permission(api):
    client, store, headers = api
    result = post(api, '/elders/E1/record', {'text': '老人说今天想休息。', 'background': True})
    record_id = result['record']['id']
    assert jobs.process_inline_next(store)
    path = ROOT + '/elders/E1/records/' + record_id + '/analysis'
    ready = client.get(path, headers=headers()).json()
    assert ready['analysis_status'] == 'ready'
    assert len(store.read()['care_records']) == 1
    assert client.get(path, headers=headers('family')).status_code == 403
    assert not jobs.process_inline_next(store)


def test_interrupted_inline_job_recovers_and_old_batch_cannot_write(api):
    _, store, _ = api
    post(api, '/elders/E1/record', {'text': '今天上午参加听戏活动。', 'background': True})
    store.mutate(lambda d: [j.update(status='processing') for j in d['care_jobs'] if j.get('kind') == 'inline'])
    workspace.recover_jobs(store)
    assert jobs.process_inline_next(store)
    assert store.read()['record_analyses'][0]['status'] == 'ready'


def test_organising_does_not_claim_inline_job(api):
    post(api, '/elders/E1/record', {'text': '今天想休息。', 'background': True})
    store = api[1]
    store.mutate(lambda d: d.update(care_jobs=[j for j in d['care_jobs'] if j.get('kind') == 'inline']))
    assert not workspace.process_next(store, force=True)
    assert store.read()['care_jobs'][0]['status'] == 'queued'


def test_worker_recovery_invalidates_an_in_flight_model_result(api, monkeypatch):
    post(api, '/elders/E1/record', {'text': '老人说今天想休息。', 'background': True})
    store=api[1]
    provider=ai_service.get_ai_provider()
    original=provider.extract
    def recover_during_call(*args, **kwargs):
        original(*args, **kwargs)
        workspace.recover_jobs(store)
        return original(*args, **kwargs)
    monkeypatch.setattr(provider, 'extract', recover_during_call)
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: provider)
    assert jobs.process_inline_next(store)
    data=store.read()
    assert data['record_analyses']==[]
    assert data['care_jobs'][0]['status']=='queued'
