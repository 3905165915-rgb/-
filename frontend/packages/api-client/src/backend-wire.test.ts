import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createApi } from './index'
import {
  parseElder,
  parseTask,
  parseRecordDraft,
  parseTimelineEvent,
} from './validators'

beforeEach(() => {
  vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem() {} })
  vi.stubGlobal('localStorage', { removeItem() {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('backend 0.4.0 wire contract', () => {
  it('uses bed display labels without presenting internal bed IDs as labels', () => {
    const elder = {
      id: 'E1',
      name: '虚构老人',
      status: 'active',
      bed_id: 'internal-bed-id',
    }
    expect(parseElder(elder, '/elders').bedLabel).toBe('')
    expect(
      parseElder({ ...elder, bed_label: '101房·1床' }, '/elders').bedLabel,
    ).toBe('101房·1床')
    expect(() => parseElder({ ...elder, bed_label: 1 }, '/elders')).toThrow()
  })
  it('validates optional task context and supports bathing', () => {
    const task = {
      id: 'T1',
      elderId: 'E1',
      title: '询问沐浴意愿',
      status: 'pending',
      shift: '',
      assignee: '',
      dueAt: '',
      scene: 'bathing',
    }
    expect(parseTask(task, '/tasks').scene).toBe('bathing')
    for (const patch of [
      { nameSnapshot: 1 },
      { executionAt: 'yesterday' },
      { scene: 'unknown' },
    ])
      expect(() => parseTask({ ...task, ...patch }, '/tasks')).toThrow()
  })
  const draft = {
    id: 'AI-1',
    elder_id: 'E-1',
    raw_text: '午餐吃一半，请联系家属。',
    observations: ['午餐吃一半'],
    task_candidates: [
      {
        title: '联系家属',
        evidence_text: '请联系家属',
        condition: '人工确认后',
        due_at: null,
      },
    ],
    evidence: [{ text: '请联系家属', type: 'task_candidate' }],
    warnings: [],
    status: 'pending_review',
    provider: 'deepseek:deepseek-flash',
  }
  it('renders nullable server fields without using beds as elder identifiers', () => {
    expect(
      parseElder(
        {
          id: 'E-1',
          name: '虚构老人',
          bed_id: null,
          status: 'pending',
          notes: null,
        },
        '/elders',
      ),
    ).toMatchObject({ id: 'E-1', bedLabel: '', status: '待入住' })
    expect(
      parseTask(
        {
          id: 'T-1',
          elder_id: 'E-1',
          title: '联系家属',
          status: 'pending',
          due_at: null,
          assigned_to: null,
        },
        '/tasks',
      ),
    ).toMatchObject({ elderId: 'E-1', dueAt: '', assignee: '', itemId: 'T-1' })
    expect(() =>
      parseTask(
        { id: 'T-1', elder_id: 'E-1', title: '联系家属', status: 'unknown' },
        '/tasks',
      ),
    ).toThrow('未知枚举值')
  })
  it('retains provider, source quote and task conditions across human confirmation', async () => {
    const parsed = parseRecordDraft(draft, '/records/extract')
    expect(parsed.provider).toBe('deepseek:deepseek-flash')
    expect(parsed.evidence).toEqual(['请联系家属'])
    const api = createApi()
    api.client.defaults.adapter = async (config) => {
      expect(JSON.parse(config.data)).toEqual({
        observations: ['午餐吃一半'],
        task_candidates: draft.task_candidates,
      })
      return {
        data: { record: { id: 'R-1' }, tasks: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    await api.confirmRecord(parsed.id, parsed)
  })
  it('rejects malformed evidence instead of discarding source validation', () => {
    expect(() =>
      parseRecordDraft({ ...draft, evidence: [{}] }, '/records/extract'),
    ).toThrow('结构不匹配')
  })
  it('uses server handover and item IDs separately', async () => {
    const api = createApi()
    api.client.defaults.adapter = async (config) => {
      if (config.method === 'get') {
        expect(config.url).toBe('/handovers')
        expect(config.params).toEqual({ shift_id: 'shift/next' })
        return {
          data: [
            {
              id: 'HO/1',
              items: [
                {
                  id: 'HI/1',
                  source_id: 'T-1',
                  detail: '待联系家属',
                  kind: 'task',
                  status: 'pending',
                  received_at: null,
                  received_by: null,
                },
              ],
            },
          ],
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      expect(config.url).toBe('/handovers/HO%2F1/items/HI%2F1/receive')
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    }
    expect(await api.handover('shift/next')).toMatchObject([
      { id: 'HI/1', itemId: 'T-1', status: '待接收' },
    ])
    await api.receiveHandover('HI/1', { status: 'received' })
  })
  it('retains both actual and entry timestamps on timeline events', () => {
    expect(
      parseTimelineEvent(
        {
          id: 'EV-1',
          label: '记录',
          detail: '',
          actor: '护理员',
          happened_at: '2026-10-20T10:00:00+08:00',
          entered_at: '2026-10-20T10:20:00+08:00',
        },
        '/timeline',
      ),
    ).toMatchObject({
      happenedAt: '2026-10-20T10:00:00+08:00',
      enteredAt: '2026-10-20T10:20:00+08:00',
    })
  })
  it('accepts schema-9 audit events with no actual occurrence time', () => {
    expect(
      parseTimelineEvent(
        {
          id: 'EV-audit',
          label: '任务登记',
          detail: '',
          actor: '护理员',
          happened_at: null,
          recorded_at: '2026-10-27T08:00:00Z',
          recorded_at_status: 'verified',
        },
        '/timeline',
      ),
    ).toMatchObject({
      happenedAt: null,
      enteredAt: '2026-10-27T08:00:00Z',
      recordedAt: '2026-10-27T08:00:00Z',
    })
  })
  it('keeps an explicitly unverified registration time unknown instead of using occurrence time', () => {
    expect(
      parseTimelineEvent(
        {
          id: 'EV-unknown',
          label: '历史事件',
          detail: '',
          actor: '护理员',
          happened_at: '2026-10-27T07:00:00Z',
          recorded_at: null,
          recorded_at_status: 'unverified',
        },
        '/timeline',
      ),
    ).toMatchObject({
      happenedAt: '2026-10-27T07:00:00Z',
      recordedAt: null,
      enteredAt: null,
    })
  })
})
