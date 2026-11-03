import axios from 'axios'
export class ContractError extends Error {
  constructor(
    message: string,
    readonly endpoint?: string,
    readonly fieldPath?: string,
  ) {
    super(message)
    this.name = 'ContractError'
  }
}
export interface UiError {
  kind:
    | 'network'
    | 'unauthorized'
    | 'forbidden'
    | 'validation'
    | 'contract'
    | 'unknown'
  message: string
  canRetry: boolean
  status?: number
  code?: string
  fieldErrors?: Record<string, string>
  fieldPaths?: string[]
  retryable?: boolean
  conflictType?: string | null
  reloadResource?: { id: string; path: string | null; method: 'GET' } | null
}
type Data = Record<string, unknown>
const fallbackMessages: Record<number, string> = {
  400: '请核对填写内容。',
  401: '登录已失效，请重新登录。',
  403: '当前账号无权办理此事项，请联系主管核对。',
  404: '未找到相关资料，请刷新列表后核对。',
  409: '资料或状态已变化，请读取最新资料并重新核对。',
  413: '文件或录音过大，请缩小后重新提交。',
  422: '提交内容未通过校验，请核对表单。',
  429: '操作较频繁，请稍后重试。',
  500: '服务暂时无法完成操作，请先核实保存结果。',
  502: '上游服务暂不可用，请稍后重试。',
  503: '服务暂不可用，请稍后重试或使用人工方式办理。',
  504: '处理等待超时，请先核实保存结果。',
}
function record(value: unknown): Data { return value && typeof value === 'object' ? value as Data : {} }
function metadata(value: unknown): Pick<UiError, 'code' | 'fieldErrors' | 'fieldPaths' | 'retryable' | 'conflictType' | 'reloadResource'> {
  const data = record(value), fieldErrors: Record<string, string> = {}
  if (Array.isArray(data.field_errors)) {
    for (const item of data.field_errors) {
      const error = record(item)
      if (typeof error.path === 'string' && typeof error.safe_message === 'string') fieldErrors[error.path] = error.safe_message
    }
  } else {
    for (const [path, message] of Object.entries(record(data.fieldErrors))) if (typeof message === 'string') fieldErrors[path] = message
  }
  const paths = data.field_paths ?? data.fieldPaths
  const fieldPaths = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : Object.keys(fieldErrors)
  const hint = record(data.reload_resource ?? data.reloadResource)
  const path = typeof hint.path === 'string' && /^\/(?!\/)[\w%/-]+(?:\?[\w%=&.,:~-]*)?$/.test(hint.path) ? hint.path.replace(/^\/api\/v1(?=\/)/, '') : null
  const reloadResource = typeof hint.id === 'string' && hint.method === 'GET' ? { id: hint.id, path, method: 'GET' as const } : null
  const rawCode = data.error_code ?? data.code ?? data.detail
  const code = typeof rawCode === 'string' && /^[a-z][a-z0-9_]*$/i.test(rawCode) ? rawCode : undefined
  const conflict = data.conflict_type ?? data.conflictType
  return { code, fieldErrors, fieldPaths, retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined, conflictType: typeof conflict === 'string' ? conflict : null, reloadResource }
}
function responseError(status: number, value: unknown, message?: string): UiError {
  const data = record(value), meta = metadata(data)
  const kind: UiError['kind'] = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : [400, 409, 413, 422].includes(status) ? 'validation' : status === 0 ? 'network' : 'unknown'
  const safeMessage = typeof data.safe_message === 'string' && data.safe_message.trim() ? data.safe_message : message || fallbackMessages[status] || '服务暂时不可用，请稍后重试。'
  const retryable = ![400, 401, 403, 404, 409, 413, 422].includes(status) && (meta.retryable ?? (status === 0 || [429, 500, 502, 503, 504].includes(status)))
  return { kind, message: safeMessage, canRetry: retryable, status, ...meta, retryable }
}
export function toUiError(error: unknown): UiError {
  if (error instanceof ContractError)
    return { kind: 'contract', message: error.message, canRetry: false }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (!error.response)
      return responseError(0, {}, '网络请求未能确认结果。输入已保留，请检查连接并核实保存状态。')
    return responseError(status || 500, error.response.data)
  }
  if (error instanceof Error && error.name === 'WorkflowRequestError' && typeof (error as Error & Data).status === 'number') return responseError((error as Error & Data).status as number, error, error.message)
  return {
    kind: 'unknown',
    message: error instanceof Error ? error.message : '操作失败，请重试',
    canRetry: true,
  }
}
