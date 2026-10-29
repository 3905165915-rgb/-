import { describe, expect, it } from 'vitest'
import { operations } from './model'
import { resultAction, incidentActions } from './result-actions'
import {
  filterNotifications,
  isUrgentNotification,
  notificationLocation,
  type ServerNotification,
} from './pending-work'

describe('direct business actions', () => {
  it('opens a coverage review with the exact date, elder and optimistic concurrency fingerprint', () => {
    expect(
      resultAction(
        'coverage',
        { occurrence_key: 'O1', fingerprint: 'FP1' },
        { elder_id: 'E1', service_date: '2026-10-28' },
      ),
    ).toEqual({
      path: '/insights/coverage/reviews',
      autoRead: false,
      context: {
        elder_id: 'E1',
        service_date: '2026-10-28',
        occurrence_key: 'O1',
        expected_fingerprint: 'FP1',
      },
    })
    expect(resultAction('coverage', {}, {})).toBeNull()
  })
  it('restricts reporting to caregivers and nurses and triage to management', () => {
    for (const role of [
      'admin',
      'supervisor',
      'caregiver',
      'nurse',
      'family',
    ]) {
      const allowed = operations.filter((op) =>
        op.roles.includes(role as never),
      )
      expect(
        allowed.some((op) => op.path === '/incidents' && op.method === 'post'),
      ).toBe(['caregiver', 'nurse'].includes(role))
      expect(
        incidentActions({ id: 'INCIDENT-1', status: 'reported' }, allowed)
          .length,
      ).toBe(['admin', 'supervisor'].includes(role) ? 1 : 0)
      expect(
        incidentActions({ id: 'INCIDENT-1', status: 'closed' }, allowed),
      ).toEqual([])
    }
  })
  it('keeps read emergencies prominent and links directly to their details', () => {
    const incident: ServerNotification = {
      id: 'N1',
      object_type: 'incidents',
      object_id: 'INCIDENT-1',
      status: 'pending',
      stage: 'triage',
      title: '紧急事件',
      revision: 1,
      read_at: '2026-10-28T12:00:00Z',
    }
    const task = { ...incident, id: 'N2', object_type: 'care_tasks' }
    expect(
      filterNotifications([task, incident], 'pending').map((row) => row.id),
    ).toEqual(['N1', 'N2'])
    expect(isUrgentNotification(incident)).toBe(true)
    expect(isUrgentNotification({ ...incident, status: 'closed' })).toBe(false)
    expect(notificationLocation(incident, false)).toMatchObject({
      path: '/workflows/incidents',
      query: { incident_id: 'INCIDENT-1', read: '1' },
    })
    expect(notificationLocation(incident, true).path).toBe('/safety')
  })
})
