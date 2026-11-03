"""Stable public errors. Resource hints never grant access or repeat inputs."""
from urllib.parse import quote


STATUS_MESSAGES = {
    400: '请检查填写内容后重试。', 401: '登录已失效，请重新登录。',
    403: '当前账号无权办理此事项，请核对岗位或联系主管。',
    404: '未找到相关资料，请刷新列表后核对。', 405: '当前操作不可用，请刷新页面。',
    409: '资料或状态已变化，请刷新并核对后重试。',
    413: '文件或录音过大，请缩小后重试。', 422: '请核对填写内容和时间范围。',
    429: '操作较频繁，请稍后重试。', 500: '服务暂时无法完成操作，请先核实保存结果再重试。',
    502: '上游服务暂不可用，请稍后重试。', 503: '服务暂不可用，请稍后重试或使用人工方式办理。',
    504: '处理等待超时，请先核实保存结果，再重试整理。',
}

HTTP_MESSAGES = {
    'Invalid username or password': ('invalid_credentials', '账号或密码不正确，请重新输入。'),
    'Authentication required': ('authentication_required', STATUS_MESSAGES[401]),
    'Invalid or expired token': ('session_expired', STATUS_MESSAGES[401]),
    'Account is inactive or permissions changed': ('account_permissions_changed', '账号状态或岗位已变化，请重新登录。'),
    'Insufficient permissions': ('insufficient_permissions', STATUS_MESSAGES[403]),
    'Elder not found': ('elder_not_found', STATUS_MESSAGES[404]),
    'Not found': ('not_found', STATUS_MESSAGES[404]),
    'Not Found': ('not_found', STATUS_MESSAGES[404]),
    'Demo role unavailable': ('demo_role_unavailable', '演示身份不可用，请使用现有账号登录。'),
    'AI unavailable or output invalid; use manual summary': ('summary_generation_unavailable', '交班整理暂不可用，请手工填写摘要。'),
    'AI unavailable or output invalid; retry with include_ai=false': ('quality_ai_unavailable', '辅助检查暂不可用，可继续规则检查。'),
    '个人特性整理暂未完成，已确认资料和原文仍然保留。': ('trait_generation_unavailable', '个人特性整理暂未完成，已确认资料和原文仍然保留。'),
    '简报整理暂不可用，请手工填写；尚未向家属发布任何内容': ('family_summary_ai_unavailable', '简报整理暂不可用，请手工填写；尚未向家属发布任何内容。'),
    '近况整理暂不可用，已保留原有动态，请稍后重试。': ('family_insight_unavailable', '近况整理暂不可用，已保留原有动态，请稍后重试。'),
    '辅助整理暂不可用，请直接人工上报，不必等待': ('incident_preparation_unavailable', '辅助整理暂不可用，请直接人工上报。'),
    '照护建议暂时无法整理，已有记录不受影响，请稍后重试或手工安排': ('care_advice_ai_unavailable', '照护建议暂时无法整理，已有记录不受影响，请稍后重试或手工安排。'),
    '老人印象整理暂不可用，原有记录不受影响，请稍后重试': ('impression_ai_unavailable', '老人印象整理暂不可用，原有记录不受影响，请稍后重试。'),
    '评估预填暂时不可用，请直接补充现场观察；已有记录不受影响': ('assessment_ai_unavailable', '评估预填暂时不可用，请直接补充现场观察；已有记录不受影响。'),
}


def reload_resource(request):
    """Only point to existing GET resources, using the current request's IDs."""
    if request is None:
        return None
    params = request.path_params
    mapping = [('task_id', '/tasks/'), ('incident_id', '/incidents/'), ('plan_id', '/care-plans/'),
               ('assessment_id', '/assessments/'), ('record_id', '/records/'),
               ('draft_id', '/records/drafts/'), ('handover_id', '/handovers/'),
               ('memory_id', '/memories/'),
               ('elder_id', '/elders/')]
    for key, prefix in mapping:
        if params.get(key):
            return {'id': params[key], 'path': prefix + quote(str(params[key]), safe=''), 'method': 'GET'}
    if params.get('case_id') and '/change-reviews/' in request.url.path:
        return {'id': params['case_id'], 'path': '/change-reviews/' + quote(params['case_id'], safe=''), 'method': 'GET'}
    if params.get('summary_id'):
        return {'id': params['summary_id'], 'path': '/family/cases?kind=summary', 'method': 'GET'}
    if params.get('rectification_id'):
        return {'id': params['rectification_id'], 'path': '/incidents', 'method': 'GET'}
    return None


def body(code, status, message=None, *, detail=None, fields=(), request=None, resource=None):
    conflict = None
    if status == 409:
        conflict = ('revision' if 'revision' in code else 'idempotency' if 'idempotency' in code
                    else 'context' if any(s in code for s in ('changed', 'stale', 'context')) else 'state')
    paths = [p if '.' in p else 'body.' + p for p in fields]
    safe = message or STATUS_MESSAGES.get(status, STATUS_MESSAGES[500] if status >= 500 else STATUS_MESSAGES[400])
    return {'detail': code if detail is None else detail, 'error_code': code, 'safe_message': safe,
            'field_paths': paths,
            'field_errors': [{'path': p, 'error_code': code, 'safe_message': safe} for p in paths],
            'retryable': status in {429, 502, 503, 504}, 'conflict_type': conflict,
            'reload_resource': (reload_resource(request) or resource) if status == 409 else None}


def validation_message(error_type):
    return {'missing': '此项必填，请补充。', 'timezone_aware': '请选择带时区的日期时间。',
            'datetime_parsing': '日期时间格式不正确，请重新选择。',
            'date_from_datetime_parsing': '日期格式不正确，请重新选择。',
            'string_too_long': '内容超过长度限制，请缩短。', 'string_too_short': '内容不完整，请补充。',
            'int_parsing': '请输入整数。', 'literal_error': '请选择有效选项。',
            'extra_forbidden': '包含当前表单不支持的字段，请刷新后重试。',
            'greater_than_equal': '数值低于允许范围，请核对。',
            'less_than_equal': '数值超过允许范围，请核对。'}.get(error_type, '内容或格式不符合本项要求，请核对。')


def request_fields(request, fields):
    """A shared business code must not point at fields absent on this route."""
    if request is None:
        return fields
    route = request.scope.get('route')
    dependency = getattr(route, 'dependant', None)
    if dependency is None:
        return []
    allowed = set()
    for location, name in (('body', 'body_params'), ('query', 'query_params'),
                           ('header', 'header_params'), ('path', 'path_params')):
        for field in getattr(dependency, name, []):
            model = getattr(field, 'type_', None) or getattr(getattr(field, 'field_info', None), 'annotation', None)
            if location == 'body' and hasattr(model, 'model_fields'):
                allowed.update('body.' + (meta.alias or key) for key, meta in model.model_fields.items())
            else:
                allowed.add(location + '.' + field.alias)
    normalized = [f if '.' in f else 'body.' + f for f in fields]
    result = []
    for field in normalized:
        candidates = [field]
        if field.startswith('body.'):
            name = field[5:]
            candidates.append('query.' + name)
            if name == 'evidence':
                candidates.append('body.selections')
            if name in {'task_candidates', 'accepted_tasks', 'assigned_to', 'due_at'}:
                candidates.extend(['body.task_candidates', 'body.accepted_tasks'])
        match = next((candidate for candidate in candidates if candidate in allowed), None)
        if match and match not in result:
            result.append(match)
    return result
