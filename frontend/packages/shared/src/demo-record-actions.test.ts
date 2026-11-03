import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDemoState } from './demo'
import type { DemoStateV2 } from './demo-store'
import type { FrontendSession } from './session'
import { createRecordEditor } from './editor'
import { createDemoApi, saveDemoOriginal, saveDemoManualRecord } from './demo-actions'
const port = vi.hoisted(() => ({ state: null as DemoStateV2 | null, actor: null as FrontendSession | null, beforeWrite: null as (() => void) | null }))
vi.mock('./session', () => ({ readSession: () => port.actor }))
vi.mock('./demo-store', () => ({ loadDemoState: async () => structuredClone(port.state), updateDemoState: async (epoch: string, mutate: (state: DemoStateV2) => void) => {
  port.beforeWrite?.(); const next = structuredClone(port.state!)
  if (next.epoch !== epoch) throw new Error('演示数据已重置')
  mutate(next); next.revision++; port.state = next; return next
} }))
const actor: FrontendSession = { mode: 'demo', accountKey: 'caregiver-demo', role: 'caregiver' }
function editor() { const form = createRecordEditor('demo', actor.accountKey, 'elder-wang-101'); form.demoEpoch = 'current'; form.text = port.state!.drafts[0].originalText; form.review.observation = '已询问本人意愿'; return form }
beforeEach(() => { const seed = createInitialDemoState(); port.state = { ...seed, schemaVersion: 3, epoch: 'current', revision: 0, tasks: [], timeline: [], handover: [], handoverVersions: [], confirmedDrafts: {}, appliedOperations: [] }; port.actor = actor; port.beforeWrite = null })
describe('original save and independently recoverable organization', () => {
  it('preserves original on organization failure, with a separate failure state', async () => {
    const form = editor(); form.text = '不是预置内容，仍然必须保存。'
    await saveDemoOriginal(form)
    await expect(createDemoApi().extractRecord({ text: form.text, elder_id: form.elderId, expectedEpoch: form.demoEpoch, sourceKey: `${form.localId}:${form.sourceRevision}` })).rejects.toThrow('手工录入')
    expect(port.state!.originals[0]).toMatchObject({ text: form.text, status: 'failed' })
    expect(port.state!.records).toHaveLength(40)
  })
  it('replays original and organization without duplicate products', async () => {
    const form = editor()
    const id = await saveDemoOriginal(form)
    expect(await saveDemoOriginal(form)).toBe(id)
    const request = { text: form.text, elder_id: form.elderId, expectedEpoch: form.demoEpoch, sourceKey: `${form.localId}:${form.sourceRevision}` }
    const draft = await createDemoApi().extractRecord(request)
    expect((await createDemoApi().extractRecord(request)).id).toBe(draft.id)
    expect(port.state!.originals).toHaveLength(1); expect(port.state!.drafts).toHaveLength(2)
    expect(port.state!.originals[0]).toMatchObject({ status: 'completed', draftId: draft.id })
  })
  it('confirms once, rejects altered confirmation and leaves incomplete followup as a suggestion', async () => {
    const form = editor(); form.review.followUp = '明天再看看'
    const result = await saveDemoManualRecord(form)
    expect(await saveDemoManualRecord(form)).toEqual(result)
    expect(port.state!.records).toHaveLength(41); expect(port.state!.tasks).toHaveLength(0)
    await expect(saveDemoManualRecord({ ...form, text: 'different' })).rejects.toThrow('内容已变化')
  })
  it('rejects stale epochs, conflicting source versions and cross-account editors', async () => {
    const form = editor(); await saveDemoOriginal(form)
    await expect(saveDemoOriginal({ ...form, text: 'changed without a revision' })).rejects.toThrow('冲突')
    await expect(saveDemoOriginal({ ...form, demoEpoch: 'old' })).rejects.toThrow('重置')
    await expect(saveDemoOriginal({ ...form, accountKey: 'other' })).rejects.toThrow('登录账号')
    expect(port.state!.originals).toHaveLength(1)
  })
  it('checks the identity again inside the write transaction', async () => {
    port.beforeWrite = () => { port.actor = { ...actor, role: 'family' } }
    await expect(saveDemoOriginal(editor())).rejects.toThrow('当前身份')
    expect(port.state!.originals).toHaveLength(0)
  })
})
