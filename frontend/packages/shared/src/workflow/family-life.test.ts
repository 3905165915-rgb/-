import { describe, expect, it } from 'vitest'
import { dailySaying, familyDate, familyDay, familyFeed, familyInsight, familyMembers, familyMessages, type FamilyMember } from './family-life'

const at = '2026-10-26T09:00:00+08:00'
const member: FamilyMember = { id: 'binding-a', elder_id: 'elder-a', elder_name: '张阿姨', admission_id: 'stay-a', scopes: ['summary', 'feedback'], expires_at: '2027-01-01T00:00:00+08:00' }
function feed() { return { elder_id: member.elder_id, elder_name: member.elder_name, total: 1, items: [{ id: 'story-a', elder_id: member.elder_id, happened_at: at, period_start: '2026-10-26T08:00:00+08:00', period_end: at, published_at: at, title: '照护近况', text: '午后选择听戏曲。', kind: 'published_summary', photos: [{ id: 'photo-a', caption: '活动照片', occurred_at: at, content_path: '/family/me/bindings/binding-a/photos/photo-a/content' }] }] } }

describe('family living feed contracts', () => {
  it('accepts server-marked demo choices without fabricating an admission', () => {
    const demo = { ...member, demo_access: true, admission_id: null }
    expect(familyMembers([demo])).toEqual([demo])
    expect(() => familyMembers([{ ...member, admission_id: null }])).toThrow()
    expect(() => familyMembers([{ ...demo, demo_access: 'true' }])).toThrow()
  })
  it('accepts published stories and scoped photos without internal records', () => {
    expect(familyMembers([member])).toEqual([member])
    const value = familyFeed(feed(), member)
    expect(value.items).toHaveLength(1)
    expect(value.items[0]).not.toHaveProperty('evidence')
  })
  it.each([
    (row: ReturnType<typeof feed>) => { row.elder_id = 'other' },
    (row: ReturnType<typeof feed>) => { row.items[0]!.elder_id = 'other' },
    (row: ReturnType<typeof feed>) => { row.items[0]!.period_start = at },
    (row: ReturnType<typeof feed>) => { row.items[0]!.published_at = '2026-10-26' },
    (row: ReturnType<typeof feed>) => { row.items[0]!.photos[0]!.content_path = 'https://untrusted.invalid/photo' },
    (row: ReturnType<typeof feed>) => { row.items[0]!.photos[0]!.content_path = '/family/me/bindings/other/photos/photo-a/content' },
    (row: ReturnType<typeof feed>) => { row.items.push(row.items[0]!); row.total = 2 },
  ])('rejects wrong ownership, dates, duplicate stories and arbitrary photo links', change => {
    const row = feed(); change(row)
    expect(() => familyFeed(row, member)).toThrow('核对')
  })
  it('rejects unsupported citations while preserving readable stories', () => {
    const current = familyFeed(feed(), member)
    const valid = { elder_id: member.elder_id, model_status: 'available', points: [{ text: '选择听戏曲', citations: [{ source_id: 'story-a', quote: '选择听戏曲' }] }] }
    expect(familyInsight(valid, current).points).toHaveLength(1)
    expect(() => familyInsight({ ...valid, elder_id: 'other' }, current)).toThrow()
    valid.points[0]!.citations[0]!.quote = '未发生的活动'
    expect(() => familyInsight(valid, current)).toThrow()
    expect(current.items).toHaveLength(1)
  })
  it('requires binding and elder identity on every message', () => {
    const row = { id: 'message-a', binding_id: member.id, elder_id: member.elder_id, text: '下次带相册来', status: 'open', created_at: at, reply: null, replied_at: null }
    expect(familyMessages([row], member)).toHaveLength(1)
    expect(() => familyMessages([{ ...row, binding_id: 'other' }], member)).toThrow()
    expect(() => familyMessages([{ ...row, elder_id: 'other' }], member)).toThrow()
  })
  it('uses Shanghai day boundaries for sayings and labels', () => {
    const before = new Date('2026-10-26T15:59:59Z'), after = new Date('2026-10-26T16:00:00Z')
    expect(familyDay(before)).toBe('2026-10-26')
    expect(familyDay(after)).toBe('2026-10-27')
    expect(dailySaying(before)).not.toBe(dailySaying(after))
    expect(dailySaying(after)).toBe(dailySaying(new Date('2026-10-27T02:00:00Z')))
    expect(familyDate(after, true)).toContain('10月27日')
  })
})
