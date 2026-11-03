import { describe, expect, it } from 'vitest'
import { inboxPage, inboxForm, inboxLocation, type InboxRow } from './work-inbox'
const item: InboxRow = { id: 'incidents:INC-SYN', object_id: 'INC-SYN', object_type: 'incidents', title: '虚构安全情况', queue: 'mine', notification_ids: [], unread: true, elder_id: 'E-SYN' }
describe('work inbox business navigation', () => {
  it('opens the incident context without executing its command', () => {
    expect(inboxForm(item, 'supervisor')).toMatchObject({ group: 'incidents', action: '/incidents/{incident_id}', read: true, context: { incident_id: 'INC-SYN', elder_id: 'E-SYN' } })
    expect(inboxForm({ ...item, queue: 'processed' }, 'supervisor')).toBeNull()
  })
  it('keeps task prerequisites in the dedicated task page on both devices', () => {
    const task = { ...item, object_type: 'care_tasks', object_id: 'TASK-SYN' }
    expect(inboxForm(task, 'caregiver')).toBeNull()
    expect(inboxLocation(task, true).path).toBe('/tasks/TASK-SYN')
    expect(inboxLocation(task, false).query).toMatchObject({ task: 'TASK-SYN', elder: 'E-SYN' })
  })
  it('uses authorized aggregate totals and rejects duplicate business rows', () => {
    const page = { items: [item], counts: { mine: 12, review: 3, waiting: 4, processed: 20 }, total: 12, offset: 0, limit: 5, as_of: '2026-11-03T08:00:00+08:00' }
    expect(inboxPage(page).total).toBe(12)
    expect(() => inboxPage({ ...page, items: [item, item] })).toThrow()
  })
})
