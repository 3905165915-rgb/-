import { describe, expect, it } from 'vitest'
import { date, localTime } from './workspace-time'

describe('immediate care feedback timestamps', () => {
  it('keeps feedback after task creation within the same minute and second', () => {
    const created = new Date('2026-10-26T15:59:42.700Z')
    const observed = new Date('2026-10-26T15:59:42.950Z')
    expect(date(localTime(observed))).toBe(observed.toISOString())
    expect(new Date(date(localTime(observed))).valueOf()).toBeGreaterThan(created.valueOf())
  })

  it('uses Beijing dates across midnight and accepts minute precision entered by staff', () => {
    expect(localTime(new Date('2026-10-26T16:00:01.123Z'))).toBe('2026-10-27T00:00:01.123')
    expect(date('2026-10-27T00:01')).toBe('2026-10-26T16:01:00.000Z')
    expect(() => date('')).toThrow('北京时间')
    expect(() => date('2026-10-27T00:01Z')).toThrow('北京时间')
  })
})
