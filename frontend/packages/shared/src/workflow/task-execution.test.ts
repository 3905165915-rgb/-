import { expect, it } from 'vitest'
import { executionTask, executionActions } from './task-execution'
const task = {
  id: 'synthetic-task',
  title: '询问本人意愿',
  status: 'pending',
  revision: 1,
  allowed_actions: ['start', 'complete', 'not_done'],
}
it('requires a matched task with a usable revision and typed allowed actions', () => {
  expect(executionTask(task, task.id)).toEqual(task)
  for (const change of [
    { id: 'other' },
    { revision: 0 },
    { title: '' },
    { allowed_actions: [1] },
  ])
    expect(() => executionTask({ ...task, ...change }, task.id)).toThrow(
      '重新读取',
    )
})
it('intersects server actions with the latest task state', () => {
  expect(executionActions(task)).toEqual(['start', 'not_done'])
  expect(executionActions({ ...task, status: 'in_progress' })).toEqual([
    'complete',
    'not_done',
  ])
  expect(executionActions({ ...task, allowed_actions: [] })).toEqual([])
  for (const status of ['completed', 'cancelled', 'not_done', 'unknown'])
    expect(executionActions({ ...task, status })).toEqual([])
})
