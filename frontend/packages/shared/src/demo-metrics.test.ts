import { describe, expect, it } from 'vitest'
import { createInitialDemoState } from './demo'
import {
  beijingDay,
  buildDemoMetrics,
  demoTime,
  demoTimestamp,
  familyDemoRecords,
  type DemoMemoryReview,
} from './demo-metrics'
import type { DemoRecord, Task } from './types'

const elder = {
  id: 'wang',
  name: '王爷爷',
  bedLabel: '101房·1床',
  status: '入住' as const,
}
const other = { ...elder, id: 'other', name: '其他老人' }
const day = '2026-10-27'
function task(
  id: string,
  status: Task['status'] = 'pending',
  executionAt = `${day}T09:00:00+08:00`,
): Task {
  return {
    id,
    elderId: elder.id,
    title: id,
    status,
    executionAt,
    dueAt: '2026-11-01T20:00:00+08:00',
    shift: '午班',
    assignee: '护理员',
  }
}
function state(tasks: Task[] = []) {
  return { elders: [elder, other], tasks, demoDay: day }
}
function review(
  id: string,
  status: DemoMemoryReview['status'],
): DemoMemoryReview {
  return {
    id,
    status,
    elderId: elder.id,
    memoryId: 'memory',
    itemId: 'item',
    description: '核实临时意愿',
    revision: 1,
  }
}
function record(id: string, patch: Partial<DemoRecord> = {}): DemoRecord {
  return {
    id,
    elderId: elder.id,
    title: '生活记录',
    content: id,
    category: '本人表达',
    actor: '王爷爷',
    familyVisible: true,
    happenedAt: `${day}T10:00:00+08:00`,
    enteredAt: `${day}T10:05:00+08:00`,
    ...patch,
  }
}

describe('demo metrics: dates, scope and traceable task groups', () => {
  it('counts explicit lifecycle states, excludes cancelled and other elders', () => {
    const rows = [
      task('p'),
      task('i', 'in_progress'),
      task('t', 'transferred'),
      task('o', 'overdue'),
      task('c', 'completed'),
      task('n', 'not_done'),
      task('x', 'cancelled'),
      { ...task('other'), elderId: other.id },
    ]
    const result = buildDemoMetrics(state(rows), elder.id)!
    expect(result.today.counts).toEqual({
      scheduled: 6,
      completed: 1,
      notDone: 1,
      pending: 4,
    })
    expect(result.today.groups.pending.map((row) => row.id)).toEqual([
      'i',
      'o',
      'p',
      't',
    ])
    for (const key of [
      'scheduled',
      'completed',
      'notDone',
      'pending',
    ] as const) {
      expect(result.today.counts[key]).toBe(result.today.groups[key].length)
      expect(
        result.today.groups[key].every((row) => row.elderId === elder.id),
      ).toBe(true)
    }
  })
  it('uses executionAt rather than deadline/dueAt, and converts UTC across Beijing midnight', () => {
    const result = buildDemoMetrics(
      state([
        task('yesterday', 'completed', '2026-10-26T15:59:59Z'),
        task('today', 'pending', '2026-10-26T16:00:00Z'),
        task('tomorrow', 'pending', '2026-10-27T16:00:00Z'),
      ]),
      elder.id,
    )!
    expect(result.today.groups.scheduled.map((row) => row.id)).toEqual([
      'today',
    ])
    expect(result.trend[5].groups.completed.map((row) => row.id)).toEqual([
      'yesterday',
    ])
    expect(beijingDay(Date.parse('2026-10-26T16:00:00Z'))).toBe(day)
  })
  it('builds seven chronological actual-date buckets across month/year boundaries', () => {
    const snapshot = {
      ...state([
        task('old', 'completed', '2025-12-31T12:00:00+08:00'),
        task('outside', 'completed', '2025-12-25T12:00:00+08:00'),
      ]),
      demoDay: '2026-01-01',
    }
    const result = buildDemoMetrics(snapshot, elder.id)!
    expect(result.trend.map((row) => row.day)).toEqual([
      '2025-12-26',
      '2025-12-27',
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
    ])
    expect(result.trend.map((row) => row.counts.completed)).toEqual([
      0, 0, 0, 0, 0, 1, 0,
    ])
  })
  it('honors the snapshot demoDay even when the browser clock differs', () => {
    expect(
      buildDemoMetrics(
        state([task('seed')]),
        elder.id,
        Date.parse('2030-01-01T00:00:00Z'),
      )?.today.counts.scheduled,
    ).toBe(1)
    expect(
      buildDemoMetrics(
        { elders: [elder], tasks: [] },
        elder.id,
        Date.parse('2026-10-26T16:00:00Z'),
      )?.day,
    ).toBe(day)
  })
  it('returns unknown for missing snapshots/elders or invalid demoDay', () => {
    expect(buildDemoMetrics(undefined, elder.id)).toBeNull()
    expect(buildDemoMetrics(state(), 'missing')).toBeNull()
    expect(
      buildDemoMetrics({ ...state(), demoDay: '2026-02-30' }, elder.id),
    ).toBeNull()
    expect(buildDemoMetrics({ ...state(), demoDay: '' }, elder.id)).toBeNull()
  })
  it('does not fabricate zero when execution time is missing or invalid', () => {
    const snapshot = state([
      task('known'),
      task('no-time', 'pending', ''),
      task('invalid', 'completed', '待确认期限'),
    ])
    const result = buildDemoMetrics(snapshot, elder.id)!
    expect(result.undated.map((row) => row.id)).toEqual(['no-time', 'invalid'])
    expect(
      result.trend.every((row) =>
        Object.values(row.counts).every((value) => value === null),
      ),
    ).toBe(true)
    expect(result.today.groups.scheduled.map((row) => row.id)).toEqual([
      'known',
    ])
  })
  it('does not label unknown status as pending or not done', () => {
    const result = buildDemoMetrics(
      state([task('unknown', 'new-status' as Task['status'])]),
      elder.id,
    )!
    expect(result.today.counts.pending).toBeNull()
    expect(result.today.groups.pending).toEqual([])
    expect(result.today.groups.notDone).toEqual([])
    expect(result.today.groups.scheduled[0].id).toBe('unknown')
  })
  it('does not let undated tasks of another elder invalidate the selected scope', () => {
    const result = buildDemoMetrics(
      state([{ ...task('other', 'pending', ''), elderId: other.id }]),
      elder.id,
    )!
    expect(result.today.counts.scheduled).toBe(0)
    expect(result.undated).toEqual([])
  })
  it('recomputes current state after actions without mutating the source snapshot', () => {
    const snapshot = state([task('p')])
    const before = structuredClone(snapshot)
    expect(buildDemoMetrics(snapshot, elder.id)?.today.counts.pending).toBe(1)
    expect(snapshot).toEqual(before)
    snapshot.tasks[0].status = 'completed'
    expect(buildDemoMetrics(snapshot, elder.id)?.today.counts.completed).toBe(1)
    expect(buildDemoMetrics(snapshot, elder.id)?.today.counts.pending).toBe(0)
  })
  it('rejects invalid calendar days and timezone-less values', () => {
    for (const value of [
      undefined,
      '',
      '2026-02-30T09:00:00+08:00',
      '2026-10-27T09:00:00',
      '2026-10-27',
      'invalid',
    ]) {
      expect(demoTimestamp(value)).toBeNull()
      expect(demoTime(value)).toBe('时间待核实')
    }
    expect(demoTime('2026-10-26T16:30:00Z')).toContain('2026/10/27')
    expect(demoTime('2026-10-26T16:30:00Z')).toContain('00:30')
  })
  it('uses real seed tasks for all seven days, independent of record volume', () => {
    const seed = createInitialDemoState()
    const selected = seed.elders[0].id
    const result = buildDemoMetrics(seed, selected)!
    for (const bucket of result.trend) {
      const expected = seed.tasks.filter(
        (row) =>
          row.elderId === selected &&
          row.status !== 'cancelled' &&
          row.executionAt &&
          beijingDay(Date.parse(row.executionAt)) === bucket.day,
      )
      expect(bucket.groups.scheduled.map((row) => row.id).sort()).toEqual(
        expected.map((row) => row.id).sort(),
      )
    }
    expect(buildDemoMetrics({ ...seed, records: [] }, selected)?.trend).toEqual(
      result.trend,
    )
  })
})

describe('memory reviews', () => {
  it('counts pending and awaiting_review only for the same elder', () => {
    const result = buildDemoMetrics(
      {
        ...state(),
        memoryReviews: [
          review('p', 'pending'),
          review('a', 'awaiting_review'),
          review('c', 'closed'),
          { ...review('other', 'pending'), elderId: other.id },
        ],
      },
      elder.id,
    )!
    expect(result.reviewCount).toBe(2)
    expect(result.openReviews?.map((row) => row.id)).toEqual(['p', 'a'])
  })
  it('distinguishes unavailable review data from a known empty list', () => {
    expect(buildDemoMetrics(state(), elder.id)?.reviewCount).toBeNull()
    expect(
      buildDemoMetrics({ ...state(), memoryReviews: [] }, elder.id)
        ?.reviewCount,
    ).toBe(0)
    expect(
      buildDemoMetrics(
        {
          ...state(),
          memoryReviews: [review('x', 'unknown' as DemoMemoryReview['status'])],
        },
        elder.id,
      )?.reviewCount,
    ).toBeNull()
  })
})

describe('authorized demo family life records', () => {
  it('shows only explicitly familyVisible Wang records, ordered by occurrence time', () => {
    const records = [
      record('old', { happenedAt: '2026-10-26T09:00:00+08:00' }),
      record('private', { familyVisible: false }),
      record('other', { elderId: other.id }),
      record('new'),
      record('unknown', { familyVisible: undefined as unknown as boolean }),
    ]
    const original = structuredClone(records)
    expect(
      familyDemoRecords({ elders: [elder, other], records }).map(
        (row) => row.id,
      ),
    ).toEqual(['new', 'old'])
    expect(records).toEqual(original)
  })
  it('does not default to another elder when Wang is missing or ambiguous', () => {
    expect(familyDemoRecords(undefined)).toEqual([])
    expect(
      familyDemoRecords({
        elders: [other],
        records: [record('x', { elderId: other.id })],
      }),
    ).toEqual([])
    expect(
      familyDemoRecords({
        elders: [elder, { ...elder, id: 'duplicate' }],
        records: [record('x')],
      }),
    ).toEqual([])
  })
  it('keeps undated authorized records visible with unknown time rather than inventing dates', () => {
    expect(
      familyDemoRecords({
        elders: [elder],
        records: [record('undated', { happenedAt: '待核实' }), record('dated')],
      }).map((row) => row.id),
    ).toEqual(['dated', 'undated'])
  })
})
