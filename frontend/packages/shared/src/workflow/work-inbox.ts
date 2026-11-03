import type { Row, Operation } from './model'
import { operations } from './model'
import type { Role } from '../session'
import { notificationLocation } from './pending-work'

export const inboxQueues = [
  { value: 'mine', label: '待我处理' },
  { value: 'review', label: '待复查' },
  { value: 'waiting', label: '等待他人' },
  { value: 'processed', label: '已处理' },
] as const
export type InboxQueue = (typeof inboxQueues)[number]['value']
export interface InboxRow extends Row {
  id: string
  object_id: string
  object_type: string
  title: string
  queue: InboxQueue
  notification_ids: string[]
  unread: boolean
}
export interface InboxPage {
  items: InboxRow[]
  total: number
  counts: Record<InboxQueue, number>
  limit: number
  offset: number
  as_of: string
}
export function inboxPage(value: unknown): InboxPage {
  const page = value as InboxPage
  if (
    !page ||
    !Array.isArray(page.items) ||
    !page.counts ||
    ![
      page.total,
      page.offset,
      page.limit,
      ...inboxQueues.map((q) => page.counts[q.value]),
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    page.limit < 1 ||
    page.items.length > page.limit ||
    (page.items.length > 0 && page.offset + page.items.length > page.total) ||
    typeof page.as_of !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(page.as_of) ||
    !Number.isFinite(Date.parse(page.as_of))
  )
    throw new Error('工作收件箱回执不完整，请重新读取。')
  const ids = new Set<string>()
  for (const item of page.items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      ids.has(item.id) ||
      typeof item.title !== 'string' ||
      typeof item.object_id !== 'string' ||
      typeof item.object_type !== 'string' ||
      !inboxQueues.some((q) => q.value === item.queue) ||
      typeof item.unread !== 'boolean' ||
      !Array.isArray(item.notification_ids) ||
      item.notification_ids.some((id) => typeof id !== 'string') ||
      (item.related_contexts !== undefined &&
        (!Array.isArray(item.related_contexts) ||
          item.related_contexts.some(
            (context) =>
              !context || typeof context !== 'object' || Array.isArray(context),
          )))
    )
      throw new Error('工作事项信息不完整，请重新读取。')
    ids.add(item.id)
  }
  return page
}
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {}
export function inboxWorkflow(item: InboxRow) {
  return object(item.workflow)
}
export function inboxContext(item: InboxRow, related?: Row): Row {
  const context: Row = {
    ...object(item.context),
    ...object(
      related ||
        (Array.isArray(item.related_contexts)
          ? item.related_contexts[0]
          : undefined),
    ),
    elder_id: item.elder_id,
    elder: item.elder_id,
  }
  const identifiers: Record<string, string> = {
    incidents: 'incident_id',
    change_reviews: 'case_id',
    quality_checks: 'issue_id',
    care_memories: 'memory_id',
    care_tasks: 'task_id',
    handovers: 'handover_id',
    handover_items: 'item_id',
    attachments: 'attachment_id',
    elder_impressions: 'impression_id',
  }
  if (identifiers[item.object_type])
    context[identifiers[item.object_type]] = item.object_id
  if (
    item.object_type === 'elder_impressions' &&
    typeof context.original_object_id === 'string' &&
    context.original_object_id.includes(':')
  )
    context.point_id = context.original_object_id.split(':').slice(1).join(':')
  return context
}
function matchOperation(op: Operation, path: string): Row | null {
  const keys: string[] = []
  const pattern = op.path
    .split('/')
    .map((part) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        keys.push(part.slice(1, -1))
        return '([^/]+)'
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  const match = new RegExp('^' + pattern + '$').exec(path)
  return match
    ? Object.fromEntries(
        keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]),
      )
    : null
}
export function inboxForm(item: InboxRow, role: Role | null) {
  if (!role || item.queue === 'processed') return null
  if (
    item.group === 'elder' ||
    (item.object_type === 'family_cases' &&
      item.business_stage === 'summary_review')
  )
    return null
  if (item.object_type === 'incidents')
    return {
      group: 'incidents',
      action: '/incidents/{incident_id}',
      read: true,
      context: { ...inboxContext(item), incident_id: item.object_id },
    }
  if (item.object_type === 'care_tasks' || item.group === 'elder') return null // These objects have a dedicated workspace.
  const primary = object(inboxWorkflow(item).primary_action)
  const path =
    typeof primary.path === 'string'
      ? primary.path
      : typeof item.path === 'string'
        ? item.path
        : ''
  const method = String(primary.method || 'get').toLowerCase()
  for (const op of operations) {
    if (!op.roles.includes(role) || op.method.toLowerCase() !== method) continue
    const matched = matchOperation(op, path)
    if (matched && op.group !== 'elders')
      return {
        group: op.group,
        action: op.path,
        read: method === 'get',
        context: { ...inboxContext(item), ...matched },
      }
  }
  if (typeof item.group === 'string' && typeof item.action_path === 'string') {
    const op = operations.find(
      (op) =>
        op.group === item.group &&
        op.path === item.action_path &&
        op.roles.includes(role),
    )
    if (op)
      return {
        group: op.group,
        action: op.path,
        read: op.method === 'get',
        context: inboxContext(item),
      }
  }
  return null
}
export function inboxLocation(item: InboxRow, mobile: boolean, related?: Row) {
  const context = inboxContext(item, related)
  const elder = String(item.elder_id || '')
  if (
    item.object_type === 'family_cases' &&
    item.business_stage === 'summary_review' &&
    !mobile
  )
    return { path: '/family', query: { elder, summary_id: item.object_id } }
  if (item.object_type === 'quality_checks')
    return {
      path: mobile
        ? '/timeline/' +
          encodeURIComponent(String(context.report_id || item.object_id))
        : '/quality',
      query: {
        elder,
        report_id: String(context.report_id || ''),
        issue_id: String(context.issue_id || item.object_id),
      },
    }
  if (item.group === 'elder' && item.object_type !== 'care_tasks' && elder) {
    const query: Record<string, string> = {
      elder,
      section: String(context.section || 'understanding'),
      source: String(context.original_object_id || item.object_id),
    }
    for (const field of [
      'impression_id',
      'point_id',
      'report_id',
      'task_id',
      'record_id',
      'service_date',
      'date',
    ])
      if (typeof context[field] === 'string') query[field] = context[field]
    return { path: '/elders/' + encodeURIComponent(elder), query }
  }
  const location = notificationLocation(
    { ...item, ...context, stage: String(item.business_stage || '') },
    mobile,
  )
  if (location.path === '/notifications' && elder)
    return {
      path: '/elders/' + encodeURIComponent(elder),
      query: {
        section: String(context.section || 'today'),
        source: item.object_id,
      },
    }
  return {
    ...location,
    query: { ...location.query, elder, source: item.object_id },
  }
}
export function inboxRelatedLocations(item: InboxRow, mobile: boolean) {
  const contexts = Array.isArray(item.related_contexts)
    ? item.related_contexts.map(object)
    : []
  const reasons = Array.isArray(item.reasons) ? item.reasons : []
  return contexts.map((context, index) => ({
    label: String(reasons[index] || `关联事项${index + 1}`),
    location: inboxLocation(item, mobile, context),
  }))
}
