import { describe, expect, it } from 'vitest'
import { effectiveAssessment } from './assessment-current'
describe('有效评估', () => {
  it('跳过更新的草稿和失效评估，选择服务确认有效的结果', () => {
    const current = {id:'current', status:'confirmed', current:{effective:true}}
    expect(effectiveAssessment([{status:'pending_observation',total_score:90}, {status:'confirmed',current:{effective:false}},current])).toBe(current)
  })
  it('缺少有效标记不能被推算为有效', () => {
    expect(effectiveAssessment([{status:'confirmed',total_score:99}])).toBeNull()
  })
})
