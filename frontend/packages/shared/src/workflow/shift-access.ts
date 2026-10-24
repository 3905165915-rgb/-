import type { FrontendSession } from '../session'
import type { Operation, Row } from './model'

// These helpers only guide forms. The backend remains the authorization authority.
export function actorId(session: FrontendSession | null): string {
  if (typeof session?.userId === 'string' && session.userId) return session.userId
  try {
    // Older open tabs have a token but predate the saved login user_id.
    const encoded = session?.accessToken?.split('.')[1] || ''
    const payload = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.sub === 'string' ? payload.sub : ''
  } catch {
    return ''
  }
}

export function writableShifts(shifts: Row[], session: FrontendSession | null): Row[] {
  const id = actorId(session)
  return shifts.filter(row => row.status === 'open' && (
    session?.role === 'admin' || session?.role === 'supervisor' ||
    (session?.role === 'caregiver' && id && Array.isArray(row.caregiver_ids) && row.caregiver_ids.includes(id))
  ))
}

function canExecute(task: Row, catalogs: Record<string, Row[]>, session: FrontendSession | null) {
  if (session?.role !== 'caregiver') return true
  const id = actorId(session)
  return Boolean(id && (!task.assigned_to || task.assigned_to === id) &&
    (!task.shift_id || writableShifts(catalogs.shifts || [], session).some(row => row.id === task.shift_id)))
}

export function isQualityScan(op: Operation): boolean {
  return op.method === 'post' && op.path === '/quality/checks'
}

// A quality scan reads historical evidence; it does not execute shift work.
export function qualityScopeOptions(body: Row, catalogs: Record<string, Row[]>): Record<string, Row[]> {
  return {
    shift_id: catalogs.shifts || [],
    handover_id: (catalogs.handovers || []).filter(row => !body.shift_id || row.source_shift_id === body.shift_id),
  }
}

export function updateQualityScope(previous: Row, next: Row, catalogs: Record<string, Row[]>): Row {
  const body = { ...next }
  const handover = (catalogs.handovers || []).find(row => row.id === body.handover_id)
  if (body.handover_id && body.handover_id !== previous.handover_id && handover?.source_shift_id)
    body.shift_id = handover.source_shift_id
  else if (body.shift_id !== previous.shift_id && handover && body.shift_id && handover.source_shift_id !== body.shift_id)
    body.handover_id = ''
  return body
}

export function shiftFieldOptions(op: Operation, catalogs: Record<string, Row[]>, session: FrontendSession | null): Record<string, Row[]> {
  if (op.method === 'get') return {}
  if (isQualityScan(op)) return qualityScopeOptions({}, catalogs)
  const shifts = catalogs.shifts || []
  const result: Record<string, Row[]> = {
    shift_id: writableShifts(shifts, session),
    source_shift_id: writableShifts(shifts, session),
    // The next shift may belong to a different caregiver.
    target_shift_id: shifts.filter(row => row.status === 'open'),
  }
  if (session?.role === 'caregiver') {
    const id = actorId(session)
    result.assigned_to = id
      ? (catalogs.staff || []).filter(row => row.id === id)
      : []
  }
  if (/^\/tasks\/\{task_id\}\/(transition|complete)$/.test(op.path)) {
    result.task_id = (catalogs.tasks || []).filter(row =>
      !['completed', 'cancelled'].includes(String(row.status)) && canExecute(row, catalogs, session))
  }
  return result
}

export function submissionIssue(op: Operation, params: Row, payload: unknown, catalogs: Record<string, Row[]>, session: FrontendSession | null): string {
  if (op.method === 'get') return ''
  const body = payload && typeof payload === 'object' ? payload as Row : {}
  if (isQualityScan(op)) {
    const handover = (catalogs.handovers || []).find(row => row.id === body.handover_id)
    if (body.handover_id && !handover) return '所选交班单不可用，请刷新可选数据后重新选择。'
    if (handover && (!handover.source_shift_id || (body.shift_id && body.shift_id !== handover.source_shift_id)))
      return '所选班次必须是该交班单的交出班次，请重新选择。'
    if (body.shift_id && !(catalogs.shifts || []).some(row => row.id === body.shift_id))
      return '所选统计班次不可用，请刷新可选数据后重新选择。'
    return ''
  }
  const choices = shiftFieldOptions(op, catalogs, session)
  for (const field of ['shift_id', 'source_shift_id', 'target_shift_id']) {
    if (body[field] && !choices[field]?.some(row => row.id === body[field]))
      return field === 'target_shift_id'
        ? '接入班次不可用，请刷新并选择开放班次。'
        : '所选班次已关闭或未分配给当前账号，请重新选择自己的开放班次；没有可选班次时请联系主管安排。'
  }
  if (/^\/tasks\/\{task_id\}\/(transition|complete)$/.test(op.path)) {
    const task = (catalogs.tasks || []).find(row => row.id === params.task_id)
    if (task && !canExecute(task, catalogs, session))
      return '该任务不属于你当前可办理的班次或负责人范围。请由主管核对分工，跨班任务须先完成接班。'
  }
  if (op.path === '/tasks/{task_id}' && op.method === 'patch' && session?.role === 'caregiver')
    return '安排其他护理员、修改责任人或截止时间需要主管或管理员处理。'
  return ''
}
