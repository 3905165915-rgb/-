import type { Operation, Row } from './model'

export interface ResultAction {
  path: string
  context: Row
  autoRead: boolean
}

/** Resolve an explicit next screen. Selecting a row never submits a mutation. */
export function resultAction(
  group: string,
  row: Row,
  context: Row,
): ResultAction | null {
  if (group === 'coverage' && row.occurrence_key) {
    return {
      path: '/insights/coverage/reviews',
      context: {
        elder_id: row.elder_id || context.elder_id,
        service_date: row.service_date || context.service_date,
        occurrence_key: row.occurrence_key,
        expected_fingerprint: row.fingerprint,
      },
      autoRead: false,
    }
  }
  if (
    group === 'incidents' &&
    typeof row.id === 'string' &&
    row.id.startsWith('INCIDENT-')
  ) {
    return {
      path: '/incidents/{incident_id}',
      context: { incident_id: row.id },
      autoRead: true,
    }
  }
  return null
}

export function incidentActions(row: Row, allowed: Operation[]) {
  if (!row.id || !row.status || row.status === 'closed') return []
  const rect = row.rectification as Row | null
  const paths = !rect
    ? ['/incidents/{incident_id}/triage']
    : rect.status === 'awaiting_review'
      ? ['/rectifications/{rectification_id}/review']
      : [
          '/rectifications/{rectification_id}/submit',
          '/rectifications/{rectification_id}/assign',
        ]
  return allowed.filter((op) => paths.includes(op.path))
}

export function resultActionLabel(row: Row): string {
  if (row.occurrence_key) return '核对并处理此项'
  if (typeof row.id === 'string' && row.id.startsWith('INCIDENT-'))
    return '查看事件详情'
  if (row.status === 'draft' && Array.isArray(row.items))
    return Number(row.revision || 0) < 1
      ? '刷新交班事项'
      : '填写注意事项并提交交班'
  return '选择此项办理后续'
}
