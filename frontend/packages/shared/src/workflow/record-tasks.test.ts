import { describe, expect, it } from 'vitest'
import type { FrontendSession } from '../session'
import { requestBody, schemas, type Row } from './model'
import { recordTaskOwners, recordSavedMessage, reviewedRecordTasks, selectedRecordTasks } from './record-tasks'

const me = { id: 'U1', display_name: '小王', role: 'caregiver', active: true }
const other = { id: 'U2', display_name: '小李', role: 'caregiver', active: true }
const manager = { id: 'U3', display_name: '主管', role: 'supervisor', active: true }
const session: FrontendSession = { mode: 'api', accountKey: 'test', userId: 'U1', role: 'caregiver' }
const catalogs = { staff: [me, other, manager, { ...me, id: 'disabled', active: false }], shifts: [
  { id: 'S1', caregiver_ids: ['U1', 'U3'] },
  { id: 'S2', caregiver_ids: ['U2'] },
] }
const task = (): Row => ({ title: '联系家属', assigned_to: 'U1', due_at: '2026-10-25T15:00:00+08:00', due_text: '明天下午三点', evidence_text: '明天下午三点由小王负责联系家属', review_notes: ['待核对'], include_task: true })

describe('tasks created with a reviewed record', () => {
  it('caregivers can only choose themselves and shift selection cannot widen authority', () => {
    expect(recordTaskOwners(catalogs, session, 'S1')).toEqual([me])
    expect(recordTaskOwners(catalogs, session, 'S2')).toEqual([])
    expect(recordTaskOwners(catalogs, session, 'unknown')).toEqual([])
    expect(recordTaskOwners(catalogs, session, '')).toEqual([me])
  })
  it('management can select only active staff and selected shift members', () => {
    expect(recordTaskOwners(catalogs, { ...session, role: 'supervisor' }, 'S1')).toEqual([me, manager])
    expect(recordTaskOwners(catalogs, { ...session, role: 'admin' }, undefined)).toEqual([me, other, manager])
    expect(recordTaskOwners(catalogs, null, undefined)).toEqual([])
    expect(recordTaskOwners(catalogs, { ...session, role: 'family' }, undefined)).toEqual([])
  })
  it('keeps the supported candidate shape and discards UI metadata', () => {
    expect(reviewedRecordTasks([task()], [me])).toEqual([{
      title: '联系家属', assigned_to: 'U1', due_at: '2026-10-25T07:00:00.000Z', due_text: '明天下午三点',
    }])
    expect(task()).toHaveProperty('evidence_text')
  })
  it.each(['title', 'assigned_to', 'due_at'])('requires %s or explicit deselection before submission', key => {
    expect(() => reviewedRecordTasks([{ ...task(), [key]: '' }], [me])).toThrow('第1项待办')
    expect(reviewedRecordTasks([{ ...task(), [key]: '', include_task: false }], [me])).toEqual([])
  })
  it('validates owners, dates and limits instead of submitting partial or malformed data', () => {
    expect(() => reviewedRecordTasks([{ ...task(), assigned_to: 'U2' }], [me])).toThrow('可安排范围')
    expect(() => reviewedRecordTasks([{ ...task(), due_at: '错误日期' }], [me])).toThrow()
    expect(() => reviewedRecordTasks([{ ...task(), due_at: '2026-02-30T15:00' }], [me])).toThrow('有效日期')
    expect(() => reviewedRecordTasks(Array.from({ length: 51 }, task), [me])).toThrow('50')
    expect(() => reviewedRecordTasks([null], [me])).toThrow('格式')
    expect(() => reviewedRecordTasks('invalid', [me])).toThrow('格式')
  })
  it('keeps execution conditions and never declares them verified', () => {
    const body = reviewedRecordTasks([{ ...task(), condition: '本人同意后', condition_verification: { status: 'met' } }], [me])
    expect(body[0].condition).toBe('本人同意后')
    expect(body[0]).not.toHaveProperty('condition_verification')
  })
  it('flags multi-elder evidence for explicit object review', () => {
    const row = { ...task(), object_review_required: true }
    expect(() => reviewedRecordTasks([row], [me])).toThrow('其他老人')
    expect(reviewedRecordTasks([{ ...row, object_review_confirmed: true }], [me])).toHaveLength(1)
  })
  it('sends explicit empty tasks to confirmation and manual entry, without reviving AI candidates', () => {
    const candidates = reviewedRecordTasks([{ ...task(), include_task: false }], [me])
    expect(requestBody('/records/{draft_id}/confirm', schemas.RecordConfirmRequest, {
      observations: ['原文'], expected_revision: 3, task_candidates: candidates,
    })).toEqual({ observations: ['原文'], expected_revision: 3, task_candidates: [] })
    expect(requestBody('/records/manual', schemas.ManualRecordRequest, { elder_id: 'E1', raw_text: '原文', task_candidates: candidates })).toHaveProperty('task_candidates', [])
    expect(selectedRecordTasks([task(), { ...task(), include_task: false }])).toHaveLength(1)
  })
  it('derives the success count from the server receipt, not draft predictions', () => {
    expect(recordSavedMessage({ record: {}, tasks: [task(), task()] })).toContain('创建了2项任务')
    expect(recordSavedMessage({ record: {}, tasks: [] })).toContain('未创建任务')
    expect(recordSavedMessage({ task_candidates: [task()] })).toBeNull()
    expect(recordSavedMessage(null)).toBeNull()
  })
})
