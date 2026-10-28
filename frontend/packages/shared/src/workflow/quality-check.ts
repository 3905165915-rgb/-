import type { Row } from './model'

// This exact 503 is raised before the current backend persists a report.
// A timeout, gateway 503, or malformed receipt must remain unresolved.
export function qualityModelUnavailable(status: number, code?: string): boolean {
  return status === 503 && code === 'AI unavailable or output invalid; retry with include_ai=false'
}
export function qualityFeedback(value: unknown): string {
  const report = value as Row | null
  if (!report || typeof report.id !== 'string' || !Array.isArray(report.issues))
    throw new Error('检查报告回执不完整，请核实历史报告，不要重复提交。')
  return report.provider === 'mock'
    ? '规则检查已完成；模型结果为演示数据。提示仍需人工核对。'
    : report.provider
      ? '规则与模型检查已完成，提示仍需人工核对。'
      : '规则检查已完成；本次未运行模型。提示仍需人工核对。'
}
