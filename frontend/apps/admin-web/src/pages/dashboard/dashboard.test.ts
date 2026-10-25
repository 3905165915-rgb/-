import { describe, expect, it } from 'vitest'
import {
  buildBreakdown, chartGroups, createRequestGuard, defaultWindow, formatRatio,
  mismatches, stamp, validateMetrics, validateWindow, type Metrics, type Sources,
} from './dashboard'

const window = { start: '2026-10-25', end: '2026-10-26' }
function metrics(): Metrics {
  const zero = { numerator: 0, denominator: 0, ratio: null }
  return {
    as_of: '2026-10-25T12:00:00+08:00', timezone: 'Asia/Shanghai',
    window: { start_inclusive: '2026-10-25T00:00:00+08:00', end_exclusive: '2026-10-26T00:00:00+08:00' },
    interpretation: '状态取当前快照',
    generated_plan_occurrences: {
      completion: { ...zero }, on_time_completion: { ...zero }, cancelled: 0, not_done: 0,
      open_overdue: 0, excluded_future_task_rows: 0, invalid_schedule_rows: 0, definition: '仅已生成批次',
    },
    manual_task_rows_created: 0, handover_receipt: { ...zero, definition: '全部提交条目' },
    incidents: { reported: 0, closed: 0, open_rectifications_overdue: 0, definition: '发生时间' },
    family_feedback: { created: 0, closed: 0, definition: '主管回复' },
  }
}
const empty = (): Sources => ({ tasks: [], handovers: [], incidents: [], feedback: [] })
const task = (id: string, extra = {}) => ({
  id, status: 'pending', elder_id: 'E1', occurrence_key: id, scheduled_at: '2026-10-25T08:00:00+08:00',
  due_at: '2026-10-25T09:00:00+08:00', ...extra,
})

describe('management metrics validation and dates', () => {
  it('uses Beijing day boundaries and rejects impossible, reversed and excessive ranges', () => {
    expect(defaultWindow(Date.parse('2026-10-24T17:00:00Z'))).toEqual(window)
    expect(validateWindow(window)).toBeNull()
    for (const w of [
      { start: '2026-02-30', end: '2026-03-02' }, { start: window.start, end: window.start },
      { start: window.end, end: window.start }, { start: '2025-01-01', end: '2026-01-03' },
    ]) expect(validateWindow(w)).toBeTruthy()
    expect(validateWindow({ start: '2024-01-01', end: '2025-01-01' })).toBeNull()
    for (const value of ['2026-10-25T08:00:00', '2026-02-30T08:00:00Z', '2026-10-25T24:00:00Z', '2026-10-25T08:00:00+25:00', null])
      expect(stamp(value)).toBeNull()
  })
  it('distinguishes no denominator from zero percent', () => {
    const m = validateMetrics(metrics(), window)
    expect(formatRatio(m.handover_receipt)).toBe('暂无分母')
    expect(formatRatio({ numerator: 0, denominator: 3, ratio: 0 })).toBe('0%')
    expect(chartGroups(m)).toHaveLength(5)
    expect(mismatches(m, buildBreakdown(m, empty()))).toEqual([])
  })
  it('rejects malformed shapes, counts, ratios, timezone, requested window and impossible totals', () => {
    const invalid = [
      (m: Metrics) => { m.timezone = 'UTC' as Metrics['timezone'] },
      (m: Metrics) => { m.window.end_exclusive = '2026-10-26T00:00:00Z' },
      (m: Metrics) => { m.as_of = '2026-10-25' },
      (m: Metrics) => { m.incidents.reported = -1 },
      (m: Metrics) => { m.manual_task_rows_created = 0.5 },
      (m: Metrics) => { m.handover_receipt.ratio = 0 },
      (m: Metrics) => { m.handover_receipt = { numerator: 1, denominator: 3, ratio: 0.5, definition: 'x' } },
      (m: Metrics) => { m.generated_plan_occurrences.on_time_completion.denominator = 2 },
      (m: Metrics) => { m.generated_plan_occurrences.cancelled = 1 },
      (m: Metrics) => { m.generated_plan_occurrences.open_overdue = 1 },
      (m: Metrics) => { m.family_feedback.closed = 1 },
      (m: Metrics) => { m.incidents.closed = 1 },
      (m: Metrics) => { m.interpretation = ' ' },
    ]
    for (const mutate of invalid) { const m = metrics(); mutate(m); expect(() => validateMetrics(m, window)).toThrow() }
    expect(() => validateMetrics([], window)).toThrow()
  })
})

describe('exact source predicates match report_service', () => {
  it('counts replacement leaves, excludes future and invalid schedules and keeps cancelled in denominator', () => {
    const tasks = [
      task('old', { occurrence_key: 'chain', status: 'cancelled' }),
      task('new', { occurrence_key: 'chain', replaces_task_id: 'old', status: 'completed', completed_at: '2026-10-25T09:00:00+08:00' }),
      task('late', { status: 'completed', completed_at: '2026-10-25T09:00:01+08:00' }),
      task('cancelled', { status: 'cancelled' }), task('not-done', { status: 'not_done' }),
      task('future', { scheduled_at: '2026-10-25T13:00:00+08:00' }),
      task('invalid', { scheduled_at: 'bad' }),
      task('upper-bound', { scheduled_at: '2026-10-26T00:00:00+08:00' }),
      task('manual', { occurrence_key: null, created_at: '2026-10-25T00:00:00+08:00' }),
      task('manual-future', { occurrence_key: null, created_at: '2026-10-25T12:00:01+08:00' }),
    ]
    const b = buildBreakdown(metrics(), { ...empty(), tasks })
    expect(b.plan.map(r => r.id)).toEqual(['new', 'late', 'cancelled', 'not-done'])
    expect(b.onTime.map(r => r.id)).toEqual(['new'])
    expect(b.completed.map(r => r.id)).toEqual(['new', 'late'])
    expect(b.cancelled.map(r => r.id)).toEqual(['cancelled'])
    expect(b.notDone.map(r => r.id)).toEqual(['not-done'])
    expect(b.overdue.map(r => r.id)).toEqual(['not-done'])
    expect(b.future.map(r => r.id)).toEqual(['future'])
    expect(b.invalid.map(r => r.id)).toEqual(['invalid'])
    expect(b.manual.map(r => r.id)).toEqual(['manual'])
    expect(b.plan[0].to).toBe('/tasks?task=new')
    expect(mismatches(metrics(), b).some(r => r.key === 'plan')).toBe(true)
  })
  it('uses parent submission time for handovers, occurrence for incidents and created time for feedback', () => {
    const sources = {
      ...empty(),
      handovers: [
        { id: 'H1', status: 'submitted', submitted_at: '2026-10-25T08:00:00+08:00', items: [
          { id: 'I1', handover_id: 'H1', status: 'received', elder_id: 'E1' },
          { id: 'I2', handover_id: 'H1', status: 'clarifying' },
        ] },
        { id: 'H2', status: 'draft', submitted_at: '2026-10-25T08:00:00+08:00', items: [] },
      ],
      incidents: [
        { id: 'INC1', status: 'rectifying', occurred_at: '2026-10-25T00:00:00+08:00', rectification: {
          id: 'R1', incident_id: 'INC1', status: 'awaiting_review', due_at: '2026-10-25T11:59:59+08:00',
        } },
        { id: 'INC2', status: 'closed', occurred_at: '2026-10-25T09:00:00+08:00', rectification: null },
        { id: 'INC3', status: 'reported', occurred_at: '2026-10-24T23:59:59+08:00', rectification: null },
      ],
      feedback: [
        { id: 'F1', kind: 'feedback', status: 'closed', created_at: '2026-10-25T08:00:00+08:00' },
        { id: 'F2', kind: 'feedback', status: 'open', created_at: '2026-10-25T09:00:00+08:00' },
        { id: 'summary', kind: 'summary', status: 'published', created_at: '2026-10-25T08:00:00+08:00' },
      ],
    }
    const b = buildBreakdown(metrics(), sources)
    expect(b.handover).toHaveLength(2); expect(b.received.map(r => r.id)).toEqual(['I1'])
    expect(b.incidents.map(r => r.id)).toEqual(['INC1', 'INC2'])
    expect(b.closedIncidents.map(r => r.id)).toEqual(['INC2'])
    expect(b.rectifications.map(r => r.id)).toEqual(['R1'])
    expect(b.feedback.map(r => r.id)).toEqual(['F1', 'F2']); expect(b.replied.map(r => r.id)).toEqual(['F1'])
    expect(b.handover[0].to).toContain('item_id=I1')
    expect(b.rectifications[0].to).toContain('incident_id=INC1')
  })
  it('refuses ambiguous chains, duplicate ids and incorrectly related nested objects', () => {
    expect(() => buildBreakdown(metrics(), { ...empty(), tasks: [task('a', { occurrence_key: 'x' }), task('b', { occurrence_key: 'x' })] })).toThrow(/末项不唯一/)
    expect(() => buildBreakdown(metrics(), { ...empty(), tasks: [task('a'), task('a')] })).toThrow(/重复编号/)
    expect(() => buildBreakdown(metrics(), { ...empty(), handovers: [{ id: 'H', status: 'submitted', submitted_at: metrics().as_of, items: [{ id: 'I', status: 'pending', handover_id: 'OTHER' }] }] })).toThrow(/所属交班单/)
    expect(() => buildBreakdown(metrics(), { ...empty(), incidents: [{ id: 'I', status: 'reported', occurred_at: metrics().as_of, rectification: { id: 'R', status: 'assigned', incident_id: 'OTHER' } }] })).toThrow(/所属事件/)
  })
  it('invalidates late requests when the date, credentials, account or lifetime changes', () => {
    let scope: string | null = 'account-a-token-1'
    const guard = createRequestGuard(() => scope)
    const first = guard.begin(), second = guard.begin()
    expect(first()).toBe(false); expect(second()).toBe(true)
    scope = 'account-a-token-2'; expect(second()).toBe(false)
    const third = guard.begin(); scope = null; expect(third()).toBe(false)
    scope = 'account-b'; const fourth = guard.begin(); guard.invalidate(); expect(fourth()).toBe(false)
  })
})
