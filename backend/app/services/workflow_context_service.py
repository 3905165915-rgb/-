"""Read-only action hints. Commands still validate their own current context."""

MANAGEMENT = {'admin', 'supervisor'}
TASK_LABELS = {'pending': '待执行', 'overdue': '已逾期', 'in_progress': '执行中',
               'not_done': '未执行', 'completed': '已完成', 'cancelled': '已取消',
               'transferred': '已转交'}
ACTION_LABELS = {'start': '开始任务', 'complete': '反馈完成', 'not_done': '记录未执行原因',
                 'reopen': '重新安排', 'transfer': '转交任务', 'cancel': '取消任务'}


def hint(state_label, primary=None, assigned_to=None, roles=(), excluded_user_id=None, blocked_reason=None):
    return {'state_label': state_label, 'primary_action': primary, 'secondary_actions': [],
            'responsibility': {'assigned_to': assigned_to, 'roles': list(roles),
                               'excluded_user_id': excluded_user_id},
            'blocked_reason': blocked_reason}


def action(code, label, path, method='POST'):
    return {'code': code, 'label': label, 'path': path, 'method': method}


def task_workflow(task, allowed):
    primary = next((key for key in ('start', 'complete', 'reopen') if key in allowed), None)
    path = '/tasks/' + task['id'] + ('/complete' if primary == 'complete' else '/transition')
    return hint(TASK_LABELS.get(task['status'], '状态待核实'),
                action(primary, ACTION_LABELS[primary], path) if primary else None,
                task.get('assigned_to'), ('admin', 'supervisor', 'caregiver', 'nurse'))


def incident_workflow(item, user_id, role):
    rect = item.get('rectification') or {}
    state = 'closed' if item['status'] == 'closed' else rect.get('status') or item['status']
    labels = {'reported': '待人工分级', 'assigned': '整改中', 'awaiting_review': '待独立复查', 'closed': '已关闭'}
    primary, owner, roles, excluded, blocked = None, None, ('admin', 'supervisor'), None, None
    if state == 'reported' and role in MANAGEMENT:
        primary = action('triage', '分级并安排整改', '/incidents/' + item['id'] + '/triage')
    elif state == 'assigned':
        owner = rect.get('assigned_to')
        roles = ('admin', 'supervisor', 'caregiver', 'nurse')
        if owner == user_id and item.get('evidence_current'):
            primary = action('submit', '提交整改结果', '/rectifications/' + rect['id'] + '/submit')
        elif not item.get('evidence_current'):
            blocked = '事件依据已更新，请主管重新核对分级和整改安排。'
            if role in MANAGEMENT:
                primary = action('triage', '重新核对分级与安排', '/incidents/' + item['id'] + '/triage')
    elif state == 'awaiting_review':
        submission = (rect.get('submissions') or [{}])[-1]
        excluded = submission.get('by')
        if role in MANAGEMENT and user_id != excluded:
            primary = action('review', '复查整改', '/rectifications/' + rect['id'] + '/review')
        elif user_id == excluded:
            blocked = '整改已提交，等待另一位管理人员独立复查。'
    result = hint(labels.get(state, '状态待核实'), primary, owner, roles, excluded, blocked)
    if state == 'closed' and role in MANAGEMENT:
        result['secondary_actions'] = [action('reopen', '重新打开事件', '/incidents/' + item['id'] + '/reopen')]
    return result


def change_workflow(item, user_id, role):
    state = item['status']
    primary, excluded = None, None
    if state == 'pending' and role in MANAGEMENT:
        primary = action('assign', '安排核验', '/change-reviews/' + item['id'] + '/assign')
    elif state == 'assigned' and item.get('assigned_to') == user_id:
        primary = action('submit', '提交核验结果', '/change-reviews/' + item['id'] + '/submit')
    elif state == 'awaiting_review':
        excluded = (item.get('submissions') or [{}])[-1].get('submitted_by')
        if role in MANAGEMENT and user_id != excluded:
            primary = action('review', '复查核验', '/change-reviews/' + item['id'] + '/review')
    return hint({'pending': '待安排核验', 'assigned': '核验中', 'awaiting_review': '待独立复查',
                 'closed': '已关闭'}.get(state, '状态待核实'), primary,
                item.get('assigned_to') if state == 'assigned' else None,
                ('admin', 'supervisor', 'caregiver', 'nurse') if state == 'assigned' else ('admin', 'supervisor'), excluded)


def followup_workflow(card):
    """Adapt existing authorized cards without changing legacy action templates."""
    path = card.get('action_path')
    primary = None
    if path:
        values = {**card.get('context', {}), 'case_id': card['object_id'], 'issue_id': card['object_id']}
        try:
            resolved = path.format_map(values)
        except KeyError:
            resolved = None
        if resolved:
            primary = action(path.rsplit('/', 1)[-1], card['next_action'], resolved)
    elif card['group'] == 'elder':
        kind = card.get('context', {}).get('decision_kind')
        label = {'assessment': '核对评估', 'memory': '核对照护依据', 'understanding': '核对个性化观察',
                 'care_advice': '复核执行反馈', 'organising': '查看整理状态', 'followup': '补齐跟进安排',
                 'plan': '核对计划排期', 'task': '明确任务接续'}.get(kind, '打开老人工作区核对')
        primary = action('open_workspace', label, card['path'], 'GET')
    return hint({'pending': '待处理', 'review': '待复查', 'closed': '已处理'}.get(card['state'], '状态待核实'),
                primary, card.get('assigned_to'), ('admin', 'supervisor'))
