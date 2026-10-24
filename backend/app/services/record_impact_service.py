"""Explicit record dependencies and human verification; never rewrite downstream history."""
import copy
import hashlib
import json

from app.services.workflow import DomainError, audit, current_staff, find, now, replayable


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def dependencies(data, record, through_revision=None):
    cutoff = through_revision or record.get('revision', 1)
    elder_id, record_id = record['elder_id'], record['id']
    result = []

    def old(version):
        return version is None or version <= cutoff

    def add(kind, row, reason, **state):
        result.append({'kind': kind, 'id': row['id'], 'relationship': reason,
                       'revision': row.get('revision', 1), 'status': row.get('status'), **state})

    memories = [r for r in data['care_memories'] if r['elder_id'] == elder_id and
                r['source']['record_id'] == record_id and old(r['source']['revision'])]
    memory_ids = {r['id'] for r in memories}
    for row in memories:
        add('memory', row, 'memory_source', source=copy.deepcopy(row['source']), content=row['content'])
    task_ids = set()
    for row in data['care_tasks']:
        if row['elder_id'] != elder_id:
            continue
        direct = row.get('source_record_id') == record_id and old(row.get('source_revision'))
        refs = [r for r in row.get('memory_references', []) if
                r['memory_id'] in memory_ids or
                (r.get('snapshot') or {}).get('source', {}).get('record_id') == record_id]
        if direct or refs:
            task_ids.add(row['id'])
            add('task', row, 'record_source' if direct else 'adopted_memory_source',
                title=row['title'], assigned_to=row.get('assigned_to'), shift_id=row.get('shift_id'),
                source_revision=row.get('source_revision'), memory_references=copy.deepcopy(refs),
                due_at=row.get('due_at'), condition=row.get('condition'),
                result=row.get('result'), updated_at=row.get('updated_at'))
    parents = {r['id']: r for r in data['handovers']}
    for row in data['handover_items']:
        if row['elder_id'] != elder_id:
            continue
        if not ((row['kind'] == 'record' and row['source_id'] == record_id and old(row.get('source_revision'))) or
                (row['kind'] == 'task' and row['source_id'] in task_ids)):
            continue
        parent = parents.get(row['handover_id'], {})
        add('handover_item', row, 'handover_snapshot', source_revision=row.get('source_revision'),
            handover_id=row['handover_id'], handover_revision=parent.get('revision'),
            handover_status=parent.get('status'), received_by=row.get('received_by'),
            received_at=row.get('received_at'), clarifications=copy.deepcopy(row.get('clarifications', [])),
            detail=row.get('detail'), target_shift_id=parent.get('target_shift_id'))
    for row in data['family_cases']:
        if row.get('kind') != 'summary' or row.get('elder_id') != elder_id:
            continue
        evidence = [r for r in row.get('evidence', []) if r['record_id'] == record_id and old(r['revision'])]
        if evidence:
            add('family_summary', row, 'summary_evidence', evidence=copy.deepcopy(evidence),
                reviewed_at=row.get('reviewed_at'))
    return sorted(result, key=lambda r: (r['kind'], r['id']))


def preview_from_data(data, record, payload):
    if record.get('revision', 1) != payload.expected_revision:
        raise DomainError('stale_revision')
    snapshot = {'record_id': record['id'], 'elder_id': record['elder_id'],
                'record_revision': record.get('revision', 1), 'before': list(record['observations']),
                'proposed': list(payload.observations), 'reason': payload.reason,
                'explicit_references': dependencies(data, record)}
    return {**snapshot, 'fingerprint': _hash(snapshot), 'possible_related': [],
            'notice': '仅列明确引用，不推断语义关联；核验清单不自动改写任务、交班或已发布摘要。'}


def preview(store, record_id, payload, user_id, role):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    return preview_from_data(data, find(data, 'care_records', record_id, 'record_not_found'), payload)


def checklist_from_data(data, record, correction):
    initial = correction.get('impact_review')
    if initial is None:
        return None
    current = {'record_revision': record.get('revision', 1),
               'references': dependencies(data, record, correction['previous_revision'])}
    fingerprint = _hash(current)
    events = [r for r in data['audit_logs'] if r['action'] == 'review_record_impact' and
              r['object_id'] == correction['id']]
    latest = events[-1] if events else None
    verified = bool(latest and latest['decision'] == 'verified' and latest['source_fingerprint'] == fingerprint)
    return {'correction_id': correction['id'], 'record_id': record['id'],
            'initial': copy.deepcopy(initial), 'current': current, 'fingerprint': fingerprint,
            'status': 'verified' if verified else 'pending',
            'latest_review': copy.deepcopy(latest),
            'notice': '已核验只表示人工核对记录的影响，不等于服务实际发生，也不会完成任务或重写历史。'}


def checklists(store, record_id, user_id, role):
    data = store.read()
    current_staff(data, user_id, role, management=True)
    record = find(data, 'care_records', record_id, 'record_not_found')
    return [view for row in record.get('corrections', []) if (view := checklist_from_data(data, record, row))]


def review(store, record_id, correction_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        record = find(data, 'care_records', record_id, 'record_not_found')
        correction = next((r for r in record.get('corrections', []) if r['id'] == correction_id), None)
        if correction is None or correction.get('impact_review') is None:
            raise DomainError('record_impact_checklist_not_found', 404)

        def operation():
            current = checklist_from_data(data, record, correction)
            if current['fingerprint'] != payload.expected_fingerprint:
                raise DomainError('record_impact_changed_refresh')
            audit(data, 'review_record_impact', correction_id, user_id, actor_role=role,
                  record_id=record_id, elder_id=record['elder_id'], decision=payload.decision,
                  source_fingerprint=current['fingerprint'], detail=payload.note,
                  reviewed_snapshot=copy.deepcopy(current['current']))
            return checklist_from_data(data, record, correction)
        return replayable(data, user_id, 'review_record_impact', key,
                          {'record_id': record_id, 'correction_id': correction_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
