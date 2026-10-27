import type { FrontendSession, Role } from '../session'
import type { DemoStateV2 } from '../demo-store'
import type { Row } from './model'
import { operations } from './model'
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
  task: '任务办理',
  triage: '安全事件分级',
  review: '独立复查',
  rectify: '整改办理',
  memory_review: '照护信息审核',
  receive: '交班接续',
  clarify: '交班澄清',
  summary_review: '家属简报审核',
  feedback: '家属反馈',
  photo_review: '照片观察审核',
  impression_review: '老人印象审核',
  awaiting_review: '等待复查',
  assigned: '已指派',
}
export const notificationStatuses: Record<string, string> = {
  pending: '待办理',
  accepted: '已接单',
  closed: '业务已更新',
}
export const notificationObjects: Record<string, string> = {
  care_tasks: '照护任务',
  incidents: '照护安全事件',
  care_memories: '照护记忆',
  change_reviews: '照护变更',
  family_cases: '家属沟通',
  handovers: '交接班',
  handover_items: '交接事项',
  attachments: '照片观察',
  image_analyses: '照片观察',
  elder_impressions: '老人印象',
}

export const followupCategories = [
  { value: 'pending', label: '待处理' },
  { value: 'review', label: '待复查' },
  { value: 'processed', label: '已处理' },
] as const
export type FollowupCategory = (typeof followupCategories)[number]['value']
export const followupTools = [
  { path: '/quality', label: '质量检查' },
  { path: '/coverage', label: '双向核对' },
  { path: '/changes', label: '变化简报' },
  { path: '/workflows/incidents', label: '安全事件' },
  { path: '/timeline', label: '过程回放' },
]
const reviewStages = new Set([
  'review',
  'awaiting_review',
  'memory_review',
  'summary_review',
  'photo_review',
  'impression_review',
])
// Read/accept receipts never constitute completion of the underlying business.
export function notificationCategory(
  item: ServerNotification,
): FollowupCategory {
  if (item.status === 'closed') return 'processed'
  return reviewStages.has(item.stage) ? 'review' : 'pending'
}
export function filterNotifications(
  items: ServerNotification[],
  category: FollowupCategory,
  objectType = '',
) {
  return items.filter(
    (item) =>
      notificationCategory(item) === category &&
      (!objectType || item.object_type === objectType),
  )
}

export interface NotificationWork {
  group: string
  action: string
  context: Row
  autoRead: boolean
  label: string
}
// Only select operations present in the existing contract. The business form
// loads business revisions itself; a notification revision must not be reused.
export function notificationWork(
  item: ServerNotification,
  role: Role | null,
): NotificationWork | null {
  if (!role || item.status === 'closed') return null
  const context: Row = {}
  let group = '',
    action = '',
    label = '办理事项',
    autoRead = false
  if (item.object_type === 'change_reviews') {
    group = 'changes'
    context.case_id = item.object_id
    action =
      item.stage === 'review' || item.stage === 'awaiting_review'
        ? '/change-reviews/{case_id}/review'
        : item.stage === 'assigned'
          ? '/change-reviews/{case_id}/submit'
          : '/change-reviews/{case_id}'
    autoRead = action === '/change-reviews/{case_id}'
  } else if (item.object_type === 'incidents') {
    group = 'incidents'
    context.incident_id = item.object_id
    if (item.stage === 'triage') action = '/incidents/{incident_id}/triage'
    else if (
      ['review', 'awaiting_review', 'rectify', 'assigned'].includes(
        item.stage,
      ) &&
      typeof item.rectification_id === 'string' &&
      item.rectification_id.trim()
    ) {
      context.rectification_id = item.rectification_id
      action =
        item.stage === 'review' || item.stage === 'awaiting_review'
          ? '/rectifications/{rectification_id}/review'
          : '/rectifications/{rectification_id}/submit'
    } else {
      action = '/incidents/{incident_id}'
      autoRead = true
    }
  } else if (
    item.object_type === 'care_memories' &&
    item.stage === 'memory_review'
  ) {
    group = 'memories'
    context.memory_id = item.object_id
    action = '/memories/{memory_id}/review'
  } else if (
    item.object_type === 'family_cases' &&
    ['summary_review', 'feedback'].includes(item.stage)
  ) {
    group = 'family'
    if (item.stage === 'summary_review') {
      context.summary_id = item.object_id
      action = '/family/summaries/{summary_id}/review'
    } else {
      context.feedback_id = item.object_id
      action = '/family/feedback/{feedback_id}/reply'
    }
  } else if (item.object_type === 'handovers') {
    group = 'handovers'
    context.handover_id = item.object_id
    action = '/handovers/{handover_id}'
    autoRead = true
  } else if (
    item.object_type === 'handover_items' &&
    ['receive', 'clarify'].includes(item.stage) &&
    typeof item.handover_id === 'string' &&
    item.handover_id.trim()
  ) {
    group = 'handovers'
    context.handover_id = item.handover_id
    context.item_id = item.object_id
    action =
      item.stage === 'clarify'
        ? '/handovers/{handover_id}/items/{item_id}/clarify'
        : '/handovers/{handover_id}/items/{item_id}/receive'
  }
  const operation = operations.find(
    (op) =>
      op.group === group &&
      op.path === action &&
      (op.method === 'get') === autoRead &&
      op.roles.includes(role),
  )
  if (!operation) return null
  label = autoRead ? '查看事项与办理入口' : operation.title
  return { group, action, context, autoRead, label }
}

export interface DemoFollowup {
  id: string
  title: string
  detail: string
  business: 'care_tasks' | 'handovers' | 'care_memories'
  category: FollowupCategory
  location: { path: string; query: Record<string, string> }
}
interface DemoMemoryReview {
  id: string
  elderId: string
  status: 'pending' | 'awaiting_review' | 'closed'
  description: string
}
export function demoFollowups(
  state: Pick<DemoStateV2, 'tasks' | 'handover'> & {
    memoryReviews?: DemoMemoryReview[]
    elders?: { id: string; name: string }[]
  },
  mobile: boolean,
): DemoFollowup[] {
  const elderName = (id: string) =>
    state.elders?.find((elder) => elder.id === id)?.name || '老人信息待核对'
  return [
    ...state.tasks.map((task) => ({
      id: `task:${task.id}`,
      title: task.title,
      detail: `${elderName(task.elderId)} · ${task.assignee} · ${task.shift} · ${task.status === 'completed' ? '任务已完成' : task.status === 'cancelled' ? '任务已取消' : task.status === 'not_done' ? '已登记未执行' : task.status === 'transferred' ? '任务已转交，待接续' : '任务待接续'}`,
      business: 'care_tasks' as const,
      category: (['completed', 'cancelled', 'not_done'].includes(task.status)
        ? 'processed'
        : 'pending') as FollowupCategory,
      location: {
        path: mobile ? `/tasks/${encodeURIComponent(task.id)}` : '/tasks',
        query: mobile ? ({} as Record<string, string>) : { task: task.id },
      },
    })),
    ...state.handover.map((item) => ({
      id: `handover:${item.id}`,
      title: item.title,
      detail: `${item.owner} · ${item.detail} · ${item.status}（接收不代表任务完成）`,
      business: 'handovers' as const,
      category: (item.status === '已接收'
        ? 'processed'
        : 'pending') as FollowupCategory,
      location: {
        path: mobile ? '/handover' : '/workflows/handovers',
        query: { shift: item.shiftId },
      },
    })),
    ...(state.memoryReviews || []).map((review) => ({
      id: `memory-review:${review.id}`,
      title: '照护理解跟进',
      detail: `${elderName(review.elderId)} · ${review.description}`,
      business: 'care_memories' as const,
      category: (
        {
          pending: 'pending',
          awaiting_review: 'review',
          closed: 'processed',
        } as const
      )[review.status],
      location: {
        path: `/elders/${encodeURIComponent(review.elderId)}`,
        query: { review: review.id },
      },
    })),
  ]
}

export function validateNotifications(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('服务器通知格式异常，请刷新重试。')
  const page = value as Row
  if (
    !Array.isArray(page.items) ||
    !Number.isSafeInteger(page.total) ||
    Number(page.total) < 0 ||
    !Number.isSafeInteger(page.offset) ||
    Number(page.offset) < 0 ||
    !Number.isSafeInteger(page.limit) ||
    Number(page.limit) < 1 ||
    activityTimestamp(page.as_of) === null ||
    typeof page.definition !== 'string' ||
    page.items.length > Number(page.limit) ||
    (page.items.length > 0 &&
      Number(page.offset) + page.items.length > Number(page.total))
  )
    throw new Error('服务器通知字段不完整，数据未显示。')
  const ids = new Set<string>()
  for (const item of page.items as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('服务器通知条目格式异常。')
    const row = item as Row
    if (
      typeof row.id !== 'string' ||
      !row.id.trim() ||
      ids.has(row.id) ||
      typeof row.object_type !== 'string' ||
      typeof row.object_id !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.stage !== 'string' ||
      typeof row.status !== 'string' ||
      !Number.isSafeInteger(row.revision) ||
      Number(row.revision) < 1
    )
      throw new Error('服务器通知缺少必要字段，数据未显示。')
    if (
      ![row.object_type, row.object_id, row.title, row.stage, row.status].every(
        (value) => typeof value === 'string' && value.trim(),
      ) ||
      activityTimestamp(row.created_at) === null ||
      ['read_at', 'accepted_at'].some(
        (key) => row[key] != null && activityTimestamp(row[key]) === null,
      )
    )
      throw new Error('服务器通知缺少必要字段，数据未显示。')
    ids.add(row.id)
  }
  return page as {
    items: ServerNotification[]
    total: number
    offset: number
    limit: number
    as_of: string
    definition: string
  }
}

export function notificationLocation(
  item: ServerNotification,
  mobile: boolean,
) {
  const id = encodeURIComponent(item.object_id)
  const elder = typeof item.elder_id === 'string' ? item.elder_id : ''
  const routes: Record<
    string,
    { mobile: string; admin: string; query: Record<string, string> }
  > = {
    care_tasks: {
      mobile: `/tasks/${id}`,
      admin: '/tasks',
      query: { task: item.object_id },
    },
    incidents: {
      mobile: '/safety',
      admin: '/workflows/incidents',
      query: {
        incident_id: item.object_id,
        action: '/incidents/{incident_id}',
        read: '1',
      },
    },
    handovers: {
      mobile: '/handover',
      admin: '/workflows/handovers',
      query: {
        handover_id: item.object_id,
        action: '/handovers/{handover_id}',
        read: '1',
      },
    },
    handover_items: {
      mobile: '/handover',
      admin: '/workflows/handovers',
      query:
        typeof item.handover_id === 'string' && item.handover_id.trim()
          ? {
              handover_id: item.handover_id,
              item_id: item.object_id,
              action: '/handovers/{handover_id}',
              read: '1',
            }
          : { item_id: item.object_id },
    },
    care_memories: {
      mobile: '/notifications/business/memories',
      admin: '/workflows/memories',
      query: {
        memory_id: item.object_id,
        action: '/memories/{memory_id}',
        read: '1',
      },
    },
    elder_impressions: {
      mobile: elder ? `/elders/${encodeURIComponent(elder)}` : '/elders',
      admin: elder ? `/elders/${encodeURIComponent(elder)}` : '/elders',
      query: { impression_id: item.object_id },
    },
    change_reviews: {
      mobile: '/notifications/business/changes',
      admin: '/workflows/changes',
      query: {
        case_id: item.object_id,
        action: '/change-reviews/{case_id}',
        read: '1',
      },
    },
    family_cases: {
      mobile: '/notifications/business/family',
      admin: '/workflows/family',
      query:
        item.stage === 'summary_review'
          ? {
              summary_id: item.object_id,
              action: '/family/summaries/{summary_id}/review',
            }
          : {
              feedback_id: item.object_id,
              action: '/family/feedback/{feedback_id}/reply',
            },
    },
    attachments: {
      mobile: '/records/new',
      admin: '/workflows/records',
      query: {
        elder,
        elder_id: elder,
        attachment_id: item.object_id,
        action: '/records/manual',
      },
    },
    image_analyses: {
      mobile: '/records/new',
      admin: '/workflows/records',
      query: {
        elder,
        elder_id: elder,
        analysis_id: item.object_id,
        action: '/records/manual',
      },
    },
  }
  const route = routes[item.object_type]
  if (!route)
    return { path: mobile ? '/notifications' : '/notifications', query: {} }
  return { path: mobile ? route.mobile : route.admin, query: route.query }
}

export function notificationActionStorageKey(session: FrontendSession) {
  return (
    'hulao:notification-actions:v1:' +
    JSON.stringify([
      session.mode,
      session.accountKey,
      session.userId || '',
      session.role,
    ])
  )
}
type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function notificationActionKey(
  storage: SessionStorageLike,
  session: FrontendSession,
  item: ServerNotification,
  action: 'read' | 'accept',
) {
  const storageKey = notificationActionStorageKey(session)
  let actions: Record<string, string> = {}
  try {
    const saved = JSON.parse(storage.getItem(storageKey) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      actions = saved
  } catch {
    actions = {}
  }
  const actionId = JSON.stringify([item.id, item.revision, action])
  if (!actions[actionId]) {
    actions[actionId] = crypto.randomUUID()
    const entries = Object.entries(actions).slice(-99)
    actions = Object.fromEntries(entries)
    storage.setItem(storageKey, JSON.stringify(actions))
  }
  return { key: actions[actionId], actionId, storageKey, actions }
}
export function clearNotificationAction(
  storage: SessionStorageLike,
  receipt: {
    actionId: string
    storageKey: string
    actions: Record<string, string>
  },
) {
  let actions: Record<string, string> = {}
  try {
    const saved = JSON.parse(storage.getItem(receipt.storageKey) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      actions = saved
  } catch {
    return
  }
  delete actions[receipt.actionId]
  if (Object.keys(actions).length)
    storage.setItem(receipt.storageKey, JSON.stringify(actions))
  else storage.removeItem(receipt.storageKey)
}
