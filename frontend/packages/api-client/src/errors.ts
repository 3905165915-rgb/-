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
}
export function toUiError(error: unknown): UiError {
  if (error instanceof ContractError)
    return { kind: 'contract', message: error.message, canRetry: false }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === 401)
      return {
        kind: 'unauthorized',
        message: '登录已失效，请重新登录',
        canRetry: false,
      }
    if (status === 403)
      return { kind: 'forbidden', message: '没有访问权限', canRetry: false }
    if (!error.response)
      return {
        kind: 'network',
        message: '网络连接失败，输入仍保留，请检查连接',
        canRetry: true,
      }
    if (status === 400 || status === 422)
      return {
        kind: 'validation',
        message: '提交内容未通过校验，请核对表单',
        canRetry: false,
      }
    return {
      kind: 'unknown',
      message: '服务暂时不可用，请稍后重试',
      canRetry: true,
    }
  }
  return {
    kind: 'unknown',
    message: error instanceof Error ? error.message : '操作失败，请重试',
    canRetry: true,
  }
}
