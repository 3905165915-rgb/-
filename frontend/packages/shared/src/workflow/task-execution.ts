import { object } from './workspace-action'
import type { Row } from './model'
import { isTaskContent } from './care-arrangement'

export function executionTask(value: unknown, taskId: string): Row {
  const task = object(value)
  if (
    task.id !== taskId ||
    !isTaskContent(task) ||
    typeof task.title !== 'string' ||
    !task.title.trim() ||
    typeof task.status !== 'string' ||
    !task.status ||
    !Number.isInteger(task.revision) ||
    Number(task.revision) < 1 ||
    (task.allowed_actions != null &&
      (!Array.isArray(task.allowed_actions) ||
        task.allowed_actions.some((item) => typeof item !== 'string')))
  )
    throw new Error('任务资料不完整或与当前任务不一致，请重新读取后办理。')
  return task
}
export function executionActions(task: Row | null): string[] {
  if (!task || !isTaskContent(task) || !Array.isArray(task.allowed_actions) ||
    task.assignment_status === 'unassigned' || task.assigned_to === null || task.assigned_to === '') return []
  const status = String(task.status)
  const pending = ['pending', 'overdue', 'transferred'].includes(status)
  const running = status === 'in_progress'
  return (task.allowed_actions as string[]).filter((action) =>
    action === 'start'
      ? pending
      : action === 'complete'
        ? running
        : action === 'not_done'
          ? pending || running
          : false,
  )
}
