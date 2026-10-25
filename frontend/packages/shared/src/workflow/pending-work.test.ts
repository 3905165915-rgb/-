import { describe, expect, it } from 'vitest'
import type { FrontendSession } from '../session'
import { isPendingRead, markPendingRead, pendingReadKey, pendingWork, pendingWorkLocation } from './pending-work'
const session: FrontendSession = { mode: 'api', accountKey: 'isolated-test', userId: 'U1', role: 'caregiver' }
const sources = {
  drafts: [{ id: 'D1', elder_id: 'E1', revision: 1, status: 'pending_review', created_by: 'U1' }, { id: 'D2', status: 'pending_review', created_by: 'U2' }],
  shifts: [{ id: 'S1', caregiver_ids: ['U1'] }],
  handovers: [{ id: 'H1', status: 'submitted', target_shift_id: 'S1', items: [{ id: 'I1', status: 'pending', elder_id: 'E1' }, { id: 'I2', status: 'received' }] }, { id: 'H2', status: 'draft', items: [{ id: 'I3', status: 'pending' }] }],
  incidents: [{ id: 'INC1', status: 'reported' }, { id: 'INC2', status: 'rectifying', revision: 1, rectification: { id: 'RECT2', revision: 2, assigned_to: 'U1', status: 'assigned', reviews: [{ decision: 'return' }] } }, { id: 'INC3', status: 'closed' }],
}
describe('current pending work queue', () => {
  it('denies family and keeps caregiver scope to own review/shift/rectification work', () => {
    expect(pendingWork(sources, { ...session, role: 'family' })).toEqual([])
    expect(pendingWork(sources, null)).toEqual([])
    expect(pendingWork(sources, session).map(row => row.key).sort()).toEqual(['record:D1', 'handover:I1', 'incident:INC2'].sort())
    expect(pendingWork(sources, session).find(row => row.key === 'incident:INC2')?.title).toContain('退回')
    expect(pendingWork(sources, { ...session, userId: undefined }).filter(row => row.kind === 'record')).toEqual([])
  })
  it('keeps read separate from processing and makes changed revisions unread', () => {
    const values = new Map<string, string>()
    const store = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const item = pendingWork(sources, session).find(row => row.key === 'record:D1')!
    markPendingRead(store, session, item)
    expect(isPendingRead(store, session, item)).toBe(true)
    expect(pendingWork(sources, session)).toHaveLength(3)
    const changed = pendingWork({ ...sources, drafts: [{ ...sources.drafts[0], revision: 2 }] }, session).find(row => row.key === 'record:D1')!
    expect(isPendingRead(store, session, changed)).toBe(false)
    expect(pendingReadKey({ ...session, accountKey: 'another' })).not.toBe(pendingReadKey(session))
    expect(pendingWork({ ...sources, drafts: [{ ...sources.drafts[0], status: 'confirmed' }] }, session)).toHaveLength(2)
  })
  it('links directly to current business objects and prevents own independent review', () => {
    const item = pendingWork(sources, session).find(row => row.kind === 'handover')!
    expect(pendingWorkLocation(item, true)).toEqual({ path: '/handover', query: { handover_id: 'H1', item_id: 'I1', action: '/handovers/{handover_id}', read: '1' } })
    const incidents = [{ id: 'INC4', status: 'rectifying', rectification: { id: 'R4', status: 'awaiting_review', submissions: [{ by: 'U1' }] } }]
    expect(pendingWork({ incidents }, { ...session, role: 'supervisor' })).toEqual([])
    expect(pendingWork({ incidents }, { ...session, role: 'supervisor', userId: 'U2' })[0].title).toBe('整改待独立复查')
  })
})
