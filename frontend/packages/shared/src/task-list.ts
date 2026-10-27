import { businessDay } from './business-time'
import type { Elder, Task } from './types'
export interface TaskFilters {
  elder: string
  shift: string
  assignee: string
  status: string
  q: string
  sort: string
}
export const emptyTaskFilters = (): TaskFilters => ({
  elder: '',
  shift: '',
  assignee: '',
  status: '',
  q: '',
  sort: 'source',
})
export function taskDeadline(value: string, today = new Date()) {
  const relative = /^(今天|昨天|明天) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  let absolute = value
  if (relative) {
    const day = new Date(businessDay(today) + 'T00:00:00Z')
    day.setUTCDate(
      day.getUTCDate() + ({ 今天: 0, 昨天: -1, 明天: 1 }[relative[1]!] ?? 0),
    )
    absolute = `${day.toISOString().slice(0, 10)}T${relative[2]}:${relative[3]}:${relative[4] || '00'}+08:00`
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    // Legacy domestic display values have Beijing clock semantics.
    absolute = value + '+08:00'
  }
  return businessDay(absolute) ? Date.parse(absolute) : undefined
}
export function filterTasks(
  rows: Task[],
  filters: TaskFilters,
  elders: Elder[] = [],
) {
  const names = new Map(
    elders.map((elder) => [elder.id, elder.name + ' ' + elder.bedLabel]),
  )
  const q = filters.q.trim().toLowerCase()
  const filtered = rows.filter(
    (task) =>
      (!filters.elder || task.elderId === filters.elder) &&
      (!filters.shift || task.shift === filters.shift) &&
      (!filters.assignee || task.assignee === filters.assignee) &&
      (!filters.status || task.status === filters.status) &&
      (!q ||
        [
          task.id,
          task.title,
          task.elderId,
          names.get(task.elderId),
          task.assignee,
          task.shift,
          task.result,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  )
  if (!['due_asc', 'due_desc'].includes(filters.sort)) return filtered
  return filtered.sort((a, b) => {
    const left = taskDeadline(a.dueAt)
    const right = taskDeadline(b.dueAt)
    if (left === undefined && right !== undefined) return 1
    if (right === undefined && left !== undefined) return -1
    return left === undefined || right === undefined || left === right
      ? a.id.localeCompare(b.id)
      : (left - right) * (filters.sort === 'due_desc' ? -1 : 1)
  })
}
