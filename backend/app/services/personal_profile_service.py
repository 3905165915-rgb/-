"""Presentation summaries for human-approved personal impressions.

Summarising never approves a new fact or rewrites a memory, its sources or history.
"""
from __future__ import annotations

import re

from app.services.workflow import DomainError, audit, find, now


def presentation_text(value, elder_name=None):
    """Readable legacy fallback, not a fabricated model result; keep time/negation."""
    text = str(value or '').strip()
    text = re.sub(r'^[\u4e00-\u9fff]{1,16}?(?:说|表示|提到|补充)[：:]\s*', '', text)
    text = text.strip('“”「」"\'。 \n')
    if elder_name and text.startswith(elder_name):
        text = text[len(elder_name):].lstrip('，,：: ')
    text = re.sub(r'^(?:我|本人)(?=一直|每天|每日|每周|经常|今天|这次|本次|现在|暂时|喜欢|不喜欢|习惯|愿意|不愿)', '', text)
    return text.strip()


def fallback_preferences(text):
    """Deterministic mock/legacy support; real providers return separate candidates."""
    candidates = []
    for phrase in re.split(r'[。！？；;\n]|[，,](?=\s*(?:请|随后|接着|护理员|喜欢|不喜欢|习惯|偏好))', text):
        if not re.search(r'喜欢|偏好|习惯|愿意|不愿', phrase):
            continue
        quote = phrase.strip()
        if not quote:
            continue
        candidates.append({'content': presentation_text(quote), 'evidence_text': quote,
            'group': 'communication' if '沟通' in quote or '说话' in quote else 'preference',
            'attributed_to': 'elder' if re.search(r'老人说|本人说|我喜欢|我愿意|爷爷说|奶奶说|阿姨说|叔叔说', quote) else 'unknown'})
    return candidates[:10]


def presentation(row, elder_name=None):
    saved = row.get('presentation') or {}
    if saved.get('memory_revision') == row.get('revision') and saved.get('text'):
        return saved['text']
    return presentation_text(row['content'], elder_name)


def set_presentation(row, text, provider, user_id):
    row['presentation'] = {'text': text, 'memory_revision': row['revision'],
        'provider': provider, 'created_at': now(), 'created_by': user_id}


def summarize(store, elder_id, user_id, role):
    from app.services.elder_workspace_service import access, understanding
    from app.services import memory_service
    from app.services.ai_service import AIProviderError, get_ai_provider
    from app.services.ai_outputs import validate_citations

    snapshot = store.read()
    access(snapshot, elder_id, user_id, role)
    eligible = [memory_service._view(snapshot, row) for row in snapshot['care_memories']
                if row['elder_id'] == elder_id]
    pending = [row for row in eligible if row['effective'] and
               (row.get('presentation') or {}).get('memory_revision') != row['revision']]
    if not pending:
        return understanding(store, elder_id, user_id, role)
    provider = get_ai_provider()
    prepared = {}
    # Calls run outside the JSON lock; small batches bound cost and response size.
    for start in range(0, len(pending), 20):
        batch = pending[start:start+20]
        sources = [{'source_id': row['id'], 'text': row['content']} for row in batch]
        output = validate_citations(provider.personal_profile(sources), sources, 'summary')
        for point in output['points']:
            ids = {citation['source_id'] for citation in point['citations']}
            if len(ids) != 1 or next(iter(ids)) in prepared:
                raise AIProviderError('Personal summaries must cover each approved item once')
            prepared[next(iter(ids))] = point['text']
    if set(prepared) != {row['id'] for row in pending}:
        raise AIProviderError('Incomplete personal summary')

    def commit(data):
        access(data, elder_id, user_id, role)
        if data.get('demo_batch_id') != snapshot.get('demo_batch_id'):
            raise DomainError('demo_batch_changed', 409)
        for previous in pending:
            live = find(data, 'care_memories', previous['id'], 'memory_not_found')
            if (live['revision'] != previous['revision'] or live['content'] != previous['content'] or
                    not memory_service._view(data, live)['effective']):
                raise DomainError('personal_impression_changed', 409)
        for previous in pending:
            live = find(data, 'care_memories', previous['id'], 'memory_not_found')
            set_presentation(live, prepared[live['id']], provider.name, user_id)
        audit(data, 'summarize_personal_impression', elder_id, user_id, elder_id=elder_id,
              memory_ids=[row['id'] for row in pending], provider=provider.name, queue_record_job=False)
    store.mutate(commit)
    return understanding(store, elder_id, user_id, role)
