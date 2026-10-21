import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, toRaw, type EffectScope } from 'vue'
import type { RecordDraft, RecordEditor } from '@hulao/shared'

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  confirm: vi.fn(),
  save: vi.fn(),
  journal: vi.fn(),
  list: vi.fn(),
  load: vi.fn(),
  refresh: vi.fn(),
  mode: 'api' as 'api' | 'demo',
  epoch: vi.fn(),
  manual: vi.fn(),
  clearing: { value: false },
  claim: vi.fn(),
  finish: vi.fn(),
}))
vi.mock('../services/data', () => ({
  get mode() {
    return mocks.mode
  },
  accountKey: { value: 'caregiver-test' },
  localDraftsClearing: mocks.clearing,
  gateway: { extractRecord: mocks.extract, confirmRecord: mocks.confirm },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : '操作失败',
  refreshData: mocks.refresh,
}))
vi.mock('@hulao/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hulao/shared')>()),
  saveRecordEditor: mocks.save,
  writeRecordJournal: mocks.journal,
  listRecordEditors: mocks.list,
  loadRecordEditor: mocks.load,
  loadDemoState: mocks.epoch,
  saveDemoManualRecord: mocks.manual,
  claimWriteAttempt: mocks.claim,
  finishWriteAttempt: mocks.finish,
}))
import { useRecordEditor } from './useRecordEditor'

const draft: RecordDraft = {
  id: 'draft-a',
  elderId: 'elder-a',
  originalText: '午餐只吃一半。',
  fields: { observation: '进食约半量', followUp: '', contactTarget: '' },
  evidence: ['午餐只吃一半'],
  warnings: [],
  status: 'pending_review',
}
const scopes: EffectScope[] = []
function setup() {
  const scope = effectScope()
  scopes.push(scope)
  const editor = scope.run(() => useRecordEditor())!
  editor.editor.value.elderId = draft.elderId
  editor.editor.value.text = draft.originalText
  if (mocks.mode === 'demo') editor.editor.value.demoEpoch = 'epoch-current'
  editor.changed(true)
  return editor
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.mode = 'api'
  mocks.clearing.value = false
  mocks.epoch.mockResolvedValue({ epoch: 'epoch-current' })
  mocks.manual.mockResolvedValue({ status: 'confirmed', task_ids: [] })
  mocks.claim.mockResolvedValue(true)
  mocks.finish.mockResolvedValue(undefined)
  mocks.save.mockResolvedValue(undefined)
  mocks.journal.mockReturnValue(undefined)
  mocks.list.mockResolvedValue([])
  mocks.refresh.mockResolvedValue(undefined)
  mocks.confirm.mockResolvedValue({})
  mocks.extract.mockResolvedValue(structuredClone(draft))
})
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})
describe('record editor submission and recovery', () => {
  it('reports local saving until all queued writes finish without freezing inputs', async () => {
    const editor = setup()
    let release!: () => void
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const first = editor.persist()
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    expect(editor.savingLocal.value).toBe(true)
    expect(editor.busy.value).toBe(false)
    editor.editor.value.text = '保存期间继续输入'
    editor.changed(true)
    const second = editor.persist()
    release()
    await Promise.all([first, second])
    expect(editor.savingLocal.value).toBe(false)
    expect(editor.saved.value).toBe(true)
    expect(mocks.save.mock.lastCall?.[0].text).toBe('保存期间继续输入')
  })
  it('clears local saving after a storage failure', async () => {
    const editor = setup()
    mocks.save.mockRejectedValueOnce(new Error('存储不可用'))
    expect(await editor.persist()).toBe(false)
    expect(editor.savingLocal.value).toBe(false)
    expect(editor.saved.value).toBe(false)
    expect(editor.saveError.value).toContain('存储不可用')
  })
  it('copies conflicted content into a new editor without carrying an old AI binding', async () => {
    const editor = setup()
    await editor.extract()
    const oldId = editor.editor.value.localId
    const review = structuredClone(toRaw(editor.editor.value.review))
    mocks.save.mockRejectedValueOnce(new Error('草稿保存冲突'))
    expect(await editor.persist()).toBe(false)
    await editor.copyAsNew()
    expect(editor.editor.value.localId).not.toBe(oldId)
    expect(editor.editor.value.text).toBe(draft.originalText)
    expect(editor.editor.value.review).toEqual(review)
    expect(editor.editor.value.ai).toBeUndefined()
    expect(editor.editor.value.phase).toBe('editing')
    expect(editor.notice.value).toContain('另存为新草稿')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('journals the current raw text synchronously and invalidates stale AI on source edits', async () => {
    const editor = setup()
    expect(mocks.journal.mock.lastCall?.[0].text).toBe(draft.originalText)
    await editor.extract()
    expect(editor.confirmable.value).toBe(true)
    editor.editor.value.text = '午餐已吃完。'
    editor.changed(true)
    expect(editor.confirmable.value).toBe(false)
    expect(editor.editor.value.ai?.sourceText).toBe(draft.originalText)
    expect(mocks.journal.mock.lastCall?.[0].text).toBe('午餐已吃完。')
  })
  it('does not apply an extraction that arrives after the elder changes', async () => {
    let resolve!: (value: RecordDraft) => void
    mocks.extract.mockImplementation(
      () =>
        new Promise<RecordDraft>((done) => {
          resolve = done
        }),
    )
    const editor = setup()
    const request = editor.extract()
    await vi.waitFor(() => expect(mocks.extract).toHaveBeenCalledOnce())
    editor.editor.value.elderId = 'elder-b'
    editor.changed(true)
    resolve(structuredClone(draft))
    await request
    expect(editor.editor.value.ai).toBeUndefined()
    expect(editor.notice.value).toContain('未采用')
  })
  it('persists submitting before writing and keeps an unknown result frozen without resend', async () => {
    const phases: string[] = []
    mocks.save.mockImplementation(async (value: RecordEditor) => {
      phases.push(value.phase)
    })
    mocks.confirm.mockRejectedValue(new Error('连接中断'))
    const editor = setup()
    await editor.extract()
    mocks.confirm.mockImplementation(async () => {
      expect(phases.at(-1)).toBe('submitting')
      throw new Error('连接中断')
    })
    await editor.submit()
    expect(editor.editor.value.phase).toBe('uncertain')
    expect(editor.frozen.value).toBe(true)
    await editor.submit()
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.claim).toHaveBeenCalledWith(
      JSON.stringify(['api', 'record', draft.id]),
    )
    expect(mocks.finish).not.toHaveBeenCalled()
    expect(phases.at(-1)).toBe('uncertain')
  })
  it('never sends a confirm when saving the submission intent fails', async () => {
    const editor = setup()
    await editor.extract()
    expect(editor.confirmable.value).toBe(true)
    const attempts: string[] = []
    mocks.save.mockImplementation(async (value: RecordEditor) => {
      attempts.push(value.phase)
      if (value.phase === 'submitting') throw new Error('空间不足')
    })
    await editor.submit()
    expect(attempts).toEqual(['submitting'])
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(editor.saveError.value).toContain('保存失败')
    expect(editor.saveError.value).toContain('空间不足')
    expect(editor.saved.value).toBe(false)
    expect(editor.editor.value.phase).toBe('reviewing')
    expect(mocks.journal.mock.lastCall?.[0].phase).toBe('reviewing')
    await editor.persist()
    expect(editor.saveError.value).toBe('')
    expect(editor.saved.value).toBe(true)
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('keeps the local save error visible when extraction cannot persist its source', async () => {
    const editor = setup()
    mocks.save.mockRejectedValue(new Error('空间不足'))
    await editor.extract()
    expect(mocks.extract).not.toHaveBeenCalled()
    expect(editor.editor.value.phase).toBe('editing')
    expect(editor.saveError.value).toContain('空间不足')
  })
  it('recovers an interrupted submission as uncertain and cannot resubmit it', async () => {
    const editor = setup()
    const interrupted = structuredClone(toRaw(editor.editor.value))
    interrupted.phase = 'submitting'
    mocks.list.mockResolvedValue([interrupted])
    await editor.initialize()
    expect(editor.editor.value.phase).toBe('uncertain')
    await editor.submit()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('rejects extraction from an old demo editor after reset', async () => {
    mocks.mode = 'demo'
    const editor = setup()
    mocks.epoch.mockResolvedValue({ epoch: 'epoch-new' })
    await editor.extract()
    expect(mocks.extract).not.toHaveBeenCalled()
    expect(editor.error.value).toContain('已重置')
  })
  it('creates a fresh editor after reset without trying to save the rejected old epoch', async () => {
    mocks.mode = 'demo'
    const editor = setup()
    const oldId = editor.editor.value.localId
    mocks.epoch.mockResolvedValue({ epoch: 'epoch-new' })
    mocks.save.mockRejectedValue(new Error('旧版本不能保存'))
    await editor.fresh()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(editor.editor.value.localId).not.toBe(oldId)
    expect(editor.editor.value.demoEpoch).toBe('epoch-new')
    expect(editor.editor.value.text).toBe('')
  })
  it('replaces old in-memory fields with a new editor when initialization finds no current candidate', async () => {
    mocks.mode = 'demo'
    const editor = setup()
    const oldId = editor.editor.value.localId
    editor.editor.value.review.observation = '旧观察'
    mocks.epoch.mockResolvedValue({ epoch: 'epoch-new' })
    await editor.initialize()
    expect(editor.editor.value.localId).not.toBe(oldId)
    expect(editor.editor.value.demoEpoch).toBe('epoch-new')
    expect(editor.editor.value.text).toBe('')
    expect(editor.editor.value.elderId).toBe('')
    expect(editor.editor.value.review.observation).toBe('')
    expect(editor.saved.value).toBe(false)
  })
  it('rejects both AI and manual confirmation from an old demo editor', async () => {
    mocks.mode = 'demo'
    const editor = setup()
    await editor.extract()
    expect(editor.confirmable.value).toBe(true)
    mocks.epoch.mockResolvedValue({ epoch: 'epoch-new' })
    await editor.submit()
    await editor.submit(true)
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.manual).not.toHaveBeenCalled()
    expect(editor.error.value).toContain('已重置')
  })
  it('does not extract when the elder changes while checking the demo epoch', async () => {
    mocks.mode = 'demo'
    let resolve!: (value: { epoch: string }) => void
    mocks.epoch.mockImplementationOnce(
      () =>
        new Promise<{ epoch: string }>((done) => {
          resolve = done
        }),
    )
    const editor = setup()
    const request = editor.extract()
    await vi.waitFor(() => expect(mocks.epoch).toHaveBeenCalled())
    editor.editor.value.elderId = 'elder-b'
    editor.changed(true)
    resolve({ epoch: 'epoch-current' })
    await request
    expect(mocks.extract).not.toHaveBeenCalled()
    expect(editor.notice.value).toContain('原文已变更')
  })
  it('does not submit when the source changes while checking the demo epoch', async () => {
    mocks.mode = 'demo'
    const editor = setup()
    await editor.extract()
    let resolve!: (value: { epoch: string }) => void
    mocks.epoch.mockImplementationOnce(
      () =>
        new Promise<{ epoch: string }>((done) => {
          resolve = done
        }),
    )
    const request = editor.submit()
    editor.editor.value.text = '新的原文'
    editor.changed(true)
    resolve({ epoch: 'epoch-current' })
    await request
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(editor.notice.value).toContain('内容已变更')
  })
  it('does not accept an AI result if demo reset occurs while extraction is in flight', async () => {
    mocks.mode = 'demo'
    let resolve!: (value: RecordDraft) => void
    mocks.extract.mockImplementation(
      () =>
        new Promise<RecordDraft>((done) => {
          resolve = done
        }),
    )
    const editor = setup()
    const request = editor.extract()
    await vi.waitFor(() => expect(mocks.extract).toHaveBeenCalled())
    mocks.epoch.mockResolvedValue({ epoch: 'epoch-new' })
    resolve(structuredClone(draft))
    await request
    expect(editor.editor.value.ai).toBeUndefined()
    expect(editor.error.value).toContain('已重置')
  })
  it('does not journal or save after clearing local drafts starts', async () => {
    const editor = setup()
    mocks.journal.mockClear()
    mocks.clearing.value = true
    editor.changed(true)
    expect(await editor.persist()).toBe(false)
    expect(mocks.journal).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('locks the server draft across two reviewing editors and retains the claim after success', async () => {
    const locks = new Set<string>()
    mocks.claim.mockImplementation(async (key: string) => {
      if (locks.has(key)) return false
      locks.add(key)
      return true
    })
    const first = setup()
    await first.extract()
    const second = setup()
    await second.extract()
    expect(first.editor.value.localId).not.toBe(second.editor.value.localId)
    expect(first.editor.value.ai?.draft.id).toBe(
      second.editor.value.ai?.draft.id,
    )
    await Promise.all([first.submit(), second.submit()])
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(
      [first.editor.value.phase, second.editor.value.phase].sort(),
    ).toEqual(['submitted', 'uncertain'])
    expect(locks.has(JSON.stringify(['api', 'record', draft.id]))).toBe(true)
    expect(mocks.finish).not.toHaveBeenCalled()
  })
  it.each([400, 422, 403, 401])(
    'releases the record claim after a definitive HTTP %i rejection',
    async (status) => {
      const editor = setup()
      await editor.extract()
      mocks.confirm.mockRejectedValue({
        isAxiosError: true,
        response: { status },
      })
      await editor.submit()
      expect(editor.editor.value.phase).toBe('reviewing')
      expect(mocks.finish).toHaveBeenCalledWith(
        JSON.stringify(['api', 'record', draft.id]),
      )
    },
  )
})
