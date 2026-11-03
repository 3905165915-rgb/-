import { describe, expect, it } from 'vitest'
import { createInitialDemoState } from './demo'
import type { DemoStateV2 } from './demo-store'
import type { FrontendSession } from './session'
import { decideMemory, handleMemoryReview } from './demo-memory-actions'
const actor: FrontendSession = { mode: 'demo', accountKey: 'supervisor', role: 'supervisor' }
function snapshot() { return { ...createInitialDemoState(), timeline: [], epoch: 'epoch' } as unknown as DemoStateV2 }
describe('逐条记忆核对与独立复查', () => {
  it('确认临时意愿保留有效期、原文与历史，不更改稳定偏好', () => {
    const state = snapshot(), before = structuredClone(state.memories[1])
    const candidate = state.memories.find(m => m.kind === 'temporary')!
    decideMemory(state, candidate.id, 1, 'confirm', '本次先休息，活动前再询问', actor)
    expect(candidate).toMatchObject({ kind: 'temporary', status: 'confirmed', revision: 2, confirmedBy: 'supervisor' })
    expect(candidate.expiresAt).toBeTruthy(); expect(candidate.history).toHaveLength(2)
    expect(state.memories[1]).toEqual(before)
  })
  it('不接受过期候选、来源断裂或旧版本', () => {
    const state = snapshot(), candidate = state.memories[3]
    expect(() => decideMemory(state, candidate.id, 0, 'confirm', '内容', actor)).toThrow('已变化')
    candidate.expiresAt = '2000-01-01T00:00:00Z'
    expect(() => decideMemory(state, candidate.id, 1, 'confirm', '内容', actor)).toThrow('过期')
    state.memories[4].sourceRecordIds = ['missing']
    expect(() => decideMemory(state, state.memories[4].id, 1, 'confirm', '内容', actor)).toThrow('依据')
  })
  it('逐条暂不采用不删除原文', () => {
    const state = snapshot(), count = state.records.length
    decideMemory(state, state.memories[4].id, 1, 'reject', '暂不采用此项', actor)
    expect(state.memories[4].status).toBe('rejected'); expect(state.records.length).toBe(count)
  })
  it.each(['family', 'caregiver'] as const)('角色%s不能代替主管确认', role => {
    const state = snapshot()
    expect(() => decideMemory(state, state.memories[4].id, 1, 'confirm', '内容', { ...actor, role })).toThrow('护理主管')
  })
  it('提交与复查分开，由另一位负责人通过并保留事项回放', () => {
    const state = snapshot(), review = state.memoryReviews[0]
    handleMemoryReview(state, review.id, 1, 'submit', '已询问，仅本次想休息', actor)
    expect(review.status).toBe('awaiting_review')
    expect(() => handleMemoryReview(state, review.id, 2, 'approve', '自行复查', actor)).toThrow('另一位')
    handleMemoryReview(state, review.id, 2, 'approve', '已独立复核，保留长期偏好', { ...actor, accountKey: 'admin', role: 'admin' })
    expect(review).toMatchObject({ status: 'closed', revision: 3, reviewedBy: 'admin' })
    expect(state.timeline.map(e => e.itemId)).toEqual([review.itemId, review.itemId])
  })
})
