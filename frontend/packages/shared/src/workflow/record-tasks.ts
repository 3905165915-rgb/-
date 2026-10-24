import type { FrontendSession } from '../session'
import { actorId } from './shift-access'
import { clean, schemas, type Row } from './model'

// UI hints are editable draft values, never an authorization decision.
export function recordTaskOwners(catalogs: Record<string, Row[]>, session: FrontendSession | null, shiftId: unknown): Row[] {
  if (!session?.role || !['admin', 'supervisor', 'caregiver'].includes(session.role)) return []
  const shift = (catalogs.shifts || []).find(row => row.id === shiftId)
  return (catalogs.staff || []).filter(row =>
    row.active !== false && ['admin', 'supervisor', 'caregiver'].includes(String(row.role)) &&
    (session?.role !== 'caregiver' || row.id === actorId(session)) &&
    (!shiftId || (Array.isArray(shift?.caregiver_ids) && shift.caregiver_ids.includes(row.id))),
  )
}

export function selectedRecordTasks(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row) && row.include_task !== false)
}

export function reviewedRecordTasks(value: unknown, owners: Row[]): Row[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('记录待办格式不正确或超过50项，请重新核对。')
  const candidates: Row[] = []
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第${index + 1}项待办格式不正确，请重新核对。`)
    const row = item as Row
    if (row.include_task === false) return
    const prefix = `第${index + 1}项待办：`
    if (row.object_review_required && row.object_review_confirmed !== true)
      throw new Error(prefix + '原文还提到其他老人，请先核对本项确实属于当前老人，或取消创建并拆分记录。')
    for (const [key, name] of [['title', '要做的事'], ['assigned_to', '负责人'], ['due_at', '截止时间']])
      if (typeof row[key] !== 'string' || !String(row[key]).trim())
        throw new Error(prefix + `请补充${name}，也可以取消本项创建，仅保存记录。`)
    if (!owners.some(person => person.id === row.assigned_to))
      throw new Error(prefix + '负责人不在当前可安排范围，请重新选择本人或当前班次成员。')
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(row.due_at))
    const calendar = parts ? new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))) : null
    if (!parts || !calendar || calendar.getUTCFullYear() !== Number(parts[1]) || calendar.getUTCMonth() !== Number(parts[2]) - 1 ||
      calendar.getUTCDate() !== Number(parts[3]) || Number(parts[4]) > 23 || Number(parts[5]) > 59)
      throw new Error(prefix + '截止时间不是有效日期和时刻，请重新填写。')
    // The closed request shape discards proposal notes, evidence flags and UI
    // switches. Explicit [] must reach the server when all tasks are deselected.
    candidates.push(clean(schemas.TaskCandidate, row) as Row)
  })
  return candidates
}

export function recordSavedMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('record' in value)) return null
  const tasks = (value as Row).tasks
  if (!Array.isArray(tasks)) return null
  return tasks.length ? `记录已保存，同时创建了${tasks.length}项任务。可在任务列表按老人查看。` : '记录已保存，本次未创建任务。'
}
