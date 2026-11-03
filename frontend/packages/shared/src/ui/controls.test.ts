import { Fragment, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beijingNow, monthDays, validDate } from './calendar'
import { controlEvent, selectOptions } from './select-options'

afterEach(() => vi.useRealTimers())
describe('care controls', () => {
  it('retains numeric zero, disabled and nested option values', () => {
    const options = selectOptions([
      h('option', { value: '' }, '请选择'),
      h(Fragment, null, [h('option', { value: 0 }, '零分'), h('option', { value: 'N1', disabled: true }, '护士 · 已停用')]),
      h('option', null, '早班'),
    ])
    expect(options).toEqual([
      { value: '', label: '请选择', disabled: false },
      { value: 0, label: '零分', disabled: false },
      { value: 'N1', label: '护士 · 已停用', disabled: true },
      { value: '早班', label: '早班', disabled: false },
    ])
    expect((controlEvent(0, 'change').target as HTMLInputElement).value).toBe(0)
  })
  it('uses real leap days and Monday-first grids across year boundaries', () => {
    expect(validDate('2028-02-29')).toBe(true)
    expect(validDate('2026-02-29')).toBe(false)
    expect(validDate('2026-04-31')).toBe(false)
    const days = monthDays(2026, 1)
    expect(days).toHaveLength(42)
    expect(days[0].value).toBe('2025-12-29')
    expect(days[3]).toEqual({ value: '2026-01-01', day: 1, current: true })
  })
  it('takes the current business date from Beijing at the UTC date boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T18:05:06Z'))
    expect(beijingNow()).toBe('2026-11-04T02:05:06')
  })
})
