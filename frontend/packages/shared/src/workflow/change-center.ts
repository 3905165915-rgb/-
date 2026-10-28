import type { Row } from './model'

export const changeStatus = (value: unknown): string =>
  ({
    pending: '待安排',
    assigned: '待核对',
    awaiting_review: '待复查',
    closed: '已处理',
  })[String(value)] || '待核实'

export function nextChangeAction(
  row: Row,
  userId: string,
  management: boolean,
) {
  if (row.status === 'closed') return null
  if (row.status === 'pending')
    return management
      ? { path: '/change-reviews/{case_id}/assign', label: '安排核对' }
      : null
  if (row.status === 'assigned') {
    if (row.assigned_to === userId)
      return { path: '/change-reviews/{case_id}/submit', label: '填写处理结果' }
    return management
      ? { path: '/change-reviews/{case_id}/assign', label: '调整处理人' }
      : null
  }
  if (row.status === 'awaiting_review' && management) {
    const submissions = Array.isArray(row.submissions)
      ? (row.submissions as Row[])
      : []
    if (submissions.at(-1)?.submitted_by !== userId)
      return { path: '/change-reviews/{case_id}/review', label: '复查处理结果' }
  }
  return null
}

export function changeReason(row: Row): string {
  const current = row.current as Row | undefined
  const reference = current?.reference as Row | undefined
  const state = reference?.current as Row | undefined
  const reasons = Array.isArray(state?.reasons)
    ? (state.reasons as string[])
    : []
  if (reasons.includes('memory_source_changed'))
    return '采用这条提示的原始记录已更正，需要核对相关服务。'
  if (reasons.includes('memory_revision_changed'))
    return '个人印象已有更新，需要核对任务是否仍适用。'
  if (reasons.includes('memory_expired'))
    return '任务引用的提示已到期，需要重新核实。'
  if (row.status === 'closed')
    return '这次变化已完成处理和复查，历史记录仍保留。'
  if (row.status === 'awaiting_review')
    return '处理人已提交结果，等待另一位负责人复查。'
  return '任务采用的照护提示发生变化，请核对后决定如何处理。'
}

export function recentChangeTitle(row: Row): string {
  const action = String(row.action || '')
  if (/correct/.test(action)) return '记录已更正'
  if (/memory|impression/.test(action)) return '个人印象有更新'
  if (/handover/.test(action)) return '交接事项有更新'
  if (/plan|arrangement/.test(action)) return '照护安排有更新'
  if (/task/.test(action)) return '服务任务有更新'
  if (/change_review/.test(action)) return '照护变化有处理进展'
  if (/record/.test(action)) return '新增照护记录'
  return '照护资料有更新'
}
