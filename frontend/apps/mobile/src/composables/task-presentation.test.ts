import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@hulao/shared'
import * as mobile from './task-presentation'
import * as admin from '../../../admin-web/src/composables/task-presentation'

const task: Task = { id: 'task', elderId: 'elder', title: '观察', shift: '午班', assignee: '护理员', dueAt: '', status: 'pending' }
afterEach(() => vi.useRealTimers())

describe.each([['mobile', mobile], ['admin', admin]] as const)('%s task presentation', (_name, ui) => {
  it.each([
    ['pending', '开始服务'], ['overdue', '开始服务'], ['transferred', '开始服务'],
    ['in_progress', '登记结果'], ['completed', '查看结果'], ['not_done', '查看结果'],
    ['cancelled', '查看详情'], ['future', '查看详情'],
  ])('chooses the primary action for %s', (status, label) => {
    expect(ui.taskPrimaryLabel({ ...task, status: status as Task['status'] })).toBe(label)
  })

  it('blocks ended, missing, unknown tasks and repeated starts while allowing overdue work', () => {
    for (const status of ['completed', 'not_done', 'cancelled', 'future']) {
      for (const action of ['start', 'complete', 'not_done', 'transfer'] as const)
        expect(ui.taskActionAllowed({ ...task, status: status as Task['status'] }, action)).toBe(false)
    }
    expect(ui.taskActionAllowed(null, 'complete')).toBe(false)
    expect(ui.taskActionAllowed({ ...task, status: 'in_progress' }, 'start')).toBe(false)
    expect(ui.taskActionAllowed({ ...task, status: 'in_progress' }, 'complete')).toBe(true)
    expect(ui.taskActionAllowed({ ...task, status: 'overdue' }, 'start')).toBe(true)
  })

  it('formats business times in Shanghai across UTC day boundaries and marks bad or absent times', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T01:00:00Z'))
    expect(ui.taskTime('2026-10-26T23:00:00Z')).toBe('今天07:00')
    expect(ui.taskTime('2026-10-27T23:00:00Z')).toBe('10月28日07:00')
    expect(ui.taskTime('')).toBe('未提供')
    expect(ui.taskTime('bad-time')).toBe('时间待核实')
    expect(ui.taskTime('今天 15:00')).not.toBe('时间待核实')
  })
})
