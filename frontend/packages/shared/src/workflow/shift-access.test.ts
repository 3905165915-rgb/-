import { describe, expect, it } from 'vitest'
import type { FrontendSession } from '../session'
import type { Operation, Row } from './model'
import { actorId, shiftFieldOptions, submissionIssue, writableShifts } from './shift-access'

const session: FrontendSession = { mode: 'api', accountKey: 'caregiver-name', role: 'caregiver', userId: 'U1' }
const shifts: Row[] = [
  { id: 'mine', status: 'open', caregiver_ids: ['U1'] },
  { id: 'other', status: 'open', caregiver_ids: ['U2'] },
  { id: 'closed', status: 'closed', caregiver_ids: ['U1'] },
]
const write = { path: '/records/manual', method: 'post' } as Operation
const read = { ...write, method: 'get' }
const catalogs = { shifts, tasks: [
  { id: 'T1', shift_id: 'mine', assigned_to: 'U1', status: 'pending' },
  { id: 'T2', shift_id: 'other', assigned_to: null, status: 'pending' },
  { id: 'T3', shift_id: 'mine', assigned_to: 'U2', status: 'pending' },
  { id: 'T4', shift_id: 'closed', assigned_to: 'U1', status: 'pending' },
] }
describe('shift-aware submission forms', () => {
  it('uses stable user IDs, never the login name, for membership', () => {
    expect(actorId(session)).toBe('U1')
    expect(writableShifts(shifts, session).map(r => r.id)).toEqual(['mine'])
  })
  it('recovers stable IDs from pre-update sessions without using tokens as server authorization', () => {
    const legacy = { ...session, userId: undefined, accessToken: 'head.' + btoa(JSON.stringify({sub:'U1'})) + '.sig' }
    expect(actorId(legacy)).toBe('U1')
    expect(actorId({...legacy, accessToken:'invalid'})).toBe('')
    expect(writableShifts(shifts, {...legacy, accessToken:'invalid'})).toEqual([])
  })
  it.each(['admin', 'supervisor'] as const)('lets %s choose any open shift', role => {
    expect(writableShifts(shifts, {...session, role}).map(r => r.id)).toEqual(['mine','other'])
  })
  it('keeps other caregivers available as target shifts, while filtering source shifts', () => {
    const options = shiftFieldOptions(write, catalogs, session)
    expect(options.source_shift_id.map(r => r.id)).toEqual(['mine'])
    expect(options.target_shift_id.map(r => r.id)).toEqual(['mine','other'])
    expect(shiftFieldOptions(read, catalogs, session)).toEqual({})
  })
  it('blocks restored wrong shifts before posting and preserves unbound manual entry', () => {
    expect(submissionIssue(write, {}, {shift_id:'other'}, catalogs, session)).toContain('未分配')
    expect(submissionIssue(write, {}, {shift_id:'closed'}, catalogs, session)).toContain('已关闭')
    expect(submissionIssue(write, {}, {shift_id:'mine'}, catalogs, session)).toBe('')
    expect(submissionIssue(write, {}, {}, catalogs, session)).toBe('')
    expect(submissionIssue(read, {}, {shift_id:'other'}, catalogs, session)).toBe('')
  })
  it('filters task actions by shift membership and ownership', () => {
    const op = {...write, path:'/tasks/{task_id}/complete'}
    expect(shiftFieldOptions(op, catalogs, session).task_id.map(r => r.id)).toEqual(['T1'])
    expect(submissionIssue(op, {task_id:'T2'}, {}, catalogs, session)).toContain('先完成接班')
    expect(submissionIssue(op, {task_id:'T1'}, {}, catalogs, session)).toBe('')
  })
})
