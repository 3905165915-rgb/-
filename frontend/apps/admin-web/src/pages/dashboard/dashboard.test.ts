import { describe, expect, it } from 'vitest'
import {
  captureDashboardRequest,
  createRequestGuard,
  dashboardGroupLabel,
  dashboardLocation,
  defaultWindow,
  formatRatio,
  loadDashboardDirectory,
  selectedDashboardRows,
  stamp,
  validateDashboard,
  validateWindow,
  taskArrangementSeries,
  taskStatusSegments,
} from './dashboard'

const window = { start: '2026-10-25', end: '2026-10-26' }
const task1 = {
  id: 'TASK-1',
  kind: 'task',
  status: 'pending',
  elder_id: 'ELDER-1',
  title: '虚构任务一',
  metric_at: '2026-10-25T09:00:00+08:00',
  scheduled_at: '2026-10-25T09:00:00+08:00',
  is_plan_occurrence: true,
}
const task2 = {
  ...task1,
  id: 'TASK-2',
  status: 'completed',
  title: '虚构任务二',
  completed_at: '2026-10-25T09:00:00+08:00',
  due_at: '2026-10-25T10:00:00+08:00',
}
const emptyCards = () =>
  Object.fromEntries(
    [
      'pending_handovers',
      'untriaged_incidents',
      'pending_rectification_review',
      'pending_reviews',
    ].map((key) => [
      key,
      { count: 0, previous_count: 0, change: 0, change_ratio: null, items: [] },
    ]),
  )
const emptySections = () =>
  Object.fromEntries(
    [
      'handovers',
      'incidents',
      'memories',
      'impressions',
      'family',
      'photo_reviews',
    ].map((key) => [key, { count: 0, items: [] }]),
  )
function snapshot() {
  return structuredClone({
    as_of: '2026-10-25T12:00:00+08:00',
    timezone: 'Asia/Shanghai',
    filters: {
      start_inclusive: '2026-10-25T00:00:00+08:00',
      end_exclusive: '2026-10-26T00:00:00+08:00',
      elder_id: null,
      shift_id: null,
      status: null,
    },
    cards: {
      ...emptyCards(),
      pending_tasks: {
        count: 1,
        previous_count: 0,
        change: 1,
        change_ratio: null,
        items: [task1],
      },
      overdue_tasks: {
        count: 0,
        previous_count: 0,
        change: 0,
        change_ratio: null,
        items: [],
      },
    },
    distributions: {
      ...Object.fromEntries(
        [
          ...Object.keys(emptySections()),
          'incident_categories',
          'family_kind',
        ].map((key) => [key, []]),
      ),
      tasks: [
        { key: 'pending', count: 1, ids: ['TASK-1'] },
        { key: 'completed', count: 1, ids: ['TASK-2'] },
      ],
    },
    task_trend: [
      {
        date: '2026-10-25',
        count: 2,
        ids: ['TASK-1', 'TASK-2'],
        completion: { numerator: 1, denominator: 2, ratio: 0.5 },
        on_time: 1,
        not_done: 0,
        overdue: 0,
      },
    ],
    details: { ...emptySections(), tasks: { count: 2, items: [task1, task2] } },
    pending_work: {
      count: 1,
      items: [task1],
      definition: '按待处理业务状态排序。',
    },
    comparison: {
      filters: {
        start_inclusive: '2026-10-24T00:00:00+08:00',
        end_exclusive: '2026-10-25T00:00:00+08:00',
        elder_id: null,
        shift_id: null,
        status: null,
      },
      cards: {
        ...emptyCards(),
        pending_tasks: { count: 0, items: [] },
        overdue_tasks: { count: 0, items: [] },
      },
      definition: '上一相邻周期，仅按当前快照状态比较。',
    },
    excluded: { future_trend_task_rows: 0, invalid_task_time_rows: 0 },
    definitions: {
      snapshot: '所有图表来自同一服务器快照。',
      task_trend: '仅计划任务。',
    },
  })
}

describe('single-response management dashboard', () => {
  it('charts manual tasks even with no planned-service denominator and drills down to their real IDs', () => {
    const value = snapshot()
    for (const task of value.details.tasks.items)
      task.is_plan_occurrence = false
    Object.assign(value.task_trend[0], {
      count: 0,
      ids: [],
      completion: { numerator: 0, denominator: 0, ratio: null },
      on_time: 0,
    })
    const summary = taskStatusSegments(value as never)
    expect(summary.total).toBe(2)
    expect(
      summary.groups.map((group) => [group.fraction, group.offset]),
    ).toEqual([
      [0.5, 0],
      [0.5, 0.5],
    ])
    expect(taskArrangementSeries(value as never)[0]).toMatchObject({
      count: 2,
      completed: 1,
      ids: ['TASK-1', 'TASK-2'],
    })
    expect(
      selectedDashboardRows(value as never, {
        kind: 'activity',
        key: '2026-10-25',
      }),
    ).toEqual(value.details.tasks.items)
    value.details.tasks.items[0].metric_at = '2026-10-24T16:00:00Z'
    expect(taskArrangementSeries(value as never)[0].count).toBe(2)
    expect(defaultWindow(Date.parse('2026-10-24T17:00:00Z'), 7)).toEqual({
      start: '2026-10-19',
      end: '2026-10-26',
    })
    expect(
      taskStatusSegments({ ...value, distributions: { tasks: [] } } as never),
    ).toEqual({ total: 0, groups: [] })
  })
  it('uses Beijing day boundaries and rejects invalid or excessive windows', () => {
    expect(defaultWindow(Date.parse('2026-10-24T17:00:00Z'))).toEqual(window)
    expect(validateWindow(window)).toBeNull()
    for (const value of [
      '2026-02-30T08:00:00Z',
      '2026-10-25T24:00:00Z',
      '2026-10-25T08:00:00+25:00',
      '2026-10-25T08:00:00+14:01',
      '2026-10-25T08:00:00',
      null,
    ])
      expect(stamp(value)).toBeNull()
    expect(stamp('2026-10-25T08:00:00+08:00')).not.toBeNull()
    expect(
      validateWindow({ start: '2025-01-01', end: '2026-01-03' }),
    ).toBeTruthy()
  })

  it('validates a coherent same-snapshot response and supports card, group and trend drilldown', () => {
    const result = validateDashboard(snapshot(), window, {
      elder_id: '',
      shift_id: '',
      status: '',
    })
    expect(result.pending_work.count).toBe(1)
    expect(
      selectedDashboardRows(result, { kind: 'card', key: 'pending_tasks' }),
    ).toEqual([task1])
    expect(
      selectedDashboardRows(result, {
        kind: 'distribution',
        section: 'tasks',
        key: 'completed',
      }),
    ).toEqual([task2])
    expect(
      selectedDashboardRows(result, { kind: 'trend', key: '2026-10-25' }),
    ).toEqual([task1, task2])
    expect(formatRatio({ numerator: 0, denominator: 0, ratio: null })).toBe(
      '暂无可计算数据',
    )
    expect(formatRatio({ numerator: 0, denominator: 4, ratio: 0 })).toBe('0%')
    expect(dashboardLocation(task1)).toBe('/tasks?task=TASK-1')
  })

  it('rejects count, ratio, filter, duplicate-id and cross-reference inconsistencies', () => {
    const cases = [
      (value: ReturnType<typeof snapshot>) => {
        value.cards.pending_tasks.count = 2
      },
      (value: ReturnType<typeof snapshot>) => {
        value.cards.pending_tasks.change_ratio = 0 as never
      },
      (value: ReturnType<typeof snapshot>) => {
        value.filters.elder_id = 'OTHER' as never
      },
      (value: ReturnType<typeof snapshot>) => {
        value.details.tasks.items[1].id = 'TASK-1'
      },
      (value: ReturnType<typeof snapshot>) => {
        value.distributions.tasks[0].ids = ['MISSING']
      },
      (value: ReturnType<typeof snapshot>) => {
        value.task_trend[0].completion.ratio = 0.8
      },
      (value: ReturnType<typeof snapshot>) => {
        value.pending_work.count = 2
      },
    ]
    for (const [index, mutate] of cases.entries()) {
      const value = snapshot()
      mutate(value)
      expect(
        () =>
          validateDashboard(value, window, {
            elder_id: '',
            shift_id: '',
            status: '',
          }),
        `case ${index}`,
      ).toThrow()
    }
  })

  it('compares independently decoded nested JSON values and still rejects changed evidence', () => {
    const value = snapshot()
    for (const row of [
      value.cards.pending_tasks.items[0],
      value.details.tasks.items[0],
      value.pending_work.items[0],
    ])
      Object.assign(row, {
        memory_references: [{ id: 'MEM-1', evidence: ['人工依据'] }],
      })
    const decoded = JSON.parse(JSON.stringify(value))
    expect(() =>
      validateDashboard(decoded, window, {
        elder_id: '',
        shift_id: '',
        status: '',
      }),
    ).not.toThrow()
    decoded.cards.pending_tasks.items[0].memory_references[0].evidence[0] =
      '被改动'
    expect(() =>
      validateDashboard(decoded, window, {
        elder_id: '',
        shift_id: '',
        status: '',
      }),
    ).toThrow()
  })

  it('invalidates stale responses after filters, account credentials or component lifetime change', () => {
    let scope: string | null = 'account-a-token-1'
    const guard = createRequestGuard(() => scope)
    const first = guard.begin(),
      second = guard.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
    scope = 'account-a-token-2'
    expect(second()).toBe(false)
    const third = guard.begin()
    scope = null
    expect(third()).toBe(false)
    scope = 'account-b'
    const fourth = guard.begin()
    guard.invalidate()
    expect(fourth()).toBe(false)
  })
  it('freezes in-flight filter values and routes photo rows to exact management objects', () => {
    const filters = { elder_id: '', shift_id: '', status: '' }
    const captured = captureDashboardRequest(window, filters)
    filters.elder_id = 'CHANGED'
    expect(captured.filters.elder_id).toBe('')
    expect(captured.path).not.toContain('CHANGED')
    expect(
      dashboardLocation({ kind: 'image_analyses', id: 'AI 1', elder_id: 'E1' }),
    ).toBe(
      '/workflows/records?elder=E1&elder_id=E1&analysis_id=AI+1&action=%2Frecords%2Fmanual',
    )
    expect(dashboardGroupLabel('incident_categories', 'restraint')).toBe(
      '约束相关',
    )
    expect(dashboardGroupLabel('family_kind', 'feedback')).toBe('家属反馈')
    expect(dashboardLocation({ kind: 'summary', id: 'SUMMARY-1' })).toBe(
      '/workflows/family?summary_id=SUMMARY-1&action=%2Ffamily%2Fsummaries%2F%7Bsummary_id%7D%2Freview',
    )
    expect(
      dashboardLocation({
        kind: 'impression_point',
        id: 'REPORT-1:POINT-2',
        elder_id: 'E1',
        report_id: 'REPORT-1',
        point_id: 'POINT-2',
      }),
    ).toBe('/elders/E1?impression_id=REPORT-1&point_id=POINT-2')
  })
  it('stops directory pagination immediately when its request scope expires', async () => {
    let valid = true,
      calls = 0
    const rows = await loadDashboardDirectory(
      async () => {
        calls++
        valid = false
        return Array.from({ length: 200 }, (_, id) => ({
          id: String(id),
          name: '虚构',
        }))
      },
      '/elders',
      () => valid,
    )
    expect(rows).toBeNull()
    expect(calls).toBe(1)
  })
})
