import { describe, expect, it } from 'vitest'
import { toUiError } from './errors'
import { WorkflowRequestError } from '../../shared/src/workflow/model'

describe('API-client public error metadata', () => {
  it('preserves public field guidance and prefers the server Chinese message', () => {
    const error = toUiError({ isAxiosError: true, response: { status: 422, data: {
      detail: 'validation_failed', error_code: 'validation_failed', safe_message: '请核对执行时间。', retryable: false,
      field_paths: ['body.due_at'], field_errors: [{ path: 'body.due_at', safe_message: '截止时间应晚于开始时间。', error_code: 'invalid_time' }],
    } } })
    expect(error).toMatchObject({ kind: 'validation', message: '请核对执行时间。', status: 422, code: 'validation_failed', canRetry: false, retryable: false, fieldPaths: ['body.due_at'], fieldErrors: { 'body.due_at': '截止时间应晚于开始时间。' } })
  })
  it('keeps normal version conflicts read-only and asks for current data', () => {
    expect(toUiError({ isAxiosError: true, response: { status: 409, data: {
      safe_message: '任务已更新，请核对当前内容。', error_code: 'task_revision_conflict', conflict_type: 'revision',
      reload_resource: { id: 'T1', path: '/tasks/T1', method: 'GET' },
    } } })).toMatchObject({ kind: 'validation', canRetry: false, status: 409, conflictType: 'revision', reloadResource: { id: 'T1', path: '/tasks/T1', method: 'GET' } })
  })
  it('honors service retry metadata while keeping legacy error kinds', () => {
    expect(toUiError({ isAxiosError: true, response: { status: 503, data: { safe_message: '整理服务暂未恢复。', retryable: false } } })).toMatchObject({ kind: 'unknown', message: '整理服务暂未恢复。', canRetry: false })
    expect(toUiError({ isAxiosError: true, response: { status: 429, data: { safe_message: '稍后再试。', retryable: true } } })).toMatchObject({ canRetry: true, retryable: true })
    expect(toUiError({ isAxiosError: true }).kind).toBe('network')
    expect(toUiError({ isAxiosError: true, response: { status: 401 } })).toMatchObject({ kind: 'unauthorized', canRetry: false })
    expect(toUiError({ isAxiosError: true, response: { status: 403 } })).toMatchObject({ kind: 'forbidden', canRetry: false })
  })
  it('keeps shared WorkflowRequestError metadata when a common feedback component consumes it', () => {
    const source = new WorkflowRequestError(409, '照护计划已更新。', 'plan_revision_changed', {
      field_errors: [{ path: 'body.expected_revision', safe_message: '请重新读取计划。' }], conflict_type: 'revision', reload_resource: { id: 'P1', path: '/care-plans/P1', method: 'GET' },
    })
    expect(toUiError(source)).toMatchObject({ status: 409, message: '照护计划已更新。', fieldErrors: { 'body.expected_revision': '请重新读取计划。' }, conflictType: 'revision', reloadResource: { id: 'P1', path: '/care-plans/P1', method: 'GET' } })
  })
})
