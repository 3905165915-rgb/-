import { describe, expect, it } from 'vitest'
import { itemTimelineGroups, itemTimelinePage, itemTimelineSubjectPath, itemTimelineSubjectTitle } from './item-timeline'
describe('item process replay', () => {
  it('shows the authorized subject description ahead of its technical identifier', () => {
    expect(itemTimelineSubjectPath('INCIDENT-synthetic')).toBe('/incidents/INCIDENT-synthetic')
    expect(itemTimelineSubjectTitle({ id: 'INCIDENT-synthetic', display_label: '合成事件：活动中失去平衡' }, 'INCIDENT-synthetic')).toBe('合成事件：活动中失去平衡')
    expect(itemTimelineSubjectPath('unknown-synthetic')).toBeNull()
  })
  it('keeps undated nodes in a separate group and uses Beijing registration dates', () => {
    const items = [{ id: '1', label: '登记记录', recorded_at: '2026-10-28T16:05:00Z', happened_at: '2026-10-01T00:00:00Z' }, { id: '2', label: '历史处理', recorded_at: null, recorded_state: 'reported' }]
    const page = itemTimelinePage({ items, total: 2, offset: 0, limit: 50, has_more: false, unverified_total: 1, timezone: 'Asia/Shanghai' }, 0, 50)
    const groups = itemTimelineGroups(page.items)
    expect(groups.map(group => group.date)).toEqual(['2026-10-29', '登记日期待核实'])
    expect(groups[1].events[0].recorded_state).toBe('reported')
    expect(groups[0].events[0].happened_at).toBe('2026-10-01T00:00:00Z')
  })
})
