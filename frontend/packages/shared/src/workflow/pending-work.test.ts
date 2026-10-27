import { describe, expect, it, vi } from 'vitest'
import { createInitialDemoState } from '../demo'
import type { FrontendSession } from '../session'
import {
  clearNotificationAction,
  notificationActionKey,
  notificationLocation,
  notificationStages,
  validateNotifications,
  notificationCategory,
  filterNotifications,
  notificationWork,
  demoFollowups,
  followupTools,
  type ServerNotification,
} from './pending-work'

const session: FrontendSession = {
  mode: 'api',
  accountKey: 'notice-test',
  userId: 'U1',
  role: 'caregiver',
}
const item: ServerNotification = {
  id: 'N1',
  object_type: 'incidents',
  object_id: 'INC1',
  elder_id: 'E1',
  title: '安全事件待分级',
  stage: 'triage',
  status: 'pending',
  read_at: null,
  revision: 2,
  created_at: '2026-10-25T10:00:00Z',
}
describe('server notifications', () => {
  it('keeps transferred work pending and distinguishes not executed from completion', () => {
    const seed = createInitialDemoState()
    const task = seed.tasks[0]
    const rows = demoFollowups(
      {
        tasks: [
          { ...task, id: 'transfer', status: 'transferred' },
          { ...task, id: 'notdone', status: 'not_done' },
        ],
        handover: [],
      },
      true,
    )
    expect(rows.map((row) => row.category)).toEqual(['pending', 'processed'])
    expect(rows[0].detail).toContain('待接续')
    expect(rows[1].detail).toContain('未执行')
  })
  it('categorizes business stages without treating read or accepted receipts as completion', () => {
    expect(notificationCategory(item)).toBe('pending')
    expect(
      notificationCategory({
        ...item,
        read_at: '2026-10-25T10:01:00Z',
        status: 'accepted',
      }),
    ).toBe('pending')
    expect(
      notificationCategory({ ...item, stage: 'review', status: 'accepted' }),
    ).toBe('review')
    expect(notificationCategory({ ...item, stage: 'awaiting_review' })).toBe(
      'review',
    )
    expect(
      notificationCategory({ ...item, stage: 'review', status: 'closed' }),
    ).toBe('processed')
    const page = [
      item,
      {
        ...item,
        id: 'N2',
        object_type: 'care_memories',
        stage: 'memory_review',
      },
    ]
    expect(
      filterNotifications(page, 'review', 'care_memories').map((row) => row.id),
    ).toEqual(['N2'])
    expect(filterNotifications(page, 'pending', 'care_memories')).toEqual([])
    expect(page).toHaveLength(2)
  })
  it('opens only existing authorized business forms without copying notification revisions', () => {
    expect(notificationWork(item, 'supervisor')).toMatchObject({
      group: 'incidents',
      action: '/incidents/{incident_id}/triage',
      context: { incident_id: 'INC1' },
      autoRead: false,
    })
    expect(notificationWork(item, 'caregiver')).toBeNull()
    expect(
      notificationWork({ ...item, stage: 'review' }, 'supervisor'),
    ).toMatchObject({ action: '/incidents/{incident_id}', autoRead: true })
    const review = { ...item, stage: 'review', rectification_id: 'RECT1' }
    expect(notificationWork(review, 'supervisor')).toMatchObject({
      action: '/rectifications/{rectification_id}/review',
      context: { incident_id: 'INC1', rectification_id: 'RECT1' },
    })
    expect(notificationWork(review, 'caregiver')).toBeNull()
    const change = { ...item, object_type: 'change_reviews', stage: 'review' }
    const work = notificationWork(change, 'supervisor')!
    expect(work.action).toBe('/change-reviews/{case_id}/review')
    expect(work.context).not.toHaveProperty('expected_revision')
    expect(notificationWork(change, 'caregiver')).toBeNull()
    expect(
      notificationWork({ ...item, status: 'closed' }, 'supervisor'),
    ).toBeNull()
    expect(
      notificationWork({ ...item, object_type: 'unknown' }, 'supervisor'),
    ).toBeNull()
  })
  it('keeps handover item and parent identifiers separate', () => {
    const notice = {
      ...item,
      object_type: 'handover_items',
      object_id: 'ITEM1',
      stage: 'receive',
    }
    expect(notificationWork(notice, 'caregiver')).toBeNull()
    expect(
      notificationWork({ ...notice, handover_id: 'HANDOVER1' }, 'caregiver'),
    ).toMatchObject({
      action: '/handovers/{handover_id}/items/{item_id}/receive',
      context: { handover_id: 'HANDOVER1', item_id: 'ITEM1' },
    })
  })
  it('exposes legacy followup tools through their original paths', () => {
    expect(followupTools.map((tool) => tool.path)).toEqual([
      '/quality',
      '/coverage',
      '/changes',
      '/workflows/incidents',
      '/timeline',
    ])
  })
  it('derives demo categories and links from real local review status without synthesizing notifications', () => {
    const state = {
      tasks: [],
      handover: [],
      memoryReviews: [
        {
          id: 'pending',
          elderId: 'E1',
          status: 'pending' as const,
          description: '待核验',
        },
        {
          id: 'review',
          elderId: 'E2',
          status: 'awaiting_review' as const,
          description: '需独立复查',
        },
        {
          id: 'closed',
          elderId: 'E3',
          status: 'closed' as const,
          description: '已处理',
        },
      ],
    }
    for (const mobile of [true, false]) {
      const rows = demoFollowups(state, mobile)
      expect(rows.map((row) => row.category)).toEqual([
        'pending',
        'review',
        'processed',
      ])
      expect(rows[1]?.location).toEqual({
        path: '/elders/E2',
        query: { review: 'review' },
      })
      expect(rows[1]).not.toHaveProperty('read_at')
      expect(rows[1]).not.toHaveProperty('revision')
    }
    expect(demoFollowups({ tasks: [], handover: [] }, true)).toEqual([])
  })
  it('validates paginated server envelopes and rejects malformed or duplicate notifications', () => {
    const value = {
      items: [item],
      total: 1,
      offset: 0,
      limit: 100,
      as_of: '2026-10-25T10:01:00Z',
      definition: '服务器状态',
    }
    expect(validateNotifications(value).items).toEqual([item])
    expect(() =>
      validateNotifications({ ...value, items: [{ ...item, revision: 0 }] }),
    ).toThrow('必要字段')
    expect(() =>
      validateNotifications({ ...value, total: 2, items: [item, item] }),
    ).toThrow('必要字段')
    expect(() => validateNotifications({ ...value, total: -1 })).toThrow(
      '字段不完整',
    )
    expect(
      validateNotifications({ ...value, items: [], total: 0, offset: 100 })
        .items,
    ).toEqual([])
  })
  it('routes each notice to its underlying business object and maps known stages to Chinese', () => {
    expect(notificationLocation(item, true)).toEqual({
      path: '/safety',
      query: {
        incident_id: 'INC1',
        action: '/incidents/{incident_id}',
        read: '1',
      },
    })
    expect(notificationLocation(item, false).path).toBe('/workflows/incidents')
    expect(notificationStages.triage).toBe('安全事件分级')
    expect(
      notificationLocation({ ...item, object_type: 'unknown' }, true).path,
    ).toBe('/notifications')
    expect(
      notificationLocation({ ...item, object_type: 'image_analyses' }, false),
    ).toEqual({
      path: '/workflows/records',
      query: {
        elder: 'E1',
        elder_id: 'E1',
        analysis_id: 'INC1',
        action: '/records/manual',
      },
    })
    expect(
      notificationLocation({ ...item, object_type: 'attachments' }, true).query
        .attachment_id,
    ).toBe('INC1')
    expect(
      notificationLocation(
        { ...item, object_type: 'family_cases', stage: 'summary_review' },
        true,
      ),
    ).toEqual({
      path: '/notifications/business/family',
      query: {
        summary_id: 'INC1',
        action: '/family/summaries/{summary_id}/review',
      },
    })
    expect(
      notificationLocation({ ...item, object_type: 'change_reviews' }, false)
        .query,
    ).toEqual({
      case_id: 'INC1',
      action: '/change-reviews/{case_id}',
      read: '1',
    })
    expect(
      notificationLocation(
        { ...item, object_type: 'elder_impressions' },
        false,
      ),
    ).toEqual({ path: '/elders/E1', query: { impression_id: 'INC1' } })
  })
  it('retains the same action key after retry and scopes it by notice revision and action', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
    vi.stubGlobal('crypto', {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce('key-read')
        .mockReturnValueOnce('key-accept')
        .mockReturnValueOnce('key-new-revision'),
    })
    const read = notificationActionKey(storage, session, item, 'read')
    expect(notificationActionKey(storage, session, item, 'read').key).toBe(
      'key-read',
    )
    expect(notificationActionKey(storage, session, item, 'accept').key).toBe(
      'key-accept',
    )
    clearNotificationAction(storage, read)
    expect(notificationActionKey(storage, session, item, 'accept').key).toBe(
      'key-accept',
    )
    expect(
      notificationActionKey(storage, session, { ...item, revision: 3 }, 'read')
        .key,
    ).toBe('key-new-revision')
  })
})
