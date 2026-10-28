import { describe, expect, it } from 'vitest'
import {
  incomingShiftOptions,
  selectHandoverShifts,
  sourceShiftOptions,
} from './handover-shifts'

const shifts = [
  {
    id: 'distant',
    status: 'open',
    start_at: '2026-12-29T08:00:00+08:00',
    end_at: '2026-12-29T16:00:00+08:00',
    caregiver_ids: ['care'],
  },
  {
    id: 'next',
    status: 'open',
    start_at: '2026-10-28T16:00:00+08:00',
    end_at: '2026-10-29T00:00:00+08:00',
    caregiver_ids: ['other'],
  },
  {
    id: 'current',
    status: 'open',
    start_at: '2026-10-28T08:00:00+08:00',
    end_at: '2026-10-28T16:00:00+08:00',
    caregiver_ids: ['care'],
  },
  {
    id: 'previous',
    status: 'open',
    start_at: '2026-10-28T00:00:00+08:00',
    end_at: '2026-10-28T08:00:00+08:00',
    caregiver_ids: ['care'],
  },
]
const at = Date.parse('2026-10-28T12:00:00+08:00')
const choose = (source = '', target = '') =>
  selectHandoverShifts(shifts, 'care', 'caregiver', source, target, at)

describe('交班班次选择', () => {
  it('降序接口优先当前班和紧接下一班，不选择遥远未来', () => {
    expect(choose()).toEqual({ sourceId: 'current', targetId: 'next' })
  })
  it('恢复错误的远期班次草稿，保留文字时可修正为当前班次', () => {
    expect(choose('distant', 'current')).toEqual({
      sourceId: 'current',
      targetId: 'next',
    })
  })
  it('保留合法的历史补交班草稿', () => {
    expect(choose('previous', 'current')).toEqual({
      sourceId: 'previous',
      targetId: 'current',
    })
  })
  it('修复接班早于交出班次和已删除班次', () => {
    expect(choose('current', 'previous').targetId).toBe('next')
    expect(choose('deleted', 'deleted')).toEqual({
      sourceId: 'current',
      targetId: 'next',
    })
  })
  it('护理员仅选本人交出班次，允许交给其他护理员的下一班', () => {
    expect(
      sourceShiftOptions(shifts, 'care', 'caregiver').map((row) => row.id),
    ).not.toContain('next')
    expect(incomingShiftOptions(shifts, 'current')[0].id).toBe('next')
  })
  it('主管可选择负责交出的班次，无班次时返回空值而非无效编号', () => {
    expect(sourceShiftOptions(shifts, 'manager', 'supervisor')).toHaveLength(4)
    expect(selectHandoverShifts([], 'care', 'caregiver')).toEqual({
      sourceId: '',
      targetId: '',
    })
  })
  it('过期时选择最近未交班，尚未开始时选最早一班', () => {
    expect(
      selectHandoverShifts(
        shifts,
        'care',
        'caregiver',
        '',
        '',
        Date.parse('2026-10-29T00:00:00Z'),
      ).sourceId,
    ).toBe('current')
    expect(
      selectHandoverShifts(
        shifts,
        'care',
        'caregiver',
        '',
        '',
        Date.parse('2026-10-27T00:00:00Z'),
      ).sourceId,
    ).toBe('previous')
  })
  it('关闭或非法时间的班次不可被选择', () => {
    const rows = shifts.map((row) =>
      row.id === 'current' ? { ...row, status: 'closed' } : row,
    )
    expect(
      selectHandoverShifts(rows, 'care', 'caregiver', 'current', '', at)
        .sourceId,
    ).toBe('previous')
    expect(
      sourceShiftOptions(
        [{ ...shifts[0], start_at: 'invalid' }],
        'care',
        'caregiver',
      ),
    ).toEqual([])
  })
})
