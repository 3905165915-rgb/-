import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDemoState } from './demo'
import type { DemoStateV2 } from './demo-store'
import type { FrontendSession } from './session'
import { applyDemoTaskCreation, createDemoTask, type DemoTaskInput } from './demo-task-create'
const port = vi.hoisted(() => ({ state: null as DemoStateV2 | null, actor: null as FrontendSession | null, beforeWrite: null as (() => void) | null }))
vi.mock('./session', () => ({ readSession: () => port.actor }))
vi.mock('./demo-store', () => ({ updateDemoState: async (epoch: string, mutate: (state: DemoStateV2) => void) => {
  port.beforeWrite?.()
  const next = structuredClone(port.state!)
  if (next.epoch !== epoch) throw new Error('演示已重建')
  mutate(next); next.revision++; port.state = next; return next
} }))
const actor: FrontendSession = { mode: 'demo', accountKey: 'caregiver-demo', role: 'caregiver' }
function input(): DemoTaskInput { return { epoch: 'current', operationKey: 'new-request', elderId: 'elder-wang-101', title: '晚间询问本人意愿', executionAt: '2099-10-27T21:00:00+08:00', deadlineAt: '2099-10-27T21:30:00+08:00', assignee: '小王', shiftName: '晚班', scene: 'communication', confirmed: true } }
beforeEach(() => { const seed = createInitialDemoState(); port.state = { ...seed, schemaVersion: 3, epoch: 'current', revision: 0, tasks: [], timeline: [], handover: [], handoverVersions: [], confirmedDrafts: {}, appliedOperations: [] }; port.actor = actor; port.beforeWrite = null })
describe('manual demo task creation', () => {
  it('creates explicit item, original bed snapshot and a traceable event', async () => {
    const task = await createDemoTask(input())
    expect(task).toMatchObject({ elderId: input().elderId, bedSnapshot: '101房·1床', executionAt: input().executionAt, deadlineAt: input().deadlineAt, assignee: '小王', shiftName: '晚班', status: 'pending' })
    expect(port.state!.timeline[0].itemId).toBe(task.itemId)
  })
  it('replays equivalent absolute times without duplicating or resetting execution', async () => {
    const task = await createDemoTask(input())
    port.state!.tasks[0].status = 'completed'
    port.state!.elders[0].bedLabel = '202房·2床'
    const replay = await createDemoTask({ ...input(), executionAt: '2099-10-27T13:00:00Z', deadlineAt: '2099-10-27T13:30:00Z' })
    expect(replay.id).toBe(task.id); expect(replay.status).toBe('completed'); expect(replay.bedSnapshot).toBe('101房·1床'); expect(port.state!.tasks).toHaveLength(1)
  })
  it('rejects changed bodies and independent keys for the same occurrence', async () => {
    await createDemoTask(input())
    await expect(createDemoTask({ ...input(), title: 'changed' })).rejects.toThrow('内容不一致')
    await expect(createDemoTask({ ...input(), operationKey: 'another' })).rejects.toThrow('重复新建')
    expect(port.state!.tasks).toHaveLength(1)
  })
  it.each(['family', null] as const)('rejects unauthorized role %s', role => {
    expect(() => applyDemoTaskCreation(port.state!, input(), { ...actor, role })).toThrow('当前身份')
    expect(port.state!.tasks).toHaveLength(0)
  })
  it('rejects missing context, owner, shift, timezone, invalid windows and unchecked consent', () => {
    for (const patch of [{ elderId: 'other' }, { assignee: '' }, { shiftName: '' }, { executionAt: '2099-10-27T21:00:00' }, { deadlineAt: input().executionAt }, { confirmed: false }, { epoch: 'old' }]) {
      expect(() => applyDemoTaskCreation(port.state!, { ...input(), ...patch }, actor)).toThrow()
      expect(port.state!.tasks).toHaveLength(0)
    }
  })
  it('rejects an identity changed between click and transaction', async () => {
    port.beforeWrite = () => { port.actor = { ...actor, accountKey: 'other' } }
    await expect(createDemoTask(input())).rejects.toThrow('登录身份')
    expect(port.state!.tasks).toHaveLength(0)
  })
})
