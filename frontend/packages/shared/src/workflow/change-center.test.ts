import { describe, expect, it } from 'vitest'
import {
  changeReason,
  changeStatus,
  nextChangeAction,
  recentChangeTitle,
} from './change-center'

describe('simple care change centre', () => {
  it('offers only the next permitted operation', () => {
    expect(nextChangeAction({ status: 'pending' }, 'me', false)).toBeNull()
    expect(nextChangeAction({ status: 'pending' }, 'me', true)?.label).toBe(
      '安排核对',
    )
    expect(
      nextChangeAction({ status: 'assigned', assigned_to: 'me' }, 'me', false)
        ?.label,
    ).toBe('填写处理结果')
    expect(
      nextChangeAction(
        { status: 'assigned', assigned_to: 'other' },
        'me',
        false,
      ),
    ).toBeNull()
    expect(nextChangeAction({ status: 'closed' }, 'me', true)).toBeNull()
  })
  it('retains independent review and rejects self-review in the UI', () => {
    const row = {
      status: 'awaiting_review',
      submissions: [{ submitted_by: 'me' }],
    }
    expect(nextChangeAction(row, 'me', true)).toBeNull()
    expect(nextChangeAction(row, 'other', true)?.label).toBe('复查处理结果')
  })
  it('explains changes without exposing internal enums or identifiers', () => {
    expect(changeStatus('awaiting_review')).toBe('待复查')
    expect(changeStatus('unknown')).toBe('待核实')
    expect(
      changeReason({
        current: {
          reference: { current: { reasons: ['memory_source_changed'] } },
        },
      }),
    ).toContain('原始记录已更正')
    expect(
      recentChangeTitle({ action: 'internal_unknown', id: 'CR-secret' }),
    ).toBe('照护资料有更新')
  })
})
