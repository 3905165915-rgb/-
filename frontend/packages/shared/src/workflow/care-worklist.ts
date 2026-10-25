export type CareWorkTask = { id: string; elder_id: string; title: string; status: string; due_at?: string | null; [key: string]: unknown }
export type CareWorkItem = {
  elder: { id: string; name: string; bed_id: string | null; status: string }
  scope_reasons: string[]
  open_tasks: CareWorkTask[]
  assignment_ids: string[]
  pending_count: number
  overdue_count: number
}
export type CareWorklist = { scope_rule: string; items: CareWorkItem[] }
function fail(): never { throw new Error('照护范围数据格式异常，请刷新后联系管理员。') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function text(value: unknown, optional = false): string {
  if (optional && value === null) return ''
  if (typeof value !== 'string' || !value.trim()) return fail()
  return value
}
function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail()
  return value
}
export function validateCareWorklist(value: unknown): CareWorklist {
  const row = record(value), scopeRule = text(row.scope_rule)
  if (!Array.isArray(row.items)) return fail()
  const seen = new Set<string>()
  const items = row.items.map((value): CareWorkItem => {
    const item = record(value), rawElder = record(item.elder), elderId = text(rawElder.id)
    if (seen.has(elderId)) return fail()
    seen.add(elderId)
    const reasons = ['explicit_assignment', 'temporary_support', 'explicit_task_assignment', 'open_shift_membership', 'management_access']
    if (!Array.isArray(item.scope_reasons) || !item.scope_reasons.length || !item.scope_reasons.every(reason => typeof reason === 'string' && reasons.includes(reason)) ||
      !Array.isArray(item.assignment_ids) || !item.assignment_ids.every(id => typeof id === 'string' && id.trim()) ||
      !Array.isArray(item.open_tasks)) return fail()
    const taskIds = new Set<string>()
    const tasks = item.open_tasks.map((value): CareWorkTask => {
      const task = record(value)
      const id = text(task.id)
      if (taskIds.has(id) || text(task.elder_id) !== elderId || text(task.title) === '' || !['pending', 'in_progress', 'overdue'].includes(String(task.status))) return fail()
      if (task.due_at != null && (typeof task.due_at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(task.due_at) || !Number.isFinite(Date.parse(task.due_at)))) return fail()
      taskIds.add(id)
      return task as CareWorkTask
    })
    const pending = nonnegative(item.pending_count), overdue = nonnegative(item.overdue_count)
    if (pending !== tasks.length || overdue !== tasks.filter(task => task.status === 'overdue').length) return fail()
    const bedId = rawElder.bed_id === null || rawElder.bed_id === undefined ? null : text(rawElder.bed_id)
    return {
      elder: { id: elderId, name: text(rawElder.name), bed_id: bedId, status: text(rawElder.status) },
      scope_reasons: item.scope_reasons as string[], open_tasks: tasks,
      assignment_ids: item.assignment_ids as string[], pending_count: pending, overdue_count: overdue,
    }
  })
  return { scope_rule: scopeRule, items }
}
