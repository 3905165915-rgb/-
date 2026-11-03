import { describe, expect, it } from 'vitest'
import { parseImpression } from './impressions'

function fixture() {
  return {
    id: 'IMP-test',
    elder_id: 'E1',
    created_at: '2026-10-24T01:00:00Z',
    review_due_at: '2026-11-23T01:00:00Z',
    model_status: 'available',
    source_current: true,
    review_due: false,
    new_record_count: 0,
    coverage: {
      record_count: 1,
      from: '2026-08-01T01:00:00Z',
      to: '2026-08-01T01:00:00Z',
      batch_count: 1,
      simulated_count: 1,
    },
    sources: [
      {
        source_id: 'R1',
        revision: 1,
        text: '模拟：喜欢午后听戏',
        happened_at: '2026-08-01T01:00:00Z',
        recorded_at: '2026-10-24T01:00:00Z',
        simulated: true,
      },
    ],
    points: [
      {
        id: 'point-1',
        category: 'preference',
        kind: 'observation',
        expressor: 'elder',
        text: '午后听戏',
        status: 'candidate',
        revision: 1,
        supporting_days: 1,
        supporting_records: 1,
        citations: [{ source_id: 'R1', quote: '喜欢午后听戏' }],
      },
    ],
  }
}
describe('老人印象服务边界', () => {
  it('保留模拟标识、发生与录入时间以及待核对性质', () => {
    const report = parseImpression(fixture(), 'E1')
    expect(report.sources[0].simulated).toBe(true)
    expect(report.sources[0].happened_at).not.toBe(
      report.sources[0].recorded_at,
    )
    expect(report.points[0].status).toBe('candidate')
  })
  it('不接受另一位老人、悬空来源或不在原文中的引文', () => {
    expect(() => parseImpression(fixture(), 'E2')).toThrow()
    const bad = fixture()
    bad.points[0].citations[0].source_id = 'R2'
    expect(() => parseImpression(bad, 'E1')).toThrow()
    bad.points[0].citations[0] = { source_id: 'R1', quote: '原文不存在的内容' }
    expect(() => parseImpression(bad, 'E1')).toThrow()
  })
  it('异常枚举、缺失有效期和计数不能进入页面', () => {
    const bad = fixture()
    bad.points[0].kind = 'confirmed_by_ai'
    expect(() => parseImpression(bad, 'E1')).toThrow()
    const unknownExpressor = fixture()
    unknownExpressor.points[0].expressor = 'model_guess'
    expect(() => parseImpression(unknownExpressor, 'E1')).toThrow()
    expect(() =>
      parseImpression({ ...fixture(), review_due_at: null }, 'E1'),
    ).toThrow()
    expect(() =>
      parseImpression({ ...fixture(), coverage: {} }, 'E1'),
    ).toThrow()
  })
})
