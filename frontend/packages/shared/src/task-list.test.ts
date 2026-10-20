import { describe, it, expect } from 'vitest'
import { filterTasks, emptyTaskFilters, taskDeadline } from './task-list'
import type { Task } from './types'
const task = (id: string, dueAt: string): Task => ({
  id,
  dueAt,
  elderId: 'e1',
  title: '观察',
  shift: '早班',
  assignee: '张护理',
  status: 'pending',
})
describe('local task filtering', () => {
  it('searches elder name and bed without mutating input', () => {
    const rows = [task('b', ''), task('a', '')]
    const result = filterTasks(rows, { ...emptyTaskFilters(), q: '101' }, [
      { id: 'e1', name: '测试老人', bedLabel: '101床', status: '入住' },
    ])
    expect(result).toHaveLength(2)
    expect(rows.map((row) => row.id)).toEqual(['b', 'a'])
  })
  it('combines exact filters with trimmed keyword search', () => {
    const rows = [task('a', '')]
    expect(
      filterTasks(rows, {
        ...emptyTaskFilters(),
        q: ' 张护理 ',
        shift: '早班',
      }),
    ).toHaveLength(1)
    expect(
      filterTasks(rows, { ...emptyTaskFilters(), status: 'completed' }),
    ).toHaveLength(0)
  })
  it('keeps missing deadlines last in either direction and breaks ties by ID', () => {
    const rows = [
      task('z', ''),
      task('b', '2026-10-20T10:00'),
      task('a', '2026-10-20T10:00'),
      task('c', '2026-10-21T10:00'),
    ]
    expect(
      filterTasks(rows, { ...emptyTaskFilters(), sort: 'due_asc' }).map(
        (row) => row.id,
      ),
    ).toEqual(['a', 'b', 'c', 'z'])
    expect(
      filterTasks(rows, { ...emptyTaskFilters(), sort: 'due_desc' }).map(
        (row) => row.id,
      ),
    ).toEqual(['c', 'a', 'b', 'z'])
  })
  it('parses relative deadlines locally and leaves placeholders unsorted', () => {
    const today = new Date(2026, 9, 20)
    expect(taskDeadline('今天 10:30', today)).toBe(
      new Date(2026, 9, 20, 10, 30).getTime(),
    )
    expect(taskDeadline('待确认期限')).toBeUndefined()
  })
})
