import { describe, expect, it } from 'vitest'
import {
  inboxContext,
  inboxForm,
  inboxLocation,
  inboxRelatedLocations,
  type InboxRow,
} from './work-inbox'
import { elderWorkspaceSnapshot, elderWorkGroups } from './elder-workspace-read'

const base: InboxRow = {
  id: 'OBJECT-SYNTHETIC',
  object_id: 'OBJECT-SYNTHETIC',
  object_type: 'care_records',
  title: '虚构事项',
  queue: 'mine',
  notification_ids: [],
  unread: false,
  elder_id: 'ELDER-SYNTHETIC',
}
describe('business workspace handoffs', () => {
  it('keeps a quality report and its individual issue together in the inline form', () => {
    const issue = {
      ...base,
      object_type: 'quality_checks',
      group: 'quality',
      action_path: '/quality/checks/{report_id}/issues/{issue_id}/resolve',
      context: { report_id: 'REPORT-SYNTHETIC' },
    }
    expect(inboxContext(issue)).toMatchObject({
      report_id: 'REPORT-SYNTHETIC',
      issue_id: 'OBJECT-SYNTHETIC',
    })
    expect(inboxForm(issue, 'supervisor')).toMatchObject({
      group: 'quality',
      context: { report_id: 'REPORT-SYNTHETIC', issue_id: 'OBJECT-SYNTHETIC' },
    })
    expect(
      inboxLocation({ ...issue, queue: 'processed' }, false),
    ).toMatchObject({
      path: '/quality',
      query: { report_id: 'REPORT-SYNTHETIC', issue_id: 'OBJECT-SYNTHETIC' },
    })
    expect(inboxLocation({ ...issue, queue: 'processed' }, true).path).toBe(
      '/timeline/REPORT-SYNTHETIC',
    )
  })
  it('opens the dedicated elder section instead of a generic elder GET form', () => {
    const assessment = {
      ...base,
      object_type: 'assessments',
      group: 'elder',
      context: { section: 'assessment', decision_kind: 'assessment' },
      workflow: {
        primary_action: { path: '/elders/ELDER-SYNTHETIC', method: 'GET' },
      },
    }
    expect(inboxForm(assessment, 'supervisor')).toBeNull()
    expect(inboxLocation(assessment, false)).toMatchObject({
      path: '/elders/ELDER-SYNTHETIC',
      query: { section: 'assessment', source: 'OBJECT-SYNTHETIC' },
    })
  })
  it('retains each child decision in a grouped impression row', () => {
    const impression = {
      ...base,
      object_type: 'elder_impressions',
      group: 'elder',
      reasons: ['虚构观察一', '虚构观察二'],
      related_contexts: [
        {
          original_object_id: 'OBJECT-SYNTHETIC:POINT-1',
          section: 'understanding',
        },
        {
          original_object_id: 'OBJECT-SYNTHETIC:POINT-2',
          section: 'understanding',
        },
      ],
    }
    const links = inboxRelatedLocations(impression, true)
    expect(links.map((item) => item.location.query.point_id)).toEqual([
      'POINT-1',
      'POINT-2',
    ])
    expect(links.map((item) => item.label)).toEqual([
      '虚构观察一',
      '虚构观察二',
    ])
  })
  it('takes a family summary directly to its dedicated page and selected draft', () => {
    const summary = {
      ...base,
      object_type: 'family_cases',
      business_stage: 'summary_review',
    }
    expect(inboxForm(summary, 'supervisor')).toBeNull()
    expect(inboxLocation(summary, false)).toEqual({
      path: '/family',
      query: { elder: 'ELDER-SYNTHETIC', summary_id: 'OBJECT-SYNTHETIC' },
    })
  })
})

describe('elder workspace snapshot and task windows', () => {
  it('reads a single snapshot for the active stay and retains its recent record total', () => {
    const snapshot = elderWorkspaceSnapshot(
      {
        elder: {
          id: 'ELDER-SYNTHETIC',
          current_admission_id: 'STAY-SYNTHETIC',
        },
        current_admission: { id: 'STAY-SYNTHETIC', status: 'active' },
        current_care_available: true,
        tasks: [],
        recent_records: [
          {
            id: 'RECORD-SYNTHETIC',
            elder_id: 'ELDER-SYNTHETIC',
            admission_id: 'STAY-SYNTHETIC',
          },
        ],
        record_total: 12,
      },
      'ELDER-SYNTHETIC',
    )
    expect(snapshot.record_total).toBe(12)
    expect(snapshot.recent_records).toHaveLength(1)
  })
  it('keeps the no-admission state explicit with no current work or records', () => {
    const snapshot = elderWorkspaceSnapshot(
      {
        elder: { id: 'ELDER-SYNTHETIC', current_admission_id: null },
        current_admission: null,
        current_care_available: false,
        tasks: [],
        recent_records: [],
        record_total: 0,
        context_notice: '暂无有效入住',
      },
      'ELDER-SYNTHETIC',
    )
    expect(snapshot.current_care_available).toBe(false)
    expect(snapshot.context_notice).toBe('暂无有效入住')
  })
  it('keeps overdue prior-shift tasks first and future obligations reachable in their own group', () => {
    const task = {
      elder_id: 'ELDER-SYNTHETIC',
      title: '虚构跟进事项',
      status: 'pending',
    }
    const groups = elderWorkGroups(
      [
        { ...task, id: 'TODAY', due_at: '2026-11-03T10:00:00+08:00' },
        {
          ...task,
          id: 'PREVIOUS',
          status: 'overdue',
          due_at: '2026-11-02T10:00:00+08:00',
        },
        { ...task, id: 'FUTURE', due_at: '2026-11-04T10:00:00+08:00' },
      ],
      '2026-11-03T00:00:00+08:00',
    )
    expect(groups.priority.map((item) => item.id)).toEqual([
      'PREVIOUS',
      'TODAY',
    ])
    expect(groups.other.map((item) => item.id)).toEqual(['FUTURE'])
  })
})
