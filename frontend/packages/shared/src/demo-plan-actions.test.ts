import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDemoState } from './demo'
import type { DemoStateV2 } from './demo-store'
import type { FrontendSession } from './session'
import { applyDemoPlanConfirmation, confirmDemoPlan, DemoPlanStateChanged, type DemoPlanConfirmation } from './demo-plan-actions'

const port = vi.hoisted(() => ({ state: null as DemoStateV2 | null, actor: null as FrontendSession | null, beforeWrite: null as (() => void) | null }))
vi.mock('./session', () => ({ readSession: () => port.actor }))
vi.mock('./demo-store', () => ({
  loadDemoState: async () => structuredClone(port.state),
  updateDemoState: async (epoch: string, mutate: (state: DemoStateV2) => void) => {
    port.beforeWrite?.()
    const state = structuredClone(port.state!)
    if (state.epoch !== epoch) throw new Error('演示数据已重置')
    mutate(state)
    state.revision++
    port.state = state
    return state
  },
}))
function state(): DemoStateV2 {
  const seed = createInitialDemoState()
  return { ...seed, schemaVersion: 3, epoch: 'epoch-1', revision: 4, tasks: seed.tasks.map(task => ({ ...task, itemId: task.itemId || 'seed-item' })), timeline: [], handover: [], handoverVersions: [], confirmedDrafts: {}, appliedOperations: [] }
}
const actor: FrontendSession = { mode: 'demo', accountKey: 'demo-manager', userId: 'manager-1', role: 'supervisor' }
function input(): DemoPlanConfirmation {
  const seed = createInitialDemoState()
  return { epoch: 'epoch-1', expectedRevision: 4, operationKey: 'operation-1', elderId: seed.elders[0].id, assessmentId: seed.assessments[0].id, items: seed.plans[0].items.map(item => ({ ...item, title: '询问明日活动意愿' })), humanConfirmed: true }
}
beforeEach(() => { port.state = state(); port.actor = actor; port.beforeWrite = null })

describe('demo care plan confirmation', () => {
  it('rejects duplicate occurrences even with a different request key', async () => {
    const duplicate = input()
    duplicate.items = createInitialDemoState().plans[0].items
    await expect(confirmDemoPlan(duplicate)).rejects.toThrow('避免重复派发')
    expect(port.state!.plans).toHaveLength(1)
  })
  it('commits an active plan and pending tasks with an explicit plan/item relation', async () => {
    const before = port.state!.tasks.length
    const result = await confirmDemoPlan(input())
    expect(result.plan).toMatchObject({ status: 'active', confirmedBy: 'manager-1', assessmentId: input().assessmentId })
    expect(port.state!.tasks).toHaveLength(before + input().items.length)
    expect(port.state!.revision).toBe(5)
    expect(port.state!.tasks.at(-1)).toMatchObject({ status: 'pending', source: 'plan', itemId: `${result.plan.id}:item:1`, executionAt: result.plan.items[0].executionAt, deadlineAt: result.plan.items[0].deadlineAt })
  })
  it('replays the same request after intervening revisions without duplicating tasks or resetting completion', async () => {
    const first = await confirmDemoPlan(input())
    const count = port.state!.tasks.length
    port.state!.revision += 3
    port.state!.tasks.find(task => task.id === first.taskIds[0])!.status = 'completed'
    const replay = await confirmDemoPlan(input())
    expect(replay.replayed).toBe(true)
    expect(replay.taskIds).toEqual(first.taskIds)
    expect(port.state!.tasks).toHaveLength(count)
    expect(port.state!.tasks.find(task => task.id === first.taskIds[0])!.status).toBe('completed')
  })
  it('rejects a reused key with changed items or another manager', async () => {
    await confirmDemoPlan(input())
    const changed = input(); changed.items[0].assignee = '另一位护理员'
    await expect(confirmDemoPlan(changed)).rejects.toThrow('请求编号')
    port.actor = { ...actor, userId: 'other-manager' }
    await expect(confirmDemoPlan(input())).rejects.toThrow('请求编号')
  })
  it.each(['caregiver', 'family', null] as const)('rejects role %s without a mutation', async role => {
    port.actor = { ...actor, role }
    const before = structuredClone(port.state)
    await expect(confirmDemoPlan(input())).rejects.toThrow('主管或管理员')
    expect(port.state).toEqual(before)
  })
  it('rejects API mode and an unchecked human confirmation', async () => {
    port.actor = { ...actor, mode: 'api' }
    await expect(confirmDemoPlan(input())).rejects.toThrow('主管或管理员')
    port.actor = actor
    await expect(confirmDemoPlan({ ...input(), humanConfirmed: false })).rejects.toThrow('勾选人工确认')
  })
  it('rejects stale revisions atomically and requires a fresh review', async () => {
    port.state!.revision++
    const before = structuredClone(port.state)
    await expect(confirmDemoPlan(input())).rejects.toBeInstanceOf(DemoPlanStateChanged)
    expect(port.state).toEqual(before)
  })
  it('does not replay an old request after a reset', async () => {
    await confirmDemoPlan(input())
    port.state = { ...state(), epoch: 'epoch-2' }
    const before = structuredClone(port.state)
    await expect(confirmDemoPlan(input())).rejects.toThrow('重置')
    expect(port.state).toEqual(before)
  })
  it('checks revision again inside the transaction, after the initial load', async () => {
    port.beforeWrite = () => { port.state!.revision++ }
    await expect(confirmDemoPlan(input())).rejects.toThrow('资料已变化')
    expect(port.state!.plans.some(plan => plan.id === 'plan-operation-1')).toBe(false)
  })
  it('checks identity again inside the transaction', async () => {
    port.beforeWrite = () => { port.actor = { ...actor, accountKey: 'other' } }
    await expect(confirmDemoPlan(input())).rejects.toThrow('登录身份')
    expect(port.state!.plans.some(plan => plan.id === 'plan-operation-1')).toBe(false)
  })
  it('rejects a missing/mismatched assessment, an invalid deadline and duplicate occurrences', () => {
    const current = state()
    expect(() => applyDemoPlanConfirmation(current, { ...input(), assessmentId: 'other' }, actor, new Date().toISOString())).toThrow('有效评估')
    const invalid = input(); invalid.items[0].deadlineAt = invalid.items[0].executionAt
    expect(() => applyDemoPlanConfirmation(current, invalid, actor, new Date().toISOString())).toThrow('截止时间')
    const duplicate = input(); duplicate.items.push({ ...duplicate.items[0] })
    expect(() => applyDemoPlanConfirmation(current, duplicate, actor, new Date().toISOString())).toThrow('不能重复')
    expect(current.appliedOperations).toEqual([])
  })
})
