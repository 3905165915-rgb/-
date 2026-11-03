import type { Row } from './model'
import type { CareWorkTask } from './care-worklist'
import { businessDay } from '../business-time'
import { isTaskContent } from './care-arrangement'

export interface ElderWorkspaceSnapshot extends Row {
  current_care_available: boolean
  tasks: CareWorkTask[]
  recent_records: Row[]
  record_total: number
}
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('老人工作区回执不完整，请重新读取。')
  return value as Row
}
export function elderWorkspaceSnapshot(
  value: unknown,
  elderId: string,
): ElderWorkspaceSnapshot {
  const result = object(value),
    elder = object(result.elder)
  if (
    elder.id !== elderId ||
    typeof result.current_care_available !== 'boolean' ||
    !Array.isArray(result.tasks) ||
    !Array.isArray(result.recent_records) ||
    !Number.isSafeInteger(result.record_total) ||
    Number(result.record_total) < result.recent_records.length
  )
    throw new Error('老人工作区上下文不一致，请重新读取。')
  const admission =
    result.current_admission == null ? null : object(result.current_admission)
  if (
    result.current_care_available !== !!admission ||
    (admission &&
      (admission.id !== elder.current_admission_id ||
        !['active', 'out'].includes(String(admission.status))))
  )
    throw new Error('当前入住资料尚未核实，请重新读取。')
  const tasks = result.tasks.map(object)
  if (
    tasks.some(
      (task) =>
        typeof task.id !== 'string' ||
        task.elder_id !== elderId ||
        !isTaskContent(task) ||
        !['pending', 'in_progress', 'overdue'].includes(String(task.status)),
    )
  )
    throw new Error('当前任务读取异常，请重新读取。')
  const records = result.recent_records.map(object)
  if (
    records.some(
      (record) =>
        typeof record.id !== 'string' ||
        record.elder_id !== elderId ||
        record.admission_id !== admission?.id,
    ) ||
    (!admission &&
      (tasks.length || records.length || result.record_total !== 0))
  )
    throw new Error('本次入住记录读取异常，请重新读取。')
  return {
    ...result,
    tasks: tasks as CareWorkTask[],
    recent_records: records,
  } as ElderWorkspaceSnapshot
}
/** Prioritize overdue work without losing responsibilities outside today's window. */
export function elderWorkGroups(
  tasks: CareWorkTask[],
  at: string | number | Date = Date.now(),
) {
  const day = businessDay(at)
  const priority = tasks.filter(
    (task) =>
      task.status === 'overdue' ||
      businessDay(String(task.scheduled_at || task.due_at || '')) === day,
  )
  priority.sort(
    (a, b) =>
      Number(b.status === 'overdue') - Number(a.status === 'overdue') ||
      a.id.localeCompare(b.id),
  )
  const ids = new Set(priority.map((task) => task.id))
  return { priority, other: tasks.filter((task) => !ids.has(task.id)) }
}
