from __future__ import annotations

import hashlib
import json

from pydantic import ValidationError

from app.models.entities import AIDraft, CareRecord, CareTask
from app.schemas.api import CorrectRecordRequest, ManualRecordRequest, TaskCandidate
from app.storage.json_store import JsonStore
from app.services.workflow import DomainError, active_staff, audit, editable, find, identifier, now, open_shift, replayable
from app.services.workflow import current_staff
from app.services.facility_service import care_eligible, care_state


def record_list(store: JsonStore, elder_id=None, shift_id=None, limit=100, offset=0) -> list[CareRecord]:
    items = store.read()['care_records']
    items = [item for item in items if (elder_id is None or item['elder_id'] == elder_id)
             and (shift_id is None or item.get('shift_id') == shift_id)]
    return [CareRecord.model_validate(item) for item in sorted(items, key=lambda x: (x['created_at'], x['id']), reverse=True)[offset:offset+limit]]


def record_detail(store: JsonStore, record_id: str) -> CareRecord:
    return CareRecord.model_validate(find(store.read(), 'care_records', record_id, 'record_not_found'))


def draft_list(store: JsonStore, user_id: str, role: str, elder_id=None, status=None, limit=100, offset=0) -> list[AIDraft]:
    items = store.read()['ai_drafts']
    items = [item for item in items if (elder_id is None or item['elder_id'] == elder_id)
             and (status is None or item['status'] == status)
             and (role in {'admin', 'supervisor'} or item.get('created_by') == user_id)]
    return [AIDraft.model_validate(item) for item in sorted(items, key=lambda x: (x['created_at'], x['id']), reverse=True)[offset:offset+limit]]


def draft_detail(store: JsonStore, draft_id: str, user_id: str, role: str) -> AIDraft:
    data = store.read()
    item = find(data, 'ai_drafts', draft_id, 'draft_not_found')
    editable(data, item, user_id, role)
    return AIDraft.model_validate(item)


def create_tasks(data: dict, record: CareRecord, candidates: list[dict], user_id: str, role='supervisor') -> list[CareTask]:
    tasks = []
    if len(candidates) > 50:
        raise DomainError('too_many_task_candidates', 422)
    for raw in candidates:
        try:
            candidate = TaskCandidate.model_validate(raw)
        except ValidationError as exc:
            raise DomainError('invalid_task_candidate', 422) from exc
        active_staff(data, candidate.assigned_to)
        if candidate.assigned_to:
            if record.shift_id:
                shift = find(data, 'shifts', record.shift_id, 'shift_not_found')
                if candidate.assigned_to not in shift['caregiver_ids']:
                    raise DomainError('assignee_not_in_shift', 422)
            if role == 'caregiver' and candidate.assigned_to != user_id:
                raise DomainError('management_required_to_assign_others', 403)
        task = CareTask(
            id=identifier('TASK'), elder_id=record.elder_id, shift_id=record.shift_id,
            title=candidate.title, due_at=candidate.due_at.isoformat() if candidate.due_at else None,
            assigned_to=candidate.assigned_to, condition=candidate.condition, due_text=candidate.due_text,
            source_record_id=record.id, created_by=user_id, created_at=now(), updated_at=now(),
        )
        tasks.append(task)
    data['care_tasks'].extend(item.model_dump() for item in tasks)
    for task in tasks:
        audit(data, 'create_task', task.id, user_id, elder_id=record.elder_id, record_id=record.id,
              shift_id=record.shift_id, detail=task.title)
    return tasks


def confirm(store: JsonStore, draft_id: str, user_id: str, observations, candidates, role='supervisor'):
    def mutate(data):
        current_staff(data, user_id, role)
        draft = find(data, 'ai_drafts', draft_id, 'draft_not_found')
        editable(data, draft, user_id, role)
        values = observations if observations is not None else draft.get('observations', [])
        if not values or any(not isinstance(value, str) or not value.strip() or len(value) > 5000 for value in values) or len(values) > 50:
            raise DomainError('observations_required', 422)
        proposed = candidates if candidates is not None else draft.get('task_candidates', [])
        if len(proposed) > 50:
            raise DomainError('too_many_task_candidates', 422)
        try:
            normalized = [TaskCandidate.model_validate(row).model_dump(mode='json', include={
                'title', 'due_at', 'assigned_to', 'condition', 'due_text'}) for row in proposed]
        except ValidationError as exc:
            raise DomainError('invalid_task_candidate', 422) from exc
        fingerprint = hashlib.sha256(json.dumps({'observations': values, 'task_candidates': normalized},
                                    sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if draft['status'] == 'confirmed':
            # Compare the original confirmation, never mutable records/tasks. Older
            # confirmations without this fingerprint must be inspected, not guessed.
            if draft.get('confirmation_fingerprint') != fingerprint:
                raise DomainError('draft_already_confirmed_refresh_record')
            record = next((item for item in data['care_records'] if item.get('source_draft_id') == draft_id), None)
            if record is None:
                raise DomainError('confirmed_draft_has_no_record')
            return CareRecord.model_validate(record), [CareTask.model_validate(item) for item in data['care_tasks'] if item.get('source_record_id') == record['id']]
        if draft['status'] != 'pending_review':
            raise DomainError('draft_is_not_pending_review')
        elder = care_eligible(data, draft['elder_id'])
        if draft.get('generation_kind') != 'context_record':
            snapshot = draft.get('elder_state_snapshot')
            if ((snapshot is not None and snapshot != care_state(elder)) or
                    (snapshot is None and elder.get('care_state_version', 0) > 0)):
                raise DomainError('draft_elder_state_changed')
        open_shift(data, draft.get('shift_id'), user_id, role)
        from app.services.assistant_service import validate_draft_context
        validate_draft_context(data, draft)
        record = CareRecord(
            id=identifier('REC'), elder_id=draft['elder_id'], shift_id=draft.get('shift_id'),
            admission_id=elder.get('current_admission_id'),
            raw_text=draft['raw_text'], observations=values, created_by=user_id,
            source_draft_id=draft_id, created_at=now(), updated_at=now(),
        )
        tasks = create_tasks(data, record, normalized, user_id, role)
        data['care_records'].append(record.model_dump())
        draft.update(status='confirmed', confirmed_at=now(), confirmed_by=user_id, confirmation_fingerprint=fingerprint)
        audit(data, 'confirm_ai_draft', draft_id, user_id, elder_id=record.elder_id, record_id=record.id,
              detail='人工确认AI草稿', observations=values)
        return record, tasks
    return store.mutate(mutate)


def reject(store: JsonStore, draft_id: str, user_id: str, role: str, reason: str) -> AIDraft:
    def mutate(data):
        current_staff(data, user_id, role)
        draft = find(data, 'ai_drafts', draft_id, 'draft_not_found')
        editable(data, draft, user_id, role)
        if draft['status'] == 'rejected' and draft.get('rejection_reason') == reason:
            return AIDraft.model_validate(draft)
        if draft['status'] != 'pending_review':
            raise DomainError('draft_is_not_pending_review')
        draft.update(status='rejected', rejected_by=user_id, rejected_at=now(), rejection_reason=reason)
        audit(data, 'reject_ai_draft', draft_id, user_id, elder_id=draft['elder_id'], detail=reason)
        return AIDraft.model_validate(draft)
    return store.mutate(mutate)


def manual(store: JsonStore, payload: ManualRecordRequest, user_id: str, role: str, key=None) -> dict:
    def mutate(data):
        current_staff(data, user_id, role)
        def operation():
            elder = care_eligible(data, payload.elder_id)
            open_shift(data, payload.shift_id, user_id, role)
            values = payload.observations if payload.observations is not None else [payload.raw_text]
            if not values:
                raise DomainError('observations_required', 422)
            record = CareRecord(id=identifier('REC'), elder_id=payload.elder_id, shift_id=payload.shift_id,
                                admission_id=elder.get('current_admission_id'),
                                raw_text=payload.raw_text, observations=values, created_by=user_id,
                                created_at=now(), updated_at=now(),
                                happened_at=payload.happened_at.isoformat() if payload.happened_at else None)
            tasks = create_tasks(data, record, [item.model_dump(mode='json') for item in payload.task_candidates], user_id, role)
            data['care_records'].append(record.model_dump())
            audit(data, 'create_manual_record', record.id, user_id, elder_id=record.elder_id,
                  record_id=record.id, shift_id=record.shift_id, detail='人工录入正式记录')
            return {'record': record.model_dump(), 'tasks': [item.model_dump() for item in tasks]}
        return replayable(data, user_id, 'create_manual_record', key, payload.model_dump(mode='json'), operation)
    return store.mutate(mutate)


def correct(store: JsonStore, record_id: str, payload: CorrectRecordRequest, user_id: str, role: str, key=None) -> CareRecord:
    def mutate(data):
        current_staff(data, user_id, role)
        record = find(data, 'care_records', record_id, 'record_not_found')
        editable(data, record, user_id, role)
        def operation():
            revision = record.get('revision', 1)
            if payload.expected_revision != revision:
                raise DomainError('stale_revision')
            correction = {
                'id': identifier('CORR'), 'reason': payload.reason, 'created_by': user_id,
                'created_at': now(), 'previous_observations': list(record['observations']),
                'observations': payload.observations, 'previous_revision': revision, 'revision': revision + 1,
            }
            record.setdefault('corrections', []).append(correction)
            record.update(observations=payload.observations, status='corrected', revision=revision + 1, updated_at=now())
            from app.services.memory_service import invalidate_record_source
            invalidate_record_source(data, record_id, user_id, payload.reason)
            audit(data, 'correct_record', record_id, user_id, elder_id=record['elder_id'], record_id=record_id,
                  detail=payload.reason, correction=correction)
            return CareRecord.model_validate(record).model_dump()
        return replayable(data, user_id, 'correct_record', key, {'record_id': record_id, **payload.model_dump()}, operation)
    return CareRecord.model_validate(store.mutate(mutate))
