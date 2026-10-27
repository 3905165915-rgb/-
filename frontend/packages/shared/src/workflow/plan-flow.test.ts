import { describe, expect, it, vi } from 'vitest'
import { newPlanExecution, newPlanItem, planOccurrences, preparePlan, restorePlanExecution, runPlanExecution, selectPlanElder, usableAssessments, type PlanDraft } from './plan-flow'
import type { Row } from './model'

const assessment = { id: 'assessment-1', elder_id: 'elder-1', revision: 3, status: 'confirmed', review_due_at: '2099-11-01T00:00:00Z' }
const shift = { id: 'shift-1', status: 'open', start_at: '2099-10-27T00:00:00+08:00', end_at: '2099-10-28T00:00:00+08:00', caregiver_ids: ['staff-1'] }
function draft(): PlanDraft {
  return { title: '照护计划', goal: '活动前询问意愿', startsOn: '2099-10-27', endsOn: '2099-11-01', serviceDate: '2099-10-27', shiftId: 'shift-1', assignedTo: 'staff-1', reason: '已逐项核对', items: [{ ...newPlanItem('listen'), title: '询问听戏意愿', instruction: '先征求本人意愿', times: ['15:00'], condition: '本人愿意' }] }
}
function prepared() { return preparePlan('elder-1', assessment, draft(), [shift], [{ id: 'staff-1', active: true }]) }
function tx() {
  let count = 0
  return newPlanExecution('manager', prepared(), () => `request-${++count}`)
}
const receipt = (revision: number): Row => ({ id: 'plan-1', elder_id: 'elder-1', revision })

describe('plan preview and context', () => {
  it('keeps an explicit elder context and only auto-selects a sole elder', () => {
    expect(selectPlanElder(undefined, [{ id: 'elder-1' }])).toBe('elder-1')
    expect(selectPlanElder('missing', [{ id: 'elder-1' }])).toBe('')
    expect(selectPlanElder(undefined, [{ id: 'elder-1' }, { id: 'elder-2' }])).toBe('')
    expect(selectPlanElder('elder-2', [{ id: 'elder-1' }, { id: 'elder-2' }])).toBe('elder-2')
  })
  it('excludes another elder, unconfirmed, expired and ineffective assessments', () => {
    const invalid = [{ ...assessment, elder_id: 'other' }, { ...assessment, status: 'draft' }, { ...assessment, effective: false }, { ...assessment, review_due: true }, { ...assessment, review_due_at: '2000-01-01T00:00:00Z' }, { ...assessment, revision: '3' }]
    expect(usableAssessments([...invalid, assessment], 'elder-1')).toEqual([assessment])
  })
  it('binds assessment and revision without user ID inputs and uses Beijing time', () => {
    const value = prepared()
    expect(value.create).toMatchObject({ assessment_id: 'assessment-1', expected_assessment_revision: 3 })
    expect(value.generate).toEqual({ service_date: '2099-10-27', shift_id: 'shift-1', assigned_to: 'staff-1' })
    expect(value.occurrences[0]).toMatchObject({ time: '2099-10-27T07:00:00.000Z', deadline: '2099-10-27T08:00:00.000Z', condition: '本人愿意' })
  })
  it('rejects closed shifts, outsiders and windows crossing the selected shift', () => {
    expect(() => preparePlan('elder-1', assessment, draft(), [{ ...shift, status: 'closed' }], [{ id: 'staff-1' }])).toThrow('开放班次')
    expect(() => preparePlan('elder-1', assessment, draft(), [{ ...shift, caregiver_ids: ['other'] }], [{ id: 'staff-1' }])).toThrow('责任人')
    expect(() => preparePlan('elder-1', assessment, draft(), [{ ...shift, end_at: '2099-10-27T15:30:00+08:00' }], [{ id: 'staff-1' }])).toThrow('执行窗口')
  })
  it('uses weekdays and an interval anchored to the plan start date', () => {
    const value = prepared().create
    const item = (value.items as Row[])[0]
    item.every_n_days = 2
    expect(planOccurrences(value, '2099-10-28')).toEqual([])
    expect(planOccurrences(value, '2099-10-29')).toHaveLength(1)
    item.weekdays = [new Date('2099-10-27').getUTCDay() || 7]
    expect(planOccurrences(value, '2099-10-29')).toHaveLength(0)
    expect(() => planOccurrences(value, '2099-11-02')).toThrow('生效日期')
  })
  it('rejects duplicate occurrence times and a service day with no occurrences', () => {
    const duplicate = draft()
    duplicate.items[0].times = ['15:00', '15:00']
    expect(() => preparePlan('elder-1', assessment, duplicate, [shift], [{ id: 'staff-1' }])).toThrow('时间不能重复')
    const empty = draft()
    empty.items[0].weekdays = [((new Date('2099-10-27').getUTCDay() || 7) % 7) + 1]
    expect(() => preparePlan('elder-1', assessment, empty, [shift], [{ id: 'staff-1' }])).toThrow('没有应执行事项')
  })
})

describe('plan API partial execution and recovery', () => {
  it('does not call an arbitrary successful response or partial generation complete', async () => {
    for (const value of [{ message: 'ok' }, { tasks: [{ id: 'task-1' }], failed: ['task-2'] }, { tasks: [{ id: '' }] }, []]) {
      const execution = tx()
      const write = vi.fn().mockResolvedValueOnce(receipt(1)).mockResolvedValueOnce(receipt(2)).mockResolvedValueOnce(value)
      await expect(runPlanExecution(execution, write, () => {})).rejects.toThrow('生成任务')
      expect(execution.steps[0].receipt).toBeDefined(); expect(execution.steps[1].receipt).toBeDefined(); expect(execution.steps[2].receipt).toBeUndefined()
    }
  })
  it('replays only the unknown creation with its original body/key after a lost response', async () => {
    const execution = tx()
    let saved: unknown
    const save = () => { saved = structuredClone(execution) }
    const write = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(receipt(1)).mockResolvedValueOnce(receipt(2)).mockResolvedValueOnce({ tasks: [{ id: 'task-1' }] })
    await expect(runPlanExecution(execution, write, save)).rejects.toThrow('connection lost')
    const restored = restorePlanExecution(saved, 'manager', 'elder-1')
    await runPlanExecution(restored, write, () => {})
    expect(write.mock.calls.map(call => call[0])).toEqual(['/care-plans', '/care-plans', '/care-plans/plan-1/review', '/care-plans/plan-1/generate'])
    expect(write.mock.calls[0]).toEqual(write.mock.calls[1])
    expect(restored.steps.every(step => step.receipt !== undefined)).toBe(true)
  })
  it('does not repeat creation or approval when task generation fails', async () => {
    const execution = tx()
    const write = vi.fn().mockResolvedValueOnce(receipt(1)).mockResolvedValueOnce(receipt(2)).mockRejectedValueOnce(new Error('server unavailable')).mockResolvedValueOnce({ created: [] })
    await expect(runPlanExecution(execution, write, () => {})).rejects.toThrow('server unavailable')
    const restored = restorePlanExecution(JSON.parse(JSON.stringify(execution)), 'manager', 'elder-1')
    await runPlanExecution(restored, write, () => {})
    expect(write.mock.calls.map(call => call[0])).toEqual(['/care-plans', '/care-plans/plan-1/review', '/care-plans/plan-1/generate', '/care-plans/plan-1/generate'])
    expect(write.mock.calls[2]).toEqual(write.mock.calls[3])
    expect(write.mock.calls[3][1].expected_revision).toBe(2)
  })
  it('does not send writes if persistence fails before dispatch', async () => {
    const write = vi.fn()
    await expect(runPlanExecution(tx(), write, () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(write).not.toHaveBeenCalled()
  })
  it('does not advance on malformed or mismatched receipts', async () => {
    for (const value of [null, {}, { ...receipt(1), elder_id: 'other' }]) {
      const execution = tx()
      const write = vi.fn().mockResolvedValue(value)
      await expect(runPlanExecution(execution, write, () => {})).rejects.toThrow('回执')
      expect(write).toHaveBeenCalledTimes(1)
      expect(execution.steps[0].receipt).toBeUndefined()
    }
  })
  it('refuses an invalid approval receipt and does not generate tasks', async () => {
    const write = vi.fn().mockResolvedValueOnce(receipt(1)).mockResolvedValueOnce(receipt(1))
    await expect(runPlanExecution(tx(), write, () => {})).rejects.toThrow('版本未更新')
    expect(write).toHaveBeenCalledTimes(2)
  })
  it('refuses recovery under another account/elder or altered pending payload', async () => {
    const execution = tx()
    await expect(runPlanExecution(execution, vi.fn().mockRejectedValue(new Error('offline')), () => {})).rejects.toThrow()
    expect(() => restorePlanExecution(execution, 'other-manager', 'elder-1')).toThrow('恢复日志')
    expect(() => restorePlanExecution(execution, 'manager', 'other-elder')).toThrow('恢复日志')
    execution.steps[0].pending!.payload.title = 'changed body'
    expect(() => restorePlanExecution(execution, 'manager', 'elder-1')).toThrow('原请求')
  })
})
