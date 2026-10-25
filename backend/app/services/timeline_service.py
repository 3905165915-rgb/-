import copy
from datetime import datetime

from app.services.workflow import DomainError

LABELS = {
    'edit_ai_draft': '人工核对草稿', 'save_failed_ai_draft': '保留待人工整理的原文',
    'memory_keep': '复核后保留个性化信息', 'memory_suspend': '暂停个性化信息',
    'memory_resume': '恢复个性化信息', 'report_memory_refusal': '登记本次拒绝供复核',
    'review_record_impact': '复核记录更正的影响',
    'create_ai_draft': 'AI草稿', 'confirm_ai_draft': '人工确认', 'reject_ai_draft': '放弃草稿',
    'create_manual_record': '人工记录', 'correct_record': '记录更正', 'create_task': '生成任务',
    'update_task': '调整任务', 'complete_task': '任务完成', 'task_start': '开始执行',
    'task_not_done': '未执行', 'task_transfer': '任务转交', 'task_cancel': '任务取消',
    'task_reopen': '恢复任务', 'create_handover': '交班草稿', 'refresh_handover': '刷新交班',
    'submit_handover': '提交交班', 'receive_handover_item': '接班确认',
    'question_handover_item': '接班疑问', 'clarify_handover_item': '交班澄清',
    'carry_task': '跨班延续', 'generate_ai_summary': 'AI交班摘要草稿',
    'quality_scan': '规则质检', 'ai_quality_scan': 'AI质检建议', 'resolve_quality_issue': '质检处理',
    'create_memory': '个性化信息候选', 'revise_memory': '个性化信息修订',
    'memory_confirm': '个性化信息确认', 'memory_request_review': '个性化信息待复核',
    'memory_reject': '个性化信息驳回', 'memory_retire': '个性化信息停用',
    'memory_source_changed': '来源更正待复核',
    'adopt_task_memory': '任务采用个性化信息', 'withdraw_task_memory': '撤回任务采用关系',
    'create_change_review': '创建变更核验单', 'change_review_changed': '核验依据再次变更',
    'assign_change_review': '指派变更核验', 'submit_change_review': '提交核验结果',
    'review_change_review': '复查变更核验',
    'configure_task_condition': '配置条件核验', 'claim_task_condition': '认领条件核验',
    'check_task_condition': '人工核验条件', 'carry_task_condition': '跨班重新核验条件',
    'create_elder': '建立老人档案', 'update_elder': '修改老人档案',
    'admission_admit': '入住登记', 'admission_legacy_registration': '历史在院补登记',
    'admission_transfer': '换床', 'admission_out': '外出登记', 'admission_return': '返院登记',
    'admission_discharge': '离院登记',
    'create_assessment': '人工评估草稿', 'review_assessment': '评估人工审核',
    'supersede_assessment': '新评估替代旧版', 'create_plan': '照护计划草稿',
    'review_plan': '计划人工审批', 'supersede_plan': '新计划替代旧版',
    'create_plan_task': '计划生成待办', 'reissue_plan_task': '人工补发计划待办',
    'report_incident': '人工上报事件', 'triage_incident': '主管分级及安排整改',
    'assign_rectification': '整改责任转交', 'submit_rectification': '提交整改证据',
    'review_rectification': '独立复查整改', 'reopen_incident': '人工重开事件',
    'create_family_binding': '核实家属授权', 'revoke_family_binding': '撤销家属授权',
    'create_family_summary': '家属简报草稿', 'review_family_summary': '家属简报人工审核',
    'create_family_feedback': '家属反馈', 'reply_family_feedback': '回复家属反馈', 'export_case': '导出内部案例',
    'upload_attachment': '上传观察照片', 'review_attachment': '审核观察照片',
    'link_attachment': '关联观察照片', 'review_elder_impression': '核实老人印象',
    'create_photo_record': '确认照片人工观察',
    'recover_image_analysis': '照片整理中断待核对', 'discard_image_analysis': '照片依据变化，放弃整理结果',
    'memory_review_reminder': '个性化信息到期或变化待复核', 'edit_family_summary': '修改家属简报草稿',
    'analyze_image': '整理照片观察草稿', 'review_image_analysis': '核对照片观察',
    'assign_care_scope': '安排照护范围', 'revoke_care_scope': '撤销照护范围',
    'generate_elder_impression': '整理老人印象', 'review_impression_point': '核实老人印象',
}


def event_type(action):
    if 'impression' in action:
        return 'memory'
    if 'attachment' in action or 'image_analysis' in action or action in {'analyze_image', 'create_photo_record'}:
        return 'record'
    if action in {'create_ai_draft', 'edit_ai_draft', 'save_failed_ai_draft', 'confirm_ai_draft',
                  'reject_ai_draft', 'create_manual_record', 'correct_record', 'review_record_impact'}:
        return 'record'
    if action.startswith('task_') or action in {'create_task', 'update_task', 'complete_task', 'create_plan_task',
                                                'reissue_plan_task', 'adopt_task_memory',
                                                'withdraw_task_memory', 'configure_task_condition',
                                                'claim_task_condition', 'check_task_condition', 'carry_task_condition'}:
        return 'task'
    if 'handover' in action or action == 'carry_task':
        return 'handover'
    if 'memory' in action or action in {'create_change_review', 'change_review_changed',
                                        'assign_change_review', 'submit_change_review',
                                        'review_change_review'}:
        return 'memory'
    if action in {'report_incident', 'triage_incident', 'assign_rectification',
                  'submit_rectification', 'review_rectification', 'reopen_incident'}:
        return 'incident'
    if (action.startswith('create_family_') or action.startswith('review_family_')
            or action in {'reply_family_feedback', 'edit_family_summary'}):
        return 'family'
    return 'other'


def timeline(store, item_id, limit=200, offset=0, user_id=None, role='supervisor',
             event_types=None, start: datetime | None = None, end: datetime | None = None, _data=None):
    if start is not None and start.tzinfo is None or end is not None and end.tzinfo is None:
        raise DomainError('timeline_time_requires_timezone', 422)
    if start is not None and end is not None and start >= end:
        raise DomainError('timeline_time_range_invalid', 422)
    data = _data if _data is not None else store.read()
    collections = ['elders', 'admissions', 'assessments', 'care_plans', 'ai_drafts', 'care_records', 'care_tasks', 'handovers', 'quality_checks', 'care_memories', 'change_reviews', 'incidents', 'rectifications', 'family_cases']
    root = next(((name, row) for name in collections for row in data[name] if row['id'] == item_id), None)
    if root is None:
        raise DomainError('timeline_subject_not_found', 404)
    kind, item = root
    if role == 'caregiver':
        if kind == 'family_cases':
            raise DomainError('management_required', 403)
        if kind in {'incidents', 'rectifications'}:
            from app.services.incident_service import access as incident_access
            incident = item if kind == 'incidents' else next(row for row in data['incidents'] if row['id'] == item['incident_id'])
            incident_access(data, incident, user_id, role)
        if kind == 'assessments':
            from app.services.assessment_service import access as assessment_access
            assessment_access(item, user_id, role)
        if kind == 'care_plans':
            from app.services.plan_service import access as plan_access
            plan_access(item, role)
        if kind == 'admissions':
            raise DomainError('management_required', 403)
        if kind == 'quality_checks':
            raise DomainError('management_required', 403)
        if kind == 'ai_drafts' and item.get('created_by') != user_id:
            raise DomainError('only_author_or_management_can_view_draft', 403)
        if kind == 'handovers':
            from app.services.handover_service import access
            access(data, item, user_id, role)
        if kind == 'change_reviews':
            from app.services.change_review_service import access
            access(item, user_id, role)
    ids = {item_id}
    if kind == 'handovers':
        ids.update(row['source_id'] for row in data['handover_items'] if row['handover_id'] == item_id)
    if kind == 'quality_checks':
        ids.update(row['source_id'] for issue in item['issues'] for row in issue['citations'])
    if kind == 'elders':
        for name in ['ai_drafts', 'care_records', 'care_tasks', 'handover_items', 'quality_checks', 'care_memories', 'assessments', 'care_plans']:
            ids.update(row['id'] for row in data[name] if row.get('elder_id') == item_id)
        if role in {'admin', 'supervisor'}:
            ids.update(row['id'] for row in data['admissions'] if row.get('elder_id') == item_id)
            ids.update(row['id'] for row in data['family_cases'] if row.get('elder_id') == item_id)
        ids.update(row['id'] for row in data['incidents'] if row.get('elder_id') == item_id)
        for name in ('rectifications', 'elder_impressions', 'attachments', 'image_analyses', 'care_assignments'):
            ids.update(row['id'] for row in data[name] if row.get('elder_id') == item_id)
    if kind == 'rectifications':
        ids.add(item['incident_id'])
    if kind == 'care_tasks' and item.get('source_record_id'):
        ids.add(item['source_record_id'])
    if kind == 'care_tasks' and item.get('source_plan_id'):
        ids.add(item['source_plan_id'])
    if kind == 'care_plans':
        ids.add(item['assessment_id'])
        ids.update(row['id'] for row in data['care_tasks'] if row.get('source_plan_id') == item_id)
    if kind == 'assessments':
        ids.update(row['record_id'] for row in item['evidence'])
        ids.update(row['id'] for row in data['care_plans'] if row['assessment_id'] == item_id)
    if kind == 'ai_drafts':
        ids.update(row['id'] for row in data['care_records'] if row.get('source_draft_id') == item_id)
    if kind == 'care_memories':
        ids.add(item['source']['record_id'])
        ids.update(change['before']['source']['record_id'] for change in item['history'])
        ids.update(row['id'] for row in data['care_tasks']
                   if any(ref['memory_id'] == item_id for ref in row.get('memory_references', [])))
    if kind == 'care_tasks':
        ids.update(ref['memory_id'] for ref in item.get('memory_references', []))
        verification = item.get('condition_verification') or {}
        for event in verification.get('history', []):
            for snapshot in (event.get('before'), event.get('after')):
                check = (snapshot or {}).get('latest_check') or {}
                ids.update(source['record_id'] for source in check.get('evidence', []))
    if kind == 'change_reviews':
        ids.update((item['task_id'], item['memory_id']))
        ids.add(item['initial_snapshot']['reference']['snapshot']['source']['record_id'])
    record_ids = {row['id'] for row in data['care_records'] if row['id'] in ids}
    if kind != 'care_memories':
        ids.update(row['id'] for row in data['care_memories'] if row['source']['record_id'] in record_ids
                   or any(change['before']['source']['record_id'] in record_ids for change in row['history']))
    ids.update(row['source_draft_id'] for row in data['care_records'] if row['id'] in record_ids and row.get('source_draft_id'))
    if kind != 'care_tasks':
        ids.update(row['id'] for row in data['care_tasks'] if row.get('source_record_id') in record_ids)
    ids.update(row['id'] for row in data['handover_items'] if row['source_id'] in ids)
    ids.update(row['handover_id'] for row in data['handover_items'] if row['id'] in ids)
    if kind == 'handovers':
        ids.update(row['id'] for row in data['handover_items'] if row['handover_id'] == item_id)
    ids.update(row['id'] for row in data['change_reviews'] if row['task_id'] in ids or row['memory_id'] in ids
               or (kind == 'elders' and row['elder_id'] == item_id))
    users = {row['id']: row.get('display_name', row['id']) for row in data['users']}
    events = []
    drafts = {row['id']: row for row in data['ai_drafts']}
    assessment_objects = {row['id']: row for row in data['assessments']}
    plan_objects = {row['id']: row for row in data['care_plans']}
    change_cases = {row['id']: row for row in data['change_reviews']}
    family_case_ids = {row['id'] for row in data['family_cases']}
    incidents = {row['id']: row for row in data['incidents']}
    handover_objects = {row['id']: row['id'] for row in data['handovers']}
    handover_objects.update({row['id']: row['handover_id'] for row in data['handover_items']})
    visible_handovers = set()
    if role == 'caregiver':
        from app.services.handover_service import access as handover_access
        for handover in data['handovers']:
            try:
                handover_access(data, handover, user_id, role)
                visible_handovers.add(handover['id'])
            except DomainError:
                continue
    for row in data['audit_logs']:
        if row.get('object_id') not in ids:
            continue
        if role == 'caregiver':
            if row['action'] == 'export_case':
                continue
            if row['object_id'] in family_case_ids:
                continue
            if row['object_id'] in incidents:
                from app.services.incident_service import access as incident_access
                try:
                    incident_access(data, incidents[row['object_id']], user_id, role)
                except DomainError:
                    continue
            if row['object_id'] in plan_objects and plan_objects[row['object_id']]['status'] in {'draft', 'rejected'}:
                continue
            assessment = assessment_objects.get(row['object_id'])
            if assessment and assessment['status'] in {'draft', 'rejected'} and assessment['created_by'] != user_id:
                continue
            handover_id = row.get('handover_id') or handover_objects.get(row['object_id'])
            if handover_id and handover_id not in visible_handovers:
                continue
            if row['object_id'] in change_cases and change_cases[row['object_id']]['assigned_to'] != user_id:
                continue
            if row['action'] in {'quality_scan', 'ai_quality_scan', 'resolve_quality_issue'}:
                continue
            if row['object_id'] in drafts and drafts[row['object_id']].get('created_by') != user_id:
                continue
        event = {
            'id': row['id'], 'label': LABELS.get(row['action'], '业务操作'),
            'action': row['action'], 'event_type': event_type(row['action']), 'detail': row.get('detail', ''),
            'actor': users.get(row['user_id'], row['user_id']), 'actor_id': row['user_id'],
            'source_id': row['object_id'], 'happened_at': row['created_at'], 'entered_at': row['created_at'],
        }
        if row['action'] == 'create_ai_draft' and row['object_id'] in drafts:
            draft = drafts[row['object_id']]
            event.update(raw_text=draft['raw_text'], evidence=draft.get('evidence', []), provider=draft['provider'])
            if draft.get('generation_kind') == 'context_record':
                event.update(generation_kind='context_record', context_notes=draft.get('context_notes', []),
                             memory_candidates=draft.get('memory_candidates', []), context_snapshot=draft.get('context_snapshot'))
        if 'correction' in row:
            correction = copy.deepcopy(row['correction'])
            if role not in {'admin', 'supervisor'}:
                correction.pop('impact_review', None)
            event['correction'] = correction
        for field in ('before', 'after', 'decision', 'issue_id', 'memory_change', 'reference', 'task_revision',
                      'case_revision', 'change_action', 'observation', 'condition_change'):
            if field in row:
                event[field] = row[field]
        record = next((record for record in data['care_records'] if record['id'] == row['object_id']), None)
        if row['action'] == 'create_manual_record' and record and record.get('happened_at'):
            event['happened_at'] = record['happened_at']
        if kind == 'elders' and row['object_id'] in {h['id'] for h in data['handovers']}:
            # A shared handover may contain other elders. Return navigation and
            # action metadata, never a whole-hand-over summary/snapshot here.
            event = {key: value for key, value in event.items() if key in {
                'id', 'label', 'action', 'event_type', 'actor', 'actor_id', 'source_id', 'happened_at', 'entered_at'}}
            event['detail'] = '关联交班操作，请在授权交班详情中查看相关事项'
        events.append(event)
    if event_types:
        requested = set(event_types)
        allowed = {'record', 'task', 'handover', 'memory', 'incident', 'family', 'other'}
        if not requested.issubset(allowed):
            raise DomainError('timeline_event_type_invalid', 422)
        events = [event for event in events if event['event_type'] in requested]
    def in_window(event):
        instant = event.get('happened_at') or event['entered_at']
        from app.services.workflow import parse_time
        value = parse_time(instant)
        return (start is None or value >= start) and (end is None or value < end)
    events = [event for event in events if in_window(event)]
    from app.services.workflow import parse_time
    return sorted(events, key=lambda row: (parse_time(row['happened_at']), parse_time(row['entered_at']), row['id']))[offset:offset+limit]


def elder_timeline(store, elder_id, user_id, role, limit=200, offset=0,
                   event_types=None, start: datetime | None = None, end: datetime | None = None):
    """A caregiver workbench timeline limited by the server-side current work scope."""
    data = store.read()
    if role == 'caregiver':
        from app.services.care_scope_service import require_elder_access
        require_elder_access(data, elder_id, user_id, role)
    else:
        from app.services.workflow import current_staff
        current_staff(data, user_id, role)
        from app.services.workflow import find
        find(data, 'elders', elder_id, 'elder_not_found')
    events = timeline(store, elder_id, len(data['audit_logs']), 0, user_id, role, event_types, start, end, _data=data)
    total = len(events)
    return {
        'elder_id': elder_id,
        'filters': {
            'event_types': sorted(set(event_types or [])),
            'start_inclusive': start.isoformat() if start else None,
            'end_exclusive': end.isoformat() if end else None,
        },
        'events': events[offset:offset + limit],
        'total': total, 'offset': offset, 'limit': limit, 'has_more': offset + limit < total,
        'notice': '时间线展示已登记、可追溯的系统事件；记录或任务状态不能单独证明现实服务必然发生。',
    }
