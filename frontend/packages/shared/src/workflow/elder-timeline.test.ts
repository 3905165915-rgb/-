import { describe, expect, it, vi } from 'vitest'
import type { FrontendSession } from '../session'
import {
  createElderTimeline,
  groupTimelineEvents,
  type ElderTimelineFilter,
} from './elder-activity'

const session: FrontendSession = {
  mode: 'api',
  accountKey: 'synthetic',
  userId: 'U1',
  accessToken: 'synthetic-token',
  role: 'caregiver',
}
const filter: ElderTimelineFilter = {
  type: 'task',
  start: '2026-10-25',
  end: '2026-10-25',
}
const event = (id: string, sourceId: string) => ({
  id,
  source_id: sourceId,
  event_type: 'task',
  label: '任务完成',
  action: 'complete_task',
  detail: '虚构已完成人工任务',
  actor: '虚构护理员',
  happened_at: '2026-10-25T09:00:00+08:00',
  entered_at: '2026-10-25T09:01:00+08:00',
})
function page(
  elderId: string,
  offset: number,
  events: unknown[],
  total: number,
  hasMore: boolean,
) {
  return {
    elder_id: elderId,
    events,
    total,
    offset,
    limit: 100,
    has_more: hasMore,
    notice: '仅展示服务器授权事件。',
  }
}

describe('server elder timeline pagination', () => {
  it('groups by Asia/Shanghai registration date and keeps occurrence time separate', () => {
    const groups = groupTimelineEvents([
      {
        id: 'R1',
        recordedAt: '2026-10-26T16:30:00Z',
        happenedAt: '2026-10-20T09:00:00Z',
      },
      { id: 'R2', recordedAt: '2026-10-26T16:00:00Z', happenedAt: null },
      { id: 'R3', recordedAt: '2026-10-25T15:59:59Z' },
    ])
    expect(groups.map((group) => group.date)).toEqual([
      '2026-10-27',
      '2026-10-25',
    ])
    expect(groups[0].events.map((event) => event.id)).toEqual(['R1', 'R2'])
    expect(groups[0].events[0].happenedAt).toBe('2026-10-20T09:00:00Z')
  })

  it('uses recorded_at for event ordering and retains legacy entered_at as fallback', async () => {
    const request = vi.fn().mockResolvedValue(
      page(
        'E1',
        0,
        [
          {
            ...event('EV1', 'T1'),
            recorded_at: '2026-10-27T09:00:00+08:00',
            entered_at: '2026-10-01T09:00:00+08:00',
            happened_at: '2020-01-01T09:00:00+08:00',
          },
          {
            ...event('EV2', 'T2'),
            recorded_at: undefined,
            entered_at: '2026-10-26T09:00:00+08:00',
            happened_at: null,
          },
        ],
        2,
        false,
      ),
    )
    const timeline = createElderTimeline({ request, session: () => session })
    await timeline.load('E1', { type: '', start: '', end: '' })
    expect(timeline.state.value.items.map((item) => item.times)).toEqual([
      [
        {
          label: '登记',
          value: '2026-10-27T09:00:00+08:00',
          timestamp: Date.parse('2026-10-27T09:00:00+08:00'),
        },
        {
          label: '实际发生',
          value: '2020-01-01T09:00:00+08:00',
          timestamp: Date.parse('2020-01-01T09:00:00+08:00'),
        },
      ],
      [
        {
          label: '登记',
          value: '2026-10-26T09:00:00+08:00',
          timestamp: Date.parse('2026-10-26T09:00:00+08:00'),
        },
      ],
    ])
    expect(timeline.state.value.items[0].timestamp).toBe(
      Date.parse('2026-10-27T09:00:00+08:00'),
    )
  })

  it('keeps malformed legacy registration values visible for date verification', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        page(
          'E1',
          0,
          [
            {
              ...event('EV1', 'T1'),
              recorded_at: undefined,
              entered_at: 'unknown-date',
              happened_at: null,
            },
          ],
          1,
          false,
        ),
      )
    const timeline = createElderTimeline({ request, session: () => session })
    await timeline.load('E1', { type: '', start: '', end: '' })
    expect(timeline.state.value.status).toBe('ready')
    expect(timeline.state.value.items[0].times[0]).toMatchObject({
      label: '登记',
      value: 'unknown-date',
      timestamp: null,
    })
  })

  it('sends type and timezone-aware inclusive-day filters then appends a unique next page', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(page('E1', 0, [event('EV1', 'T1')], 2, true))
      .mockResolvedValueOnce(page('E1', 1, [event('EV2', 'T2')], 2, false))
    const timeline = createElderTimeline({ request, session: () => session })
    await timeline.load('E1', filter)
    expect(request.mock.calls[0][0]).toContain('/elders/E1/timeline?')
    const query = new URLSearchParams(request.mock.calls[0][0].split('?')[1])
    expect(query.getAll('event_type')).toEqual(['task'])
    expect(query.get('start')).toBe('2026-10-24T16:00:00.000Z')
    expect(query.get('end')).toBe('2026-10-25T16:00:00.000Z')
    expect(timeline.state.value).toMatchObject({
      status: 'ready',
      total: 2,
      hasMore: true,
      items: [{ key: 'EV1' }],
    })
    await timeline.loadMore()
    expect(timeline.state.value).toMatchObject({
      status: 'ready',
      total: 2,
      hasMore: false,
    })
    expect(timeline.state.value.items.map((item) => item.key)).toEqual([
      'EV1',
      'EV2',
    ])
  })

  it('rejects duplicate pages and mismatched elders without exposing response text', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(page('E1', 0, [event('EV1', 'T1')], 2, true))
      .mockResolvedValueOnce(page('E1', 1, [event('EV1', 'T1')], 2, false))
    const timeline = createElderTimeline({ request, session: () => session })
    await timeline.load('E1', { type: '', start: '', end: '' })
    await timeline.loadMore()
    expect(timeline.state.value.status).toBe('error')
    expect(JSON.stringify(timeline.state.value)).not.toContain('private')
    request.mockResolvedValueOnce(page('OTHER', 0, [], 0, false))
    await timeline.load('E1', { type: '', start: '', end: '' })
    expect(timeline.state.value.status).toBe('error')
  })

  it('discards old-elder responses after a scope switch and clears revoked access', async () => {
    let current = session as FrontendSession | null
    let resolveOld!: (value: unknown) => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce(page('E2', 0, [event('EV2', 'T2')], 1, false))
    const timeline = createElderTimeline({ request, session: () => current })
    const old = timeline.load('E1', { type: '', start: '', end: '' })
    await timeline.load('E2', { type: '', start: '', end: '' })
    resolveOld(page('E1', 0, [event('EV1', 'T1')], 1, false))
    await old
    expect(timeline.state.value.elderId).toBe('E2')
    current = null
    await timeline.load('E2', { type: '', start: '', end: '' })
    expect(timeline.state.value).toMatchObject({ status: 'denied', items: [] })
  })
  it('does not treat image analysis or drafts as formal record identifiers', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        page(
          'E1',
          0,
          [
            {
              ...event('EV1', 'AI1'),
              event_type: 'record',
              action: 'review_image_analysis',
            },
          ],
          1,
          false,
        ),
      )
    const timeline = createElderTimeline({ request, session: () => session })
    await timeline.load('E1', { type: '', start: '', end: '' })
    expect(timeline.state.value.items[0]).toMatchObject({
      detailAvailable: false,
    })
    expect(timeline.state.value.items[0].replayUrl).toBeUndefined()
  })
  it('clears loaded private content on a subsequent 403', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(page('E1', 0, [event('EV1', 'T1')], 2, true))
      .mockRejectedValueOnce({ status: 403 })
    const timeline = createElderTimeline({ request, session: () => session })
    await timeline.load('E1', { type: '', start: '', end: '' })
    await timeline.loadMore()
    expect(timeline.state.value).toMatchObject({ status: 'denied', items: [] })
  })
})
