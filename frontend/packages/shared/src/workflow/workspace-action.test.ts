import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { readSession, type FrontendSession } from '../session'
import { request, WorkflowRequestError } from './model'
import {
  parseAttempt,
  plainBody,
  useWorkspaceAction,
  workspaceStorageKey,
} from './workspace-action'
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onBeforeUnmount: vi.fn(),
}))
vi.mock('../session', () => ({ readSession: vi.fn() }))
vi.mock('./model', () => ({
  request: vi.fn(),
  WorkflowRequestError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message)
    }
  },
}))
const owner: FrontendSession = {
  mode: 'api',
  accountKey: 'synthetic-supervisor',
  role: 'supervisor',
  userId: 'USER-synthetic',
  accessToken: 'synthetic-token',
}
let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  vi.clearAllMocks()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.mocked(readSession).mockReturnValue({ ...owner })
})
function make(elder: string | ReturnType<typeof ref<string>> = 'ELDER-test') {
  const scope = effectScope()
  const action = scope.run(() => useWorkspaceAction(elder, 'record'))!
  return { action, stop: () => scope.stop() }
}
const validate = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('record' in value))
    throw new Error('回执不完整')
  return value
}
describe('durable elder workspace writes', () => {
  it('snapshots nested Vue reactive inputs without structuredClone errors', () => {
    const body = reactive({ text: '虚构记录', nested: { chosen: ['a'] } })
    const copy = plainBody(body)
    body.nested.chosen.push('b')
    expect(copy).toEqual({ text: '虚构记录', nested: { chosen: ['a'] } })
  })
  it('retries lost receipts after remount using the original path, body and key', async () => {
    vi.mocked(request)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ record: 'REC-synthetic' })
    const first = make()
    const body = reactive({ text: '虚构原始观察' })
    expect(
      await first.action.submit('/elders/ELDER-test/record', body, validate),
    ).toBeNull()
    const initial = vi.mocked(request).mock.calls[0]
    body.text = '新文字不应替换原提交'
    first.stop()
    const restored = make()
    expect(restored.action.pending.value?.body).toEqual({
      text: '虚构原始观察',
    })
    expect(await restored.action.retry(validate)).toEqual({
      record: 'REC-synthetic',
    })
    expect(vi.mocked(request).mock.calls[1]).toEqual(initial)
    expect(restored.action.pending.value).toBeNull()
    expect(values.size).toBe(0)
    restored.stop()
  })
  it('does not silently treat unknown success responses as saved or replace their body', async () => {
    vi.mocked(request)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ record: 'REC-synthetic' })
    const { action, stop } = make()
    expect(
      await action.submit(
        '/elders/ELDER-test/record',
        { text: '原提交' },
        validate,
      ),
    ).toBeNull()
    const initial = vi.mocked(request).mock.calls[0]
    expect(action.pending.value).not.toBeNull()
    await action.submit(
      '/elders/ELDER-test/another',
      { text: '变更内容' },
      validate,
    )
    expect(vi.mocked(request).mock.calls[1]).toEqual(initial)
    stop()
  })
  it('keeps 408/409 responses pending but unlocks a known rejected 422', async () => {
    const { action, stop } = make()
    vi.mocked(request).mockRejectedValueOnce(
      new WorkflowRequestError(409, '资料已变化'),
    )
    await action.submit(
      '/elders/ELDER-test/record',
      { text: '虚构测试' },
      validate,
    )
    expect(action.pending.value).not.toBeNull()
    vi.mocked(request).mockRejectedValueOnce(
      new WorkflowRequestError(422, '未保存'),
    )
    await action.retry(validate)
    expect(action.pending.value).toBeNull()
    stop()
  })
  it('isolates account, role, mode and elder receipt storage and blocks a switched session', async () => {
    const { action, stop } = make()
    vi.mocked(readSession).mockReturnValue({
      ...owner,
      accountKey: 'different-account',
    })
    await action.submit(
      '/elders/ELDER-test/record',
      { text: '虚构测试' },
      validate,
    )
    expect(request).not.toHaveBeenCalled()
    const original = workspaceStorageKey(owner, 'ELDER-test', 'record')
    for (const changed of [
      { ...owner, role: 'caregiver' as const },
      { ...owner, mode: 'demo' as const },
      { ...owner, userId: 'OTHER' },
    ])
      expect(workspaceStorageKey(changed, 'ELDER-test', 'record')).not.toBe(
        original,
      )
    expect(workspaceStorageKey(owner, 'ELDER-other', 'record')).not.toBe(
      original,
    )
    stop()
  })
  it('never sends if durable storage fails and rejects a restored cross-elder attempt', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage full')
      },
      removeItem: vi.fn(),
    })
    const { action, stop } = make()
    await action.submit(
      '/elders/ELDER-test/record',
      { text: '虚构测试' },
      validate,
    )
    expect(request).not.toHaveBeenCalled()
    expect(action.error.value).toContain('尚未发送')
    expect(() =>
      parseAttempt(
        JSON.stringify({
          path: '/elders/OTHER/record',
          body: { text: 'x' },
          key: 'k',
        }),
        'ELDER-test',
      ),
    ).toThrow()
    stop()
  })
  it('drops a late receipt after the elder changes without clearing its original durable retry', async () => {
    let resolve: (value: unknown) => void = () => undefined
    vi.mocked(request).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const elder = ref('ELDER-test'),
      { action, stop } = make(elder)
    const result = action.submit(
      '/elders/ELDER-test/record',
      { text: '虚构观察' },
      validate,
    )
    elder.value = 'ELDER-other'
    await nextTick()
    resolve({ record: 'REC-synthetic' })
    expect(await result).toBeNull()
    expect(values.has(workspaceStorageKey(owner, 'ELDER-test', 'record'))).toBe(
      true,
    )
    expect(action.pending.value).toBeNull()
    stop()
  })
})
