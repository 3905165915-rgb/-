import { formatBusinessTime } from '../business-time'
import {
  computed,
  onBeforeUnmount,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'
import { readSession, type FrontendSession } from '../session'
import { request, WorkflowRequestError, type Row } from './model'
import { sameCareSession } from './task-care-context'
import { demoBatch } from '../demo-batch'
export interface WorkspaceAttempt {
  path: string
  body: Row
  key: string
  method?: 'post' | 'put'
}
export function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('服务器回执不完整，请重试原提交核实。')
  return value as Row
}
export function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error('服务器列表不完整，请重试。')
  return value.map(object)
}
export const plainBody = (body: Row): Row =>
  object(JSON.parse(JSON.stringify(body)))
export const staffSession = (session: FrontendSession | null) =>
  session?.mode === 'api' &&
  ['admin', 'supervisor', 'caregiver'].includes(session.role || '')
export function workspaceStorageKey(
  owner: FrontendSession | null,
  elderId: string,
  operation: string,
) {
  return (
    'hulao:workspace:' +
    JSON.stringify([
      owner?.mode,
      demoBatch(),
      owner?.accountKey,
      owner?.userId,
      owner?.role,
      elderId,
      operation,
    ])
  )
}
export function parseAttempt(
  value: string | null,
  elderId: string,
  pathPrefix = '/elders/' + encodeURIComponent(elderId) + '/',
): WorkspaceAttempt | null {
  if (value === null) return null
  const row = object(JSON.parse(value))
  if (
    typeof row.path !== 'string' ||
    !row.path.startsWith(pathPrefix) ||
    typeof row.key !== 'string' ||
    !row.key
  )
    throw new Error('本机提交状态无法读取，请先核对服务器结果。')
  if (row.method !== undefined && row.method !== 'post' && row.method !== 'put')
    throw new Error('本机提交方式异常。')
  return {
    path: row.path,
    key: row.key,
    body: object(row.body),
    ...(row.method ? { method: row.method as 'post' | 'put' } : {}),
  }
}
/** Unknown receipts retain the durable original body/key, even after remount. */
export function useWorkspaceAction(
  elderId: MaybeRefOrGetter<string>,
  operation: string,
  pathPrefix?: MaybeRefOrGetter<string>,
) {
  const owner = readSession()
  const pending = ref<WorkspaceAttempt | null>(null)
  const busy = ref(false)
  const error = ref('')
  let epoch = 0
  let storageReadable = true
  const storageKey = computed(() =>
    workspaceStorageKey(owner, toValue(elderId), operation),
  )
  watch(
    storageKey,
    () => {
      epoch++
      pending.value = null
      error.value = ''
      storageReadable = true
      try {
        pending.value = parseAttempt(
          sessionStorage.getItem(storageKey.value),
          toValue(elderId),
          pathPrefix ? toValue(pathPrefix) : undefined,
        )
      } catch {
        storageReadable = false
        error.value = '本机提交状态无法读取，请先核对服务器结果。'
      }
    },
    { immediate: true },
  )
  async function send<T>(validate: (value: unknown) => T): Promise<T | null> {
    if (
      busy.value ||
      !pending.value ||
      !storageReadable ||
      !staffSession(owner) ||
      !sameCareSession(readSession(), owner)
    )
      return null
    const ticket = epoch
    const key = storageKey.value
    const attempt = plainBody(
      pending.value as unknown as Row,
    ) as unknown as WorkspaceAttempt
    busy.value = true
    error.value = ''
    try {
      const response = await request(
        attempt.path,
        attempt.method || 'post',
        attempt.body,
        attempt.key,
      )
      if (ticket !== epoch || !sameCareSession(readSession(), owner))
        return null
      const result = validate(response)
      sessionStorage.removeItem(key)
      pending.value = null
      return result
    } catch (failure) {
      if (ticket === epoch && sameCareSession(readSession(), owner)) {
        error.value =
          (failure instanceof Error ? failure.message : '操作回执待核实。') +
          ' 未确认的提交保留原请求，可重试核实。'
        if (
          failure instanceof WorkflowRequestError &&
          [400, 403, 404, 422].includes(failure.status)
        ) {
          try {
            sessionStorage.removeItem(key)
            pending.value = null
          } catch {
            storageReadable = false
          }
        }
      }
      return null
    } finally {
      busy.value = false
    }
  }
  async function submit<T>(
    path: string,
    body: Row,
    validate: (value: unknown) => T,
    method: 'post' | 'put' = 'post',
  ): Promise<T | null> {
    if (
      busy.value ||
      !staffSession(owner) ||
      !sameCareSession(readSession(), owner)
    )
      return null
    if (!pending.value) {
      if (!storageReadable) return null
      try {
        const attempt = {
          path,
          body: plainBody(body),
          key: crypto.randomUUID(),
          method,
        }
        parseAttempt(
          JSON.stringify(attempt),
          toValue(elderId),
          pathPrefix ? toValue(pathPrefix) : undefined,
        )
        sessionStorage.setItem(storageKey.value, JSON.stringify(attempt))
        pending.value = attempt
      } catch {
        error.value = '无法保留提交凭证，本次尚未发送。请检查浏览器存储后重试。'
        return null
      }
    }
    return send(validate)
  }
  onBeforeUnmount(() => {
    epoch++
  })
  function verifyReceipt<T>(
    value: unknown,
    validate: (value: unknown) => T,
  ): T | null {
    if (busy.value || !pending.value || !sameCareSession(readSession(), owner))
      return null
    try {
      const result = validate(value)
      sessionStorage.removeItem(storageKey.value)
      pending.value = null
      error.value = ''
      return result
    } catch (failure) {
      error.value =
        failure instanceof Error ? failure.message : '回执仍待核实。'
      return null
    }
  }
  return { pending, busy, error, submit, retry: send, verifyReceipt }
}
export function workspaceDate(value: unknown, full = false) {
  return typeof value === 'string'
    ? formatBusinessTime(value, full)
    : '时间未提供'
}
export const assessmentStates: Record<string, string> = {
  pending_observation: '待补充观察',
  draft: '待主管确认',
  confirmed: '已确认',
  superseded: '已被复评替代',
  retired: '已停用',
  rejected: '已退回',
}
