"""Durable record analysis. Save and enqueue atomically; model calls never hold the file lock."""
from copy import deepcopy

from app.services.workflow import DomainError, identifier, now, find, current_staff


def _enqueue(data, record, actor, role, scene=None, retry=False):
    existing = next((j for j in reversed(data['care_jobs']) if j.get('kind') == 'inline'
                     and j['record_id'] == record['id'] and j['record_revision'] == record.get('revision', 1)), None)
    if existing:
        if retry and existing['status'] == 'failed':
            existing.update(status='queued', error_code=None, updated_at=now())
        return existing
    job = dict(id=identifier('JOB'), kind='inline', elder_id=record['elder_id'],
               record_id=record['id'], record_revision=record.get('revision', 1),
               created_by=actor, role=role, scene=scene, batch_id=data.get('demo_batch_id'),
               status='queued', attempts=0, created_at=now(), updated_at=now(),
               not_before=now(), result=None, error_code=None)
    data['care_jobs'].append(job)
    return job


def save_background(store, elder_id, payload, user_id, role, key):
    from app.schemas.api import ManualRecordRequest
    from app.services import record_service
    from app.services.elder_workspace_service import TransactionStore, enqueue_record
    def commit(data):
        nested = TransactionStore(data)
        result = record_service.manual(nested, ManualRecordRequest(elder_id=elder_id,
            raw_text=payload.text, observations=[payload.text], shift_id=payload.shift_id,
            happened_at=payload.happened_at, attachment_ids=payload.attachment_ids,
            task_candidates=[]), user_id, role, key, queue_analysis=False)
        _enqueue(data, result['record'], user_id, role, payload.scene)
        enqueue_record(data, result['record']['id'], user_id)
        return result['record']['id']
    record_id = store.mutate(commit)
    return status(store, elder_id, record_id, user_id, role)


def status(store, elder_id, record_id, user_id, role):
    from app.services.elder_workspace_service import _record_analysis_data, inline_record_envelope
    data = store.read()
    record, _ = _record_analysis_data(data, record_id, user_id, role)
    if record['elder_id'] != elder_id:
        raise DomainError('record_not_found', 404)
    analysis = next((a for a in reversed(data['record_analyses']) if a['record_id'] == record_id
                     and a['record_revision'] == record.get('revision', 1)), None)
    if analysis:
        return inline_record_envelope(store, record_id, analysis)
    job = next((j for j in reversed(data['care_jobs']) if j.get('kind') == 'inline'
                and j['record_id'] == record_id and j['record_revision'] == record.get('revision', 1)), None)
    state = job['status'] if job and job['status'] in {'queued', 'processing', 'failed'} else 'failed'
    return inline_record_envelope(store, record_id, {'status': state})


def retry(store, elder_id, record_id, user_id, role):
    from app.services.elder_workspace_service import _record_analysis_data
    def commit(data):
        record, _ = _record_analysis_data(data, record_id, user_id, role)
        if record['elder_id'] != elder_id:
            raise DomainError('record_not_found', 404)
        job = _enqueue(data, record, user_id, role, retry=True)
        if job['status'] == 'queued':
            data['record_analyses'] = [a for a in data['record_analyses'] if not
                (a['record_id'] == record_id and a['record_revision'] == record.get('revision', 1) and a['status'] == 'failed')]
    store.mutate(commit)
    return status(store, elder_id, record_id, user_id, role)


def process_inline_next(store):
    from app.services.elder_workspace_service import analyze_record, persist_analysis_failure, analysis_failure_code
    def claim(data):
        job = next((j for j in data['care_jobs'] if j.get('kind') == 'inline' and j['status'] == 'queued'), None)
        if not job:
            return None
        job.update(status='processing', attempts=job['attempts'] + 1,
                   updated_at=now(), claim_token=identifier('CLAIM'))
        return deepcopy(job)
    if not any(j.get('kind') == 'inline' and j['status'] == 'queued' for j in store.read()['care_jobs']):
        return False
    job = store.mutate(claim)
    if not job:
        return False
    error = None
    try:
        data = store.read()
        if data.get('demo_batch_id') != job.get('batch_id'):
            raise DomainError('demo_batch_changed')
        actor = current_staff(data, job['created_by'])
        record = find(data, 'care_records', job['record_id'], 'record_not_found')
        if record.get('revision', 1) != job['record_revision']:
            raise DomainError('record_changed_during_ai_call')
        analyze_record(store, record['id'], actor['id'], actor['role'], job.get('scene'), claim=job)
    except Exception as exc:
        error = analysis_failure_code(exc)
        # Never write a failure onto a replacement batch or a revised source.
        live = store.read()
        record = next((r for r in live['care_records'] if r['id'] == job['record_id']), None)
        if (live.get('demo_batch_id') == job.get('batch_id') and record
                and record.get('revision', 1) == job['record_revision']):
            try:
                persist_analysis_failure(store, record['id'], job['created_by'], job['role'], error, claim=job)
            except DomainError:
                pass
    def finish(data):
        live = next((j for j in data['care_jobs'] if j['id'] == job['id'] and j.get('claim_token') == job['claim_token']), None)
        if live and live['status'] == 'processing':
            live.update(status='failed' if error else 'completed', updated_at=now(), error_code=error)
    store.mutate(finish)
    return True
