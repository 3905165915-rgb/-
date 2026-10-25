import type { FrontendSession } from '../session'
import type { Row } from './model'
import { activityTimestamp } from './elder-activity'

export interface ServerNotification extends Row {
  id: string
  object_type: string
  object_id: string
  title: string
  stage: string
  status: string
  revision: number
}

export const notificationStages: Record<string, string> = {
  task: '任务办理', triage: '安全事件分级', review: '独立复查', rectify: '整改办理',
  memory_review: '照护信息审核', receive: '交班接续', clarify: '交班澄清',
  summary_review: '家属简报审核', feedback: '家属反馈', photo_review: '照片观察审核',
  impression_review: '老人印象审核', awaiting_review: '等待复查', assigned: '已指派',
}
export const notificationStatuses: Record<string, string> = {
  pending: '待办理', accepted: '已接单', closed: '业务已更新',
}
export const notificationObjects: Record<string, string> = {
  care_tasks: '照护任务', incidents: '照护安全事件', care_memories: '照护记忆',
  change_reviews: '照护变更', family_cases: '家属沟通', handovers: '交接班',
  handover_items: '交接事项', attachments: '照片观察', image_analyses: '照片观察',
  elder_impressions: '老人印象',
}

export function validateNotifications(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务器通知格式异常，请刷新重试。')
  const page = value as Row
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || Number(page.total) < 0 ||
    !Number.isSafeInteger(page.offset) || Number(page.offset) < 0 ||
    !Number.isSafeInteger(page.limit) || Number(page.limit) < 1 ||
    activityTimestamp(page.as_of) === null || typeof page.definition !== 'string' || page.items.length > Number(page.limit) || Number(page.offset) + page.items.length > Number(page.total))
    throw new Error('服务器通知字段不完整，数据未显示。')
  const ids = new Set<string>()
  for (const item of page.items as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('服务器通知条目格式异常。')
    const row = item as Row
    if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) ||
      typeof row.object_type !== 'string' || typeof row.object_id !== 'string' ||
      typeof row.title !== 'string' || typeof row.stage !== 'string' || typeof row.status !== 'string' ||
      !Number.isSafeInteger(row.revision) || Number(row.revision) < 1)
      throw new Error('服务器通知缺少必要字段，数据未显示。')
    if (![row.object_type, row.object_id, row.title, row.stage, row.status].every(value => typeof value === 'string' && value.trim()) ||
      activityTimestamp(row.created_at) === null || ['read_at', 'accepted_at'].some(key => row[key] != null && activityTimestamp(row[key]) === null))
      throw new Error('服务器通知缺少必要字段，数据未显示。')
    ids.add(row.id)
  }
  return page as { items: ServerNotification[]; total: number; offset: number; limit: number; as_of: string; definition: string }
}

export function notificationLocation(item: ServerNotification, mobile: boolean) {
  const id = encodeURIComponent(item.object_id)
  const elder = typeof item.elder_id === 'string' ? item.elder_id : ''
  const routes: Record<string, { mobile: string; admin: string; query: Record<string, string> }> = {
    care_tasks: { mobile: `/tasks/${id}`, admin: '/tasks', query: { task: item.object_id } },
    incidents: { mobile: '/safety', admin: '/workflows/incidents', query: { incident_id: item.object_id, action: '/incidents/{incident_id}', read: '1' } },
    handovers: { mobile: '/handover', admin: '/workflows/handovers', query: { handover_id: item.object_id, action: '/handovers/{handover_id}', read: '1' } },
    care_memories: { mobile: '/notifications/business/memories', admin: '/workflows/memories', query: { memory_id: item.object_id, action: '/memories/{memory_id}', read: '1' } },
    elder_impressions: { mobile: elder ? `/elders/${encodeURIComponent(elder)}` : '/elders', admin: elder ? `/elders/${encodeURIComponent(elder)}` : '/elders', query: { impression_id: item.object_id } },
    change_reviews: { mobile: '/notifications/business/changes', admin: '/workflows/changes', query: { case_id: item.object_id, action: '/change-reviews/{case_id}', read: '1' } },
    family_cases: { mobile: '/notifications/business/family', admin: '/workflows/family', query: item.stage === 'summary_review'
      ? { summary_id: item.object_id, action: '/family/summaries/{summary_id}/review' }
      : { feedback_id: item.object_id, action: '/family/feedback/{feedback_id}/reply' } },
    attachments: { mobile: '/records/new', admin: '/workflows/records', query: { elder, elder_id: elder, attachment_id: item.object_id, action: '/records/manual' } },
    image_analyses: { mobile: '/records/new', admin: '/workflows/records', query: { elder, elder_id: elder, analysis_id: item.object_id, action: '/records/manual' } },
  }
  const route = routes[item.object_type]
  if (!route) return { path: mobile ? '/notifications' : '/notifications', query: {} }
  return { path: mobile ? route.mobile : route.admin, query: route.query }
}

export function notificationActionStorageKey(session: FrontendSession) {
  return 'hulao:notification-actions:v1:' + JSON.stringify([session.mode, session.accountKey, session.userId || '', session.role])
}
type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function notificationActionKey(storage: SessionStorageLike, session: FrontendSession, item: ServerNotification, action: 'read' | 'accept') {
  const storageKey = notificationActionStorageKey(session)
  let actions: Record<string, string> = {}
  try {
    const saved = JSON.parse(storage.getItem(storageKey) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) actions = saved
  } catch { actions = {} }
  const actionId = JSON.stringify([item.id, item.revision, action])
  if (!actions[actionId]) {
    actions[actionId] = crypto.randomUUID()
    const entries = Object.entries(actions).slice(-99)
    actions = Object.fromEntries(entries)
    storage.setItem(storageKey, JSON.stringify(actions))
  }
  return { key: actions[actionId], actionId, storageKey, actions }
}
export function clearNotificationAction(storage: SessionStorageLike, receipt: { actionId: string; storageKey: string; actions: Record<string, string> }) {
  let actions: Record<string, string> = {}
  try {
    const saved = JSON.parse(storage.getItem(receipt.storageKey) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) actions = saved
  } catch { return }
  delete actions[receipt.actionId]
  if (Object.keys(actions).length) storage.setItem(receipt.storageKey, JSON.stringify(actions))
  else storage.removeItem(receipt.storageKey)
}
