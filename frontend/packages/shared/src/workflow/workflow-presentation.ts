import type { Operation, Row } from './model'

export interface WorkflowAction { code: string; label: string; path: string; method: string }
export interface WorkflowHint {
  state_label?: string
  primary_action?: WorkflowAction | null
  secondary_actions?: WorkflowAction[]
  responsibility?: { assigned_to?: string | null; roles?: string[]; excluded_user_id?: string | null }
  blocked_reason?: string | null
}
export function workflowHint(value: unknown): WorkflowHint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const hint = (value as Row).workflow
  return hint && typeof hint === 'object' && !Array.isArray(hint) ? hint as WorkflowHint : null
}
export function workflowOperation(action: WorkflowAction, allowed: Operation[]): Operation | undefined {
  return allowed.find(op => op.method.toUpperCase() === action.method.toUpperCase() &&
    new RegExp('^' + op.path.split('/').map(part => /^\{[^}]+\}$/.test(part) ? '[^/]+' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('/') + '$').test(action.path))
}
export function incidentTitle(row: Row): string {
  return String(row.display_label || row.description || '').trim() || '事件内容待补充'
}
