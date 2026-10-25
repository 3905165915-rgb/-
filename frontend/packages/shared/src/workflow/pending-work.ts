import type { FrontendSession } from '../session'
import { actorId } from './shift-access'
import type { Row } from './model'

export interface PendingWorkItem {
  key: string
  fingerprint: string
  kind: 'record' | 'handover' | 'incident'
  title: string
  elderId: string
  status: string
  dueAt: string
  query: Record<string, string>
}
export function pendingWork(sources: Record<string, Row[]>, session: FrontendSession | null): PendingWorkItem[] {
  if (!session?.role || session.role === 'family') return []
  const manager = ['admin', 'supervisor'].includes(session.role)
  const userId = actorId(session)
  const ownShifts = new Set((sources.shifts || []).filter(row => Array.isArray(row.caregiver_ids) && row.caregiver_ids.includes(userId)).map(row => row.id))
  const result: PendingWorkItem[] = []
  const add = (kind: PendingWorkItem['kind'], row: Row, title: string, status: string, query: Record<string, string>, dueAt = '') => {
    if (typeof row.id !== 'string' || !row.id) return
    const key = kind + ':' + row.id
    result.push({ key, kind, title, elderId: String(row.elder_id || ''), status, dueAt, query,
      fingerprint: JSON.stringify([key, row.revision ?? null, row.status, row.updated_at ?? null, dueAt, row.receipt_note ?? null, row.clarifications ?? null]) })
  }
  for (const row of sources.drafts || [])
    if (row.status === 'pending_review' && (manager || (!!userId && row.created_by === userId)))
      add('record', row, '待核对记录', '待人工核对', { draft_id: String(row.id), action: '/records/drafts/{draft_id}', read: '1' })
  for (const handover of sources.handovers || []) {
    if (!['submitted', 'received'].includes(String(handover.status)) || !Array.isArray(handover.items)) continue
    for (const row of handover.items as Row[]) {
      const incoming = manager || ownShifts.has(handover.target_shift_id)
      const outgoing = manager || ownShifts.has(handover.source_shift_id)
      if ((row.status === 'pending' && incoming) || (row.status === 'clarifying' && (incoming || outgoing)))
        add('handover', row, row.status === 'clarifying' ? '交班待澄清' : '交班待接收', row.status === 'clarifying' ? '待澄清' : '待接收', { handover_id: String(handover.id), item_id: String(row.id), action: '/handovers/{handover_id}', read: '1' })
    }
  }
  for (const row of sources.incidents || []) {
    if (row.status === 'closed') continue
    const rect = row.rectification as Row | undefined
    const query = { incident_id: String(row.id), ...(rect?.id ? { rectification_id: String(rect.id) } : {}) }
    if (row.status === 'reported' && manager)
      add('incident', row, '安全事件待分级', '待人工分级', query)
    else if (rect?.status === 'awaiting_review' && manager) {
      const latest = Array.isArray(rect.submissions) ? rect.submissions.at(-1) as Row | undefined : undefined
      if (latest?.by !== userId) add('incident', { ...row, revision: `${row.revision}:${rect.revision}` }, '整改待独立复查', '待复查', query, String(rect.due_at || ''))
    } else if (rect?.status === 'assigned' && userId && rect.assigned_to === userId)
      add('incident', { ...row, revision: `${row.revision}:${rect.revision}` }, Array.isArray(rect.reviews) && (rect.reviews.at(-1) as Row | undefined)?.decision === 'return' ? '退回整改待补充' : '待提交整改', '待整改', query, String(rect.due_at || ''))
  }
  return result.sort((a, b) => (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) || a.key.localeCompare(b.key))
}
export function pendingWorkLocation(item: PendingWorkItem, mobile: boolean) {
  const paths = mobile ? { record: '/records/new', handover: '/handover', incident: '/safety' }
    : { record: '/workflows/records', handover: '/workflows/handovers', incident: '/workflows/incidents' }
  return { path: paths[item.kind], query: item.query }
}
type ReadStore = Pick<Storage, 'getItem' | 'setItem'>
export function pendingReadKey(session: FrontendSession) { return 'hulao:pending-read:v1:' + JSON.stringify([session.mode, session.accountKey, session.userId || '', session.role]) }
export function isPendingRead(store: ReadStore, session: FrontendSession, item: PendingWorkItem): boolean {
  try {
    const receipts = JSON.parse(store.getItem(pendingReadKey(session)) || '{}')
    return receipts && typeof receipts === 'object' && receipts[item.key] === item.fingerprint
  } catch { return false }
}
export function markPendingRead(store: ReadStore, session: FrontendSession, item: PendingWorkItem) {
  const raw = store.getItem(pendingReadKey(session))
  const parsed = raw ? JSON.parse(raw) : {}
  const receipts = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  const limited = Object.fromEntries(Object.entries(receipts).slice(-499))
  store.setItem(pendingReadKey(session), JSON.stringify({ ...limited, [item.key]: item.fingerprint }))
}
