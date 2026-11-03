import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDemoState } from './demo'
import type { DemoStateV2 } from './demo-store'
import { createTaskEditor } from './task-editor'
import { createHandoverEditor } from './handover-editor'
import { applyDemoTaskAction, submitDemoHandover } from './demo-actions'
const port = vi.hoisted(() => ({ state: null as DemoStateV2 | null }))
vi.mock('./session', () => ({
  readSession: () => ({
    mode: 'demo',
    accountKey: 'caregiver-demo',
    role: 'caregiver',
  }),
}))
vi.mock('./demo-store', () => ({
  loadDemoState: async () => structuredClone(port.state),
  updateDemoState: async (
    epoch: string,
    mutate: (state: DemoStateV2) => void,
  ) => {
    const next = structuredClone(port.state!)
    if (next.epoch !== epoch) throw new Error('epoch mismatch')
    mutate(next)
    next.revision++
    port.state = next
    return next
  },
}))
beforeEach(() => {
  port.state = {
    ...createInitialDemoState(),
    schemaVersion: 3,
    epoch: 'current',
    revision: 0,
    handover: [],
    handoverVersions: [],
    confirmedDrafts: {},
    appliedOperations: [],
  }
})
function form() {
  const task = port.state!.tasks.find((row) => row.status === 'pending')!
  return {
    ...createTaskEditor(task.id, 'demo', 'caregiver-demo'),
    demoEpoch: 'current',
    action: 'start' as const,
  }
}
function handover() {
  const task = port.state!.tasks.find((row) => row.status === 'pending')!
  return {
    ...createHandoverEditor('demo', 'caregiver-demo', 'day'),
    demoEpoch: 'current',
    itemIds: [task.id],
  }
}
describe('demo transaction replay safety', () => {
  it('replays the same task request and rejects different content under its key', async () => {
    const input = form()
    await applyDemoTaskAction(input)
    const count = port.state!.timeline.length
    await applyDemoTaskAction(input)
    expect(port.state!.timeline).toHaveLength(count)
    await expect(
      applyDemoTaskAction({ ...input, note: 'changed' }),
    ).rejects.toThrow('内容已变化')
    expect(port.state!.timeline).toHaveLength(count)
  })
  it('rejects a second start under a different key', async () => {
    const input = form()
    await applyDemoTaskAction(input)
    await expect(
      applyDemoTaskAction({ ...input, idempotencyKey: 'new-key' }),
    ).rejects.toThrow('任务已开始')
  })
  it('replays a handover version only with identical content', async () => {
    const input = handover()
    await submitDemoHandover(input)
    await submitDemoHandover(input)
    expect(port.state!.handover).toHaveLength(1)
    await expect(
      submitDemoHandover({ ...input, note: 'changed' }),
    ).rejects.toThrow('内容已变化')
    expect(port.state!.handover).toHaveLength(1)
  })
  it.each(['completed', 'cancelled', 'not_done'] as const)(
    'does not hand over a %s task',
    async (status) => {
      const input = handover()
      port.state!.tasks.find((row) => row.id === input.itemIds[0])!.status =
        status
      await expect(submitDemoHandover(input)).rejects.toThrow('交班事项已变化')
      expect(port.state!.handover).toHaveLength(0)
    },
  )
})
