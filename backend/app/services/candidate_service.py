"""Conservative display grouping, never an instruction to overwrite a memory."""
import re
from difflib import SequenceMatcher
from hashlib import sha256


def normalized(text):
    return re.sub(r'[\s，。！？、；：“”‘’,.!?;:\"\']', '', text).casefold()


def groups(rows):
    """Exact duplicate groups retain every candidate ID and its own citations.

    Similarity is only a hint between groups, including opposite wishes. Nothing
    is silently accepted, retired, or combined across dates or people.
    """
    result = {}
    for row in rows:
        text = row.get('display_summary') or row.get('content') or row.get('text') or ''
        context = (row.get('category') or row.get('group'), row.get('attributed_to') or row.get('expressor'),
                   row.get('valid_from'), row.get('expires_at', row.get('valid_until')), tuple(sorted(row.get('scenes', []))))
        key = repr((normalized(text), context))
        if key not in result:
            result[key] = {'id': 'GROUP-' + sha256(key.encode()).hexdigest()[:12],
                           'display_summary': text, 'items': [], 'similar_group_ids': [],
                           'requires_individual_review': True}
        result[key]['items'].append(row)
    values = list(result.values())
    for i, group in enumerate(values):
        group['count'] = len(group['items'])
        group['change_kind'] = 'duplicate' if group['count'] > 1 else 'new_or_changed'
        for other in values[i+1:]:
            if SequenceMatcher(None, normalized(group['display_summary']), normalized(other['display_summary'])).ratio() >= .72:
                group['similar_group_ids'].append(other['id'])
                other['similar_group_ids'].append(group['id'])
    return values


def point_identity(report, point):
    versions = {s['source_id']: s.get('revision', 1) for s in report.get('sources', [])}
    return (normalized(point['text']), point.get('category'), point.get('expressor'),
            tuple(sorted((c['source_id'], c['quote'], versions.get(c['source_id'])) for c in point['citations'])))


def previously_rejected(reports, point_report, point):
    identity = point_identity(point_report, point)
    return any(p['status'] == 'rejected' and point_identity(r, p) == identity
               for r in reports if r['id'] != point_report['id'] for p in r['points'])


def confirmed_match(point, memories):
    from app.services.personal_profile_service import presentation_text
    group = 'communication' if point['category'] == 'communication' else 'stable_preference'
    if point['category'] == 'attention':
        return None
    return next((m['id'] for m in memories if m.get('effective') and m['category'] == group
                 and m['attributed_to'] == point['expressor']
                 and normalized(presentation_text(m['content'])) == normalized(presentation_text(point['text']))), None)


def consolidate(store, elder_id, payload, user_id, role, key=None, preview=False):
    """Only human-selected, exact duplicate *candidates* may be archived.

    Independent evidence, changed versions, active memories and care requirements
    always need individual review. No record or provenance is deleted.
    """
    from copy import deepcopy
    from app.services import elder_workspace_service, memory_service
    from app.services.workflow import DomainError, find, replayable

    def identity(row):
        source = row['source']
        return (normalized(row['content']), row['category'], tuple(sorted(row['scenes'])),
                row['attributed_to'], row['valid_from'], row.get('expires_at'), row.get('review_due_at'),
                source['record_id'], source['revision'], source['field'], source['quote'],
                row.get('candidate_source'))

    def commit(data):
        elder_workspace_service.access(data, elder_id, user_id, role, management=True)
        def operation():
            selected = []
            for ref in [payload.keep, *payload.duplicates]:
                item = find(data, 'care_memories', ref.id, 'memory_not_found')
                if item['elder_id'] != elder_id:
                    raise DomainError('memory_not_found', 404)
                if item['revision'] != ref.expected_revision:
                    raise DomainError('stale_revision')
                if (item['status'] != 'candidate' or item['category'] not in {'stable_preference', 'communication'}
                        or not memory_service._view(data, item)['source_current']):
                    raise DomainError('duplicate_memory_requires_individual_review', 409)
                selected.append(item)
            keeper, *duplicates = selected
            if any(identity(row) != identity(keeper) for row in duplicates):
                raise DomainError('duplicate_memory_requires_individual_review', 409)
            if not preview:
                for row in duplicates:
                    before = memory_service._snapshot(row)
                    row.update(status='rejected', duplicate_of=keeper['id'])
                    memory_service._change(data, row, before, 'memory_duplicate_archived', payload.reason, user_id)
                before = memory_service._snapshot(keeper)
                keeper['duplicate_ids'] = list(dict.fromkeys(keeper.get('duplicate_ids', []) + [r['id'] for r in duplicates]))
                memory_service._change(data, keeper, before, 'memory_duplicates_grouped', payload.reason, user_id)
            return {'preview': preview, 'keep': memory_service._view(data, keeper),
                    'duplicates': [memory_service._view(data, row) for row in duplicates],
                    'notice': '只整理完全重复的待确认信息；全部来源和历史保留，仍需人工确认才能生效。'}
        return operation() if preview else replayable(data, user_id, 'consolidate_memory_duplicates', key,
            {'elder_id': elder_id, **payload.model_dump(mode='json')}, operation)
    return commit(deepcopy(store.read())) if preview else store.mutate(commit)
