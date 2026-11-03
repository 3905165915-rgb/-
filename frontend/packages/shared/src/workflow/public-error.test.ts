import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fieldError, request, WorkflowRequestError } from './model'

beforeEach(() => {
  vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify({ mode: 'api', accountKey: 'synthetic-admin', role: 'admin', accessToken: 'synthetic-token' }), removeItem: vi.fn() })
  vi.stubGlobal('localStorage', { removeItem: vi.fn() })
  vi.stubGlobal('window', new EventTarget())
})

describe('public error contract', () => {
  it('retains Chinese field guidance next to nested fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'request_validation_failed', error_code: 'request_validation_failed', safe_message: '请核对任务安排。',
      field_paths: ['body.tasks.0.due_at'], field_errors: [{ path: 'body.tasks.0.due_at', error_code: 'invalid_time', safe_message: '截止时间应晚于开始时间。' }], retryable: false,
    }), { status: 422 })))
    try { await request('/tasks', 'post', { tasks: [{ due_at: '2026-11-03T08:00:00+08:00' }] }); throw new Error('Expected field validation') }
    catch (failure) {
      expect(failure).toBeInstanceOf(WorkflowRequestError)
      const error = failure as WorkflowRequestError
      expect(error.message).toBe('请核对任务安排。')
      expect(error.code).toBe('request_validation_failed')
      expect(fieldError(error.fieldErrors, 'tasks.0.due_at')).toBe('截止时间应晚于开始时间。')
      expect(error.retryable).toBe(false)
    }
  })
  it('returns a read-only conflict location without automatically repeating a write', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'task_revision_conflict', error_code: 'task_revision_conflict', safe_message: '任务已更新，请重新核对。',
      conflict_type: 'revision', reload_resource: { id: 'T1', path: '/tasks/T1', method: 'GET' },
    }), { status: 409 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/tasks/T1/transition', 'post', { expected_revision: 1 }, 'same-write')).rejects.toMatchObject({
      status: 409, conflictType: 'revision', reloadResource: { id: 'T1', path: '/tasks/T1', method: 'GET' },
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('keeps an unconfirmed write distinct from a successful save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network disconnected')))
    await expect(request('/tasks', 'post', { title: '合成测试事项' }, 'same-write')).rejects.toMatchObject({
      status: 0, code: 'network_unconfirmed', retryable: true,
    })
    await expect(request('/tasks', 'get')).rejects.toThrow('未能读取服务器资料')
  })
})
