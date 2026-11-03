import { formatBusinessTime, taskDeadline, type Task, type TaskEditor } from '@hulao/shared'

export function taskActionAllowed(task: Task | undefined | null, action: TaskEditor['action']) {
  if (!task || !['pending', 'in_progress', 'overdue', 'transferred'].includes(task.status)) return false
  return action !== 'start' || task.status !== 'in_progress'
}

export function taskPrimaryLabel(task: Task) {
  if (task.status === 'completed' || task.status === 'not_done') return '查看结果'
  if (!taskActionAllowed(task, 'complete')) return '查看详情'
  return task.status === 'in_progress' ? '登记结果' : '开始服务'
}

export function taskTime(value?: string, missing = '未提供') {
  if (!value?.trim()) return missing
  return formatBusinessTime(taskDeadline(value) ?? value)
}
