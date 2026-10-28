"""Apply caregiver elder scope before existing route-specific business rules."""
from app.services.care_scope_service import require_elder_access


async def enforce(data, request, user_id, role):
    if role != 'caregiver':
        return
    elder_ids = set()
    for values in (request.path_params, request.query_params):
        value = values.get('elder_id')
        if isinstance(value, str) and value:
            elder_ids.add(value)
    # FastAPI caches its parsed JSON body, so this does not consume upload streams.
    if request.method in {'POST', 'PATCH', 'PUT'} and request.headers.get('content-type', '').split(';')[0] == 'application/json':
        try:
            body = await request.json()
        except ValueError:
            body = None  # Request validation reports malformed input separately.
        if isinstance(body, dict) and isinstance(body.get('elder_id'), str):
            elder_ids.add(body['elder_id'])
    collections = {'record_id': 'care_records', 'draft_id': 'ai_drafts', 'task_id': 'care_tasks',
                   'memory_id': 'care_memories', 'report_id': 'elder_impressions',
                   'assessment_id': 'assessments', 'plan_id': 'care_plans', 'advice_id': 'care_advice'}
    for parameter, collection in collections.items():
        object_id = request.path_params.get(parameter)
        row = next((r for r in data[collection] if r['id'] == object_id), None)
        if row:
            # An explicit assignee may read their own past task receipt without
            # gaining access to the elder's complete historical file.
            if (collection == 'care_tasks' and request.method == 'GET' and row.get('assigned_to') == user_id
                    and request.url.path.rstrip('/').endswith('/tasks/' + object_id)):
                continue
            elder_ids.add(row['elder_id'])
    item_id = request.path_params.get('item_id')
    if item_id:
        for collection in ('elders', *collections.values()):
            row = next((r for r in data[collection] if r['id'] == item_id), None)
            if row:
                elder_ids.add(row['id'] if collection == 'elders' else row['elder_id'])
                break
    for elder_id in elder_ids:
        require_elder_access(data, elder_id, user_id, role)
