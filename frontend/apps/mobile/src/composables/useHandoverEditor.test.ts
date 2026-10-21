import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue'
import { createHandoverEditor, type HandoverEditor } from '@hulao/shared'

const mocks = vi.hoisted(() => ({
  account: undefined as unknown as Ref<string>,
  load: vi.fn(),
  listBranches: vi.fn(),
  listVersions: vi.fn(),
  saveWorking: vi.fn(),
  saveVersion: vi.fn(),
  submitDemo: vi.fn(),
  journal: vi.fn(),
  clearJournal: vi.fn(),
  invalidate: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../services/data', async () => {
  const { ref } = await import('vue')
  mocks.account = ref('account-a')
  return {
    accountKey: mocks.account,
    mode: 'demo',
    localDraftsClearing: ref(false),
    queryKey: (...ids: string[]) => ['demo', mocks.account.value, ...ids],
    queryClient: { invalidateQueries: mocks.invalidate },
    refreshData: mocks.refresh,
  }
})

vi.mock('@tanstack/vue-query', () => ({
  useQuery: () => ({ data: { value: [] } }),
}))

vi.mock('@hulao/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hulao/shared')>()),
  loadHandoverWorkingDraft: mocks.load,
  listWorkingDrafts: mocks.listBranches,
  listHandoverEditors: mocks.listVersions,
  saveWorkingDraft: mocks.saveWorking,
  saveHandoverEditor: mocks.saveVersion,
  submitDemoHandover: mocks.submitDemo,
  loadDemoState: vi.fn().mockResolvedValue({ epoch: 'epoch-current' }),
  writeWorkingJournal: mocks.journal,
  clearWorkingJournal: mocks.clearJournal,
  subscribeDraftDeletions: () => () => {},
}))

import { useHandoverEditor } from './useHandoverEditor'

const scopes: EffectScope[] = []
type Controller = ReturnType<typeof useHandoverEditor>
type ContextChange = 'shift' | 'account'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function draft(
  shift = 'shift-a',
  account = 'account-a',
  id = shift,
): HandoverEditor {
  return {
    ...createHandoverEditor('demo', account, shift),
    localId: id,
    editVersion: 0,
    persistedVersion: 0,
    demoEpoch: 'epoch-current',
    note: `${account}/${shift}`,
    itemIds: ['item-a'],
  }
}

async function settle() {
  await nextTick()
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function mount() {
  const shift = ref('shift-a')
  const scope = effectScope()
  scopes.push(scope)
  const control = scope.run(() =>
    useHandoverEditor(
      () => shift.value,
      () => undefined,
      () => ['item-a'],
    ),
  )!
  await settle()
  return { control, shift }
}

async function changeContext(
  kind: ContextChange,
  shift: Ref<string>,
  control: Controller,
) {
  if (kind === 'shift') shift.value = 'shift-b'
  else {
    mocks.account.value = 'account-b'
    await control.loadSaved()
  }
  await settle()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', new EventTarget())
  const session = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => {
      session.set(key, value)
    },
  })
  mocks.account.value = 'account-a'
  mocks.load.mockImplementation(
    async (_mode, account: string, shift: string, id: string) =>
      draft(shift, account, id),
  )
  mocks.listBranches.mockResolvedValue([])
  mocks.listVersions.mockResolvedValue([])
  mocks.saveWorking.mockImplementation(
    async (_kind, editor: HandoverEditor) => {
      editor.persistedVersion = editor.editVersion
    },
  )
  mocks.saveVersion.mockResolvedValue(undefined)
  mocks.submitDemo.mockResolvedValue(undefined)
  mocks.invalidate.mockResolvedValue(undefined)
  mocks.refresh.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.each(['shift', 'account'] as const)(
  'handover %s generation changes',
  (kind) => {
    it('ignores a draft load that finishes after the new context loads', async () => {
      const pending = deferred<HandoverEditor>()
      mocks.load.mockReturnValueOnce(pending.promise)
      const { control, shift } = await mount()
      expect(control.editor.value).toBeUndefined()

      await changeContext(kind, shift, control)
      const current = control.editor.value
      expect(current?.accountKey).toBe(mocks.account.value)
      expect(current?.shiftId).toBe(shift.value)

      pending.resolve(draft())
      await settle()
      expect(control.editor.value).toBe(current)
      expect(control.message.value).toBe('')
    })

    it('does not replace current branches with a late previous-context list', async () => {
      const pending = deferred<HandoverEditor[]>()
      mocks.listBranches.mockReturnValueOnce(pending.promise)
      const { control, shift } = await mount()
      const branch = draft(
        kind === 'shift' ? 'shift-b' : 'shift-a',
        kind === 'account' ? 'account-b' : 'account-a',
        'current-branch',
      )
      mocks.listBranches.mockResolvedValue([branch])

      await changeContext(kind, shift, control)
      expect(control.branches.value.map((row) => row.localId)).toEqual([
        'current-branch',
      ])
      pending.resolve([draft('shift-a', 'account-a', 'stale-branch')])
      await settle()

      expect(control.branches.value.map((row) => row.localId)).toEqual([
        'current-branch',
      ])
      expect(control.editor.value?.accountKey).toBe(mocks.account.value)
      expect(control.editor.value?.shiftId).toBe(shift.value)
    })

    it('does not snapshot the new editor when the old working save finishes', async () => {
      const { control, shift } = await mount()
      const pending = deferred<void>()
      mocks.saveWorking.mockReturnValueOnce(pending.promise)
      const saving = control.save()
      await settle()
      expect(mocks.saveWorking).toHaveBeenCalledOnce()
      expect(control.busy.value).toBe(true)

      await changeContext(kind, shift, control)
      const current = control.editor.value
      expect(control.busy.value).toBe(false)
      pending.resolve(undefined)

      expect(await saving).toBe(false)
      expect(mocks.listVersions).not.toHaveBeenCalled()
      expect(mocks.saveVersion).not.toHaveBeenCalled()
      expect(control.editor.value).toBe(current)
      expect(control.message.value).toBe('')
      expect(control.error.value).toBe('')
    })

    it('does not append a version after an old history query resolves', async () => {
      const { control, shift } = await mount()
      const pending = deferred<HandoverEditor[]>()
      mocks.listVersions.mockReturnValueOnce(pending.promise)
      const saving = control.save()
      await settle()
      expect(mocks.listVersions).toHaveBeenCalledWith(
        'demo',
        'account-a',
        'shift-a',
      )

      await changeContext(kind, shift, control)
      pending.resolve([draft()])

      expect(await saving).toBe(false)
      expect(mocks.saveVersion).not.toHaveBeenCalled()
      expect(control.editor.value?.version).toBe(1)
      expect(control.message.value).toBe('')
      expect(control.busy.value).toBe(false)
    })

    it('does not submit or update the new editor after an old version write', async () => {
      const { control, shift } = await mount()
      const pending = deferred<void>()
      mocks.saveVersion.mockReturnValueOnce(pending.promise)
      const saving = control.save(true)
      await settle()
      expect(mocks.saveVersion).toHaveBeenCalledOnce()
      expect(mocks.saveVersion.mock.calls[0]![0]).toMatchObject({
        accountKey: 'account-a',
        shiftId: 'shift-a',
        note: 'account-a/shift-a',
      })

      await changeContext(kind, shift, control)
      const current = control.editor.value
      pending.resolve(undefined)

      expect(await saving).toBe(false)
      expect(mocks.submitDemo).not.toHaveBeenCalled()
      expect(mocks.invalidate).not.toHaveBeenCalled()
      expect(control.editor.value).toBe(current)
      expect(control.editor.value?.version).toBe(1)
      expect(control.message.value).toBe('')
    })

    it('does not publish an old save failure in the new context', async () => {
      const { control, shift } = await mount()
      const pending = deferred<void>()
      mocks.saveVersion.mockReturnValueOnce(pending.promise)
      const saving = control.save()
      await settle()
      expect(mocks.saveVersion).toHaveBeenCalledOnce()

      await changeContext(kind, shift, control)
      pending.reject(new Error('Old version write failed'))

      expect(await saving).toBe(false)
      expect(control.error.value).toBe('')
      expect(control.message.value).toBe('')
      expect(control.busy.value).toBe(false)
    })

    it('does not persist new-context metadata when an old demo submission finishes', async () => {
      const { control, shift } = await mount()
      const pending = deferred<void>()
      mocks.listVersions.mockResolvedValueOnce([{ ...draft(), version: 7 }])
      mocks.submitDemo.mockReturnValueOnce(pending.promise)
      const saving = control.save(true)
      await settle()
      expect(mocks.submitDemo).toHaveBeenCalledOnce()

      await changeContext(kind, shift, control)
      const current = control.editor.value
      pending.resolve(undefined)

      expect(await saving).toBe(false)
      expect(control.editor.value).toBe(current)
      expect(control.editor.value?.version).toBe(1)
      expect(control.editor.value?.editVersion).toBe(0)
      expect(mocks.saveWorking).toHaveBeenCalledOnce()
      expect(control.message.value).toBe('')
    })

    it('does not publish a restore confirmation after its persistence finishes late', async () => {
      const { control, shift } = await mount()
      const pending = deferred<void>()
      mocks.saveWorking.mockReturnValueOnce(pending.promise)
      const version = { ...draft(), version: 4, note: 'Restored old version' }
      const restoring = control.restore(version)
      await settle()
      expect(mocks.saveWorking).toHaveBeenCalledOnce()

      await changeContext(kind, shift, control)
      const current = control.editor.value
      pending.resolve(undefined)
      await restoring

      expect(control.editor.value).toBe(current)
      expect(control.editor.value?.note).not.toBe(version.note)
      expect(control.message.value).toBe('')
      expect(control.error.value).toBe('')
    })
  },
)

describe('handover branch and operation isolation', () => {
  it('keeps a new operation busy when an older generation finishes', async () => {
    const { control, shift } = await mount()
    const oldWrite = deferred<void>()
    mocks.saveWorking.mockReturnValueOnce(oldWrite.promise)
    const oldSave = control.save()
    await settle()

    await changeContext('shift', shift, control)
    const newHistory = deferred<HandoverEditor[]>()
    mocks.listVersions.mockReturnValueOnce(newHistory.promise)
    const newSave = control.save()
    oldWrite.resolve(undefined)
    expect(await oldSave).toBe(false)
    await settle()

    expect(control.busy.value).toBe(true)
    expect(control.editor.value?.shiftId).toBe('shift-b')
    newHistory.resolve([])
    expect(await newSave).toBe(true)
    expect(control.busy.value).toBe(false)
    expect(mocks.saveVersion).toHaveBeenCalledOnce()
    expect(mocks.saveVersion.mock.calls[0]![0].shiftId).toBe('shift-b')
  })

  it.each(['loadBranch', 'restore'] as const)(
    'rejects a wrong-shift %s without changing the editor',
    async (operation) => {
      const { control } = await mount()
      const current = control.editor.value

      await control[operation](draft('shift-b'))

      expect(control.editor.value).toBe(current)
      expect(control.error.value).not.toBe('')
      expect(mocks.saveWorking).not.toHaveBeenCalled()
      expect(mocks.journal).not.toHaveBeenCalled()
    },
  )
})
