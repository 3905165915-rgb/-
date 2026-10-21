import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, toRaw, type EffectScope } from 'vue'
import type { Task } from '@hulao/shared'
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  complete: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
  account: { value: 'caregiver-test' },
  tasks: { value: [] as Task[] },
  taskError: { value: null as unknown },
}))
vi.mock('../services/data', () => ({
  mode: 'api',
  accountKey: mocks.account,
  localDraftsClearing: { value: false },
  gateway: { completeTask: mocks.complete },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : '操作失败',
  queryClient: { fetchQuery: mocks.fetch },
  queryKey: () => ['api', 'caregiver-test', 'tasks'],
  fetchTasks: vi.fn(),
  refreshData: mocks.refresh,
  useTasks: () => ({ data: mocks.tasks, error: mocks.taskError }),
}))
vi.mock('@hulao/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hulao/shared')>()),
  saveTaskEditor: mocks.save,
  loadTaskEditor: mocks.load,
  claimWriteAttempt: mocks.claim,
  finishWriteAttempt: mocks.finish,
  hasWriteAttempt: vi.fn().mockResolvedValue(false),
  writeWorkingJournal: vi.fn(),
  clearWorkingJournal: vi.fn(),
  rememberTaskDraft: vi.fn(),
  subscribeDraftDeletions: () => () => {},
}))
import { useTaskAction } from './useTaskAction'
const scopes: EffectScope[] = []
const pending: Task = {
  id: 'task-a',
  elderId: 'elder-a',
  title: '观察',
  status: 'pending',
  shift: '早班',
  assignee: '护理员',
  dueAt: '',
}
async function setup() {
  const scope = effectScope()
  scopes.push(scope)
  const action = scope.run(() => useTaskAction(() => pending.id))!
  await vi.waitFor(() => expect(action.form.value).toBeDefined())
  action.form.value!.result = '已完成观察'
  return action
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.account.value = 'caregiver-test'
  mocks.save.mockResolvedValue(undefined)
  mocks.load.mockResolvedValue(undefined)
  mocks.claim.mockResolvedValue(true)
  mocks.finish.mockResolvedValue(undefined)
  mocks.complete.mockResolvedValue({})
  mocks.fetch.mockResolvedValue([structuredClone(pending)])
  mocks.refresh.mockResolvedValue(undefined)
  mocks.tasks.value = [structuredClone(pending)]
  mocks.taskError.value = null
})
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})
describe('task action write protection', () => {
  it('does not mark newer edits saved when an older asynchronous save finishes', async () => {
    const action = await setup()
    let resolve!: () => void
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    action.changed()
    const pendingSave = action.save()
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    action.form.value!.result = '保存期间继续输入'
    action.changed()
    resolve()
    await pendingSave
    expect(action.saved.value).toBe(false)
    await action.save()
    expect(action.saved.value).toBe(true)
    expect(mocks.save.mock.calls[1]![0].result).toBe('保存期间继续输入')
    expect(mocks.save.mock.calls[1]![0].persistedVersion).toBe(1)
  })
  it('restores an uncertain phase before allowing another submit', async () => {
    const action = await setup()
    mocks.load.mockResolvedValue({
      ...structuredClone(toRaw(action.form.value!)),
      phase: 'uncertain',
    })
    await action.initialize()
    expect(action.uncertain.value).toBe(true)
    expect(action.canSend.value).toBe(false)
    await action.submit()
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('blocks writes when cached task status is unknown', async () => {
    mocks.tasks.value = [{ ...pending, status: 'future' as Task['status'] }]
    const action = await setup()
    expect(action.canSend.value).toBe(false)
    await action.submit()
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('blocks writes while a failed refresh leaves stale task data visible', async () => {
    mocks.taskError.value = new Error('refresh failed')
    const action = await setup()
    expect(action.canSend.value).toBe(false)
    await action.submit()
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('retains the completed task lock against a second window with a stale pending snapshot', async () => {
    const locks = new Set<string>()
    mocks.claim.mockImplementation(async (key: string) => {
      if (locks.has(key)) return false
      locks.add(key)
      return true
    })
    mocks.finish.mockImplementation(async (key: string) => {
      locks.delete(key)
    })
    mocks.fetch
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([{ ...pending, status: 'completed' }])
      .mockResolvedValue([pending])
    const first = await setup()
    await first.submit()
    expect(locks.has(JSON.stringify(['api', pending.id]))).toBe(true)
    const second = await setup()
    await second.submit()
    expect(mocks.complete).toHaveBeenCalledOnce()
  })
  it('retains note and local files and refuses an unsupported live submission', async () => {
    const action = await setup()
    action.form.value!.note = '保留备注'
    expect(action.canSend.value).toBe(false)
    await action.submit()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(action.form.value!.note).toBe('保留备注')
  })
  it('keeps the same attempt locked after a network failure and never automatically retries', async () => {
    const action = await setup()
    const key = action.form.value!.idempotencyKey
    mocks.complete.mockRejectedValue(new Error('连接中断'))
    await action.submit()
    expect(action.uncertain.value).toBe(true)
    expect(action.form.value!.idempotencyKey).toBe(key)
    expect(mocks.claim).toHaveBeenCalledWith(
      JSON.stringify(['api', pending.id]),
    )
    expect(mocks.finish).not.toHaveBeenCalled()
    await action.submit()
    expect(mocks.complete).toHaveBeenCalledOnce()
  })
  it('does not submit while another tab owns the attempt', async () => {
    const action = await setup()
    mocks.claim.mockResolvedValue(false)
    await action.submit()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(action.uncertain.value).toBe(true)
  })
  it('reconciles a timed-out write from the fetched completed state', async () => {
    const action = await setup()
    mocks.fetch
      .mockResolvedValueOnce([structuredClone(pending)])
      .mockResolvedValueOnce([{ ...pending, status: 'completed' }])
    mocks.complete.mockRejectedValue(new Error('连接中断'))
    await action.submit()
    expect(action.uncertain.value).toBe(false)
    expect(action.submitted.value).toBe(true)
    expect(mocks.finish).toHaveBeenCalledWith(action.form.value!.idempotencyKey)
    expect(mocks.finish).not.toHaveBeenCalledWith(
      JSON.stringify(['api', pending.id]),
    )
  })
  it('never resends an action for an already completed task', async () => {
    const action = await setup()
    mocks.fetch.mockResolvedValue([{ ...pending, status: 'completed' }])
    await action.submit()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(action.submitted.value).toBe(true)
  })
  it('blocks different account windows on the same shared task lock and keeps it after an unknown result', async () => {
    const locks = new Set<string>()
    mocks.claim.mockImplementation(async (key: string) => {
      if (locks.has(key)) return false
      locks.add(key)
      return true
    })
    mocks.finish.mockImplementation(async (key: string) => {
      locks.delete(key)
    })
    let reject!: (error: Error) => void
    mocks.complete.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    mocks.account.value = 'account-one'
    const first = await setup()
    const firstRequest = first.submit()
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce())
    mocks.account.value = 'account-two'
    const second = await setup()
    expect(second.form.value!.idempotencyKey).not.toBe(
      first.form.value!.idempotencyKey,
    )
    expect(second.form.value!.accountKey).not.toBe(first.form.value!.accountKey)
    await second.submit()
    expect(second.uncertain.value).toBe(true)
    expect(mocks.complete).toHaveBeenCalledOnce()
    reject(new Error('连接中断'))
    await firstRequest
    expect(first.uncertain.value).toBe(true)
    expect(locks.has(JSON.stringify(['api', pending.id]))).toBe(true)
    expect(locks.has(first.form.value!.idempotencyKey)).toBe(true)
    expect(locks.has(second.form.value!.idempotencyKey)).toBe(false)
  })
})
