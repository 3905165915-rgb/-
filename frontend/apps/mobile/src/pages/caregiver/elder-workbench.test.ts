import { describe, expect, it } from 'vitest'
import type { Elder, Task } from '@hulao/shared'
import { elderWorkbench } from './elder-workbench'

const elder: Elder = {
  id: 'synthetic-elder',
  name: '虚构老人',
  bedLabel: '虚构床位',
  status: '入住',
}
const task: Task = {
  id: 'synthetic-task',
  elderId: elder.id,
  title: '虚构任务',
  status: 'pending',
  dueAt: '',
  shift: '',
  assignee: '',
}

describe('elder workbench associations', () => {
  it('only creates cards for accessible elders with exactly related loaded tasks', () => {
    expect(
      elderWorkbench(
        [elder, { ...elder, id: 'no-tasks' }],
        [task, { ...task, id: 'other-task', elderId: elder.id + '-other' }],
      ),
    ).toEqual([{ elder, tasks: [task], pending: 1, inProgress: 0, overdue: 0 }])
    expect(elderWorkbench([], [task])).toEqual([])
  })
  it('counts supplied statuses, deduplicates IDs, and does not infer overdue from a deadline', () => {
    const tasks: Task[] = [
      task,
      task,
      { ...task, id: 'progress', status: 'in_progress' },
      { ...task, id: 'overdue', status: 'overdue' },
      { ...task, id: 'not-done', status: 'not_done' },
      { ...task, id: 'transferred', status: 'transferred' },
      { ...task, id: 'completed', status: 'completed', dueAt: '2020-01-01' },
    ]
    const card = elderWorkbench([elder], tasks)[0]
    expect(card).toMatchObject({ pending: 2, inProgress: 1, overdue: 1 })
    expect(card.tasks).toHaveLength(6)
  })
  it('preserves provided notes and updates without inventing changes or confirmed hints', () => {
    const plain = elderWorkbench([elder], [task])[0].elder
    expect(plain).not.toHaveProperty('notes')
    expect(plain).not.toHaveProperty('lastUpdate')
    const supplied = {
      ...elder,
      notes: '虚构档案原文',
      lastUpdate: '2026-10-25',
    }
    expect(elderWorkbench([supplied], [task])[0].elder).toEqual(supplied)
  })
})
