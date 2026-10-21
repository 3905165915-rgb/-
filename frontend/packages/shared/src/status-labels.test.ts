import { describe, expect, it, vi } from 'vitest'
import {
  aiDraftStatuses,
  familyCaseStatuses,
  handoverStatuses,
  taskStatuses,
} from './statuses'
import {
  aiDraftStatusMeta,
  familyCaseStatusMeta,
  handoverDisplayStatusMeta,
  handoverStatusMeta,
  isKnownStatus,
  resolveStatus,
  taskStatusLabels,
  taskStatusMeta,
} from './status-labels'

describe('shared status dictionaries', () => {
  it.each([
    [taskStatuses, taskStatusMeta],
    [familyCaseStatuses, familyCaseStatusMeta],
    [aiDraftStatuses, aiDraftStatusMeta],
    [handoverStatuses, handoverStatusMeta],
  ])(
    'covers every declared enum with a label and semantic tone',
    (statuses, dictionary) => {
      expect(Object.keys(dictionary).sort()).toEqual([...statuses].sort())
      for (const status of statuses) {
        const meta = resolveStatus<string>(dictionary, status)
        expect(meta.label.trim()).not.toBe('')
        expect(['neutral', 'info', 'success', 'warning', 'danger']).toContain(
          meta.tone,
        )
        expect(meta.known).toBe(true)
      }
    },
  )

  it('uses the approved task and family wording', () => {
    expect(taskStatusMeta.cancelled.label).toBe('已取消')
    expect(
      Object.fromEntries(
        Object.entries(familyCaseStatusMeta).map(([key, meta]) => [
          key,
          meta.label,
        ]),
      ),
    ).toEqual({
      received: '已受理',
      verifying: '核实中',
      replied: '已回复',
      continuing: '持续跟进',
      closed: '已关闭',
    })
    expect(Object.keys(taskStatusLabels)).toEqual(Object.keys(taskStatusMeta))
    for (const status of taskStatuses)
      expect(taskStatusLabels[status]).toBe(taskStatusMeta[status].label)
  })

  it('keeps handover display values separate from lifecycle values', () => {
    expect(Object.keys(handoverDisplayStatusMeta)).toEqual([
      '待接收',
      '已接收',
      '需澄清',
    ])
    expect(isKnownStatus(handoverDisplayStatusMeta, 'received')).toBe(false)
    expect(isKnownStatus(handoverStatusMeta, '已接收')).toBe(false)
    expect(handoverStatusMeta.received.label).toBe('已接收')
  })

  it.each([
    'legacy_status',
    '',
    '__proto__',
    'constructor',
    'toString',
    null,
    undefined,
    1,
    {},
  ])('blocks unknown values without treating them as pending: %s', (value) => {
    const display = resolveStatus(taskStatusMeta, value)
    expect(display).toMatchObject({
      label: '状态待核实',
      tone: 'warning',
      known: false,
      writeBlocked: true,
    })
    expect(display.rawStatus).toBe(value)
    const write = vi.fn()
    if (isKnownStatus(taskStatusMeta, value)) write()
    expect(write).not.toHaveBeenCalled()
    if (typeof value === 'string')
      expect(taskStatusLabels[value]).toBe('状态待核实')
  })
})
