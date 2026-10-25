import { describe, expect, it, vi } from 'vitest'
import type { FrontendSession } from '../session'
import { clearNotificationAction, notificationActionKey, notificationLocation, notificationStages, validateNotifications, type ServerNotification } from './pending-work'

const session: FrontendSession = { mode: 'api', accountKey: 'notice-test', userId: 'U1', role: 'caregiver' }
const item: ServerNotification = {
  id: 'N1', object_type: 'incidents', object_id: 'INC1', elder_id: 'E1', title: '安全事件待分级',
  stage: 'triage', status: 'pending', read_at: null, revision: 2, created_at: '2026-10-25T10:00:00Z',
}
describe('server notifications', () => {
  it('validates paginated server envelopes and rejects malformed or duplicate notifications', () => {
    const value = { items: [item], total: 1, offset: 0, limit: 100, as_of: '2026-10-25T10:01:00Z', definition: '服务器状态' }
    expect(validateNotifications(value).items).toEqual([item])
    expect(() => validateNotifications({ ...value, items: [{ ...item, revision: 0 }] })).toThrow('必要字段')
    expect(() => validateNotifications({ ...value, total: 2, items: [item, item] })).toThrow('必要字段')
    expect(() => validateNotifications({ ...value, total: -1 })).toThrow('字段不完整')
  })
  it('routes each notice to its underlying business object and maps known stages to Chinese', () => {
    expect(notificationLocation(item, true)).toEqual({ path: '/safety', query: { incident_id: 'INC1', action: '/incidents/{incident_id}', read: '1' } })
    expect(notificationLocation(item, false).path).toBe('/workflows/incidents')
    expect(notificationStages.triage).toBe('安全事件分级')
    expect(notificationLocation({ ...item, object_type: 'unknown' }, true).path).toBe('/notifications')
    expect(notificationLocation({ ...item, object_type: 'image_analyses' }, false)).toEqual({ path: '/workflows/records', query: { elder: 'E1', elder_id: 'E1', analysis_id: 'INC1', action: '/records/manual' } })
    expect(notificationLocation({ ...item, object_type: 'attachments' }, true).query.attachment_id).toBe('INC1')
    expect(notificationLocation({ ...item, object_type: 'family_cases', stage: 'summary_review' }, true)).toEqual({ path: '/notifications/business/family', query: { summary_id: 'INC1', action: '/family/summaries/{summary_id}/review' } })
    expect(notificationLocation({ ...item, object_type: 'change_reviews' }, false).query).toEqual({ case_id: 'INC1', action: '/change-reviews/{case_id}', read: '1' })
    expect(notificationLocation({ ...item, object_type: 'elder_impressions' }, false)).toEqual({ path: '/elders/E1', query: { impression_id: 'INC1' } })
  })
  it('retains the same action key after retry and scopes it by notice revision and action', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('key-read').mockReturnValueOnce('key-accept').mockReturnValueOnce('key-new-revision') })
    const read = notificationActionKey(storage, session, item, 'read')
    expect(notificationActionKey(storage, session, item, 'read').key).toBe('key-read')
    expect(notificationActionKey(storage, session, item, 'accept').key).toBe('key-accept')
    clearNotificationAction(storage, read)
    expect(notificationActionKey(storage, session, item, 'accept').key).toBe('key-accept')
    expect(notificationActionKey(storage, session, { ...item, revision: 3 }, 'read').key).toBe('key-new-revision')
  })
})
