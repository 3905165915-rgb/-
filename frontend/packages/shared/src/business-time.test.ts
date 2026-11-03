import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessDay, formatBusinessTime, isBusinessToday } from './business-time'
afterEach(() => vi.useRealTimers())
describe('北京时间', () => {
  it('UTC与北京时间等价，详情保留完整年月日', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-27T06:00:00Z'))
    expect(formatBusinessTime('2026-10-27T07:00:00Z')).toBe('今天15:00')
    expect(formatBusinessTime('2026-10-27T15:00:00+08:00')).toBe('今天15:00')
    expect(formatBusinessTime('2026-10-27T07:00:00Z', true)).toBe('2026年10月27日 15:00')
    expect(formatBusinessTime('2026-10-28T07:00:00Z')).toBe('10月28日15:00')
  })
  it('跨零点归入北京日期，无时区和坏数据不猜测', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-27T16:10:00Z'))
    expect(businessDay()).toBe('2026-10-28')
    expect(isBusinessToday('2026-10-27T16:00:00Z')).toBe(true)
    expect(isBusinessToday('2026-10-27T15:59:00Z')).toBe(false)
    for (const value of ['', '坏数据', '2026-10-28T15:00:00', '2026-02-30T15:00:00+08:00', '2026-10-28T24:00:00Z', '2026-10-28T15:61:00Z', '2026-10-28T15:00:00+08:90']) {
      expect(formatBusinessTime(value)).toBe('时间待核实')
      expect(isBusinessToday(value)).toBe(false)
    }
  })
})
