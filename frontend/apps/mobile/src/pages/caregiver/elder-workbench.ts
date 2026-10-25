import type { Elder, Task } from '@hulao/shared'

// Task association is a view of loaded data, never a permanent assignment.
export function elderWorkbench(elders: Elder[], tasks: Task[]) {
  const byElder = new Map<string, Task[]>()
  for (const task of tasks) {
    const rows = byElder.get(task.elderId) ?? []
    if (!rows.some((row) => row.id === task.id)) rows.push(task)
    byElder.set(task.elderId, rows)
  }
  return elders.flatMap((elder) => {
    const related = byElder.get(elder.id)
    return related?.length ? [{
      elder, tasks: related,
      pending: related.filter((task) => task.status === 'pending' || task.status === 'not_done').length,
      overdue: related.filter((task) => task.status === 'overdue').length,
      inProgress: related.filter((task) => task.status === 'in_progress').length,
    }] : []
  })
}
