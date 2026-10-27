import { shallowRef } from 'vue'
import type { AppMode, FrontendSession } from '../session'
import type { Task } from '../types'
import type { Row } from './model'
import { sameCareSession } from './task-care-context'

export const activityTypes = {
  record: '照护记录',
  task: '任务',
  handover: '交班事项',
  incident: '安全事件',
  memory: '照护记忆',
  family: '家属沟通',
  other: '其他操作',
} as const
export type ActivityType = keyof typeof activityTypes
export interface ActivityReference {
  type: ActivityType
  id: string
  parentId?: string
}
export interface ActivityItem {
  key: string
  elderId: string
  type: ActivityType
  title: string
  text: string
  status: string
  actor?: string
  times: { label: string; value: string; timestamp: number | null }[]
  timestamp: number | null
  reference: ActivityReference
  source?: ActivityReference
  sources: ActivityReference[]
  detailUrl?: string
  replayUrl?: string
  detailAvailable?: boolean
}
export interface ActivityFilter {
  type: ActivityType | ''
  start: string
  end: string
}
export interface TimelineEventForGrouping {
  recordedAt: string
  happenedAt?: string | null
  id?: string
  [key: string]: unknown
}
export interface TimelineEventGroup<
  T extends TimelineEventForGrouping = TimelineEventForGrouping,
> {
  date: string
  events: T[]
}
const string = (value: unknown) => (typeof value === 'string' ? value : '')
const object = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : null

function calendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}
// Server instants need an explicit offset; relative demo labels are not dates.
export function activityTimestamp(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !calendarDay(value.slice(0, 10)) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}
export function groupTimelineEvents<T extends TimelineEventForGrouping>(
  events: T[],
): TimelineEventGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const event of events) {
    const timestamp = activityTimestamp(event.recordedAt)
    if (timestamp === null) continue
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(timestamp)
    const date = `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`
    groups.set(date, [...(groups.get(date) ?? []), event])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, grouped]) => ({
      date,
      events: grouped.sort(
        (a, b) =>
          (activityTimestamp(b.recordedAt) ?? -Infinity) -
            (activityTimestamp(a.recordedAt) ?? -Infinity) ||
          (a.id ?? '').localeCompare(b.id ?? ''),
      ),
    }))
}
export function activityFilterError(filter: ActivityFilter): string {
  if (
    (filter.start && !calendarDay(filter.start)) ||
    (filter.end && !calendarDay(filter.end))
  )
    return '请选择有效日期。'
  return filter.start && filter.end && filter.start > filter.end
    ? '结束日期不能早于开始日期。'
    : ''
}
export function filterElderActivity(
  items: ActivityItem[],
  elderId: string,
  filter: ActivityFilter,
) {
  if (activityFilterError(filter)) return []
  const start = filter.start
    ? Date.parse(filter.start + 'T00:00:00+08:00')
    : -Infinity
  const end = filter.end
    ? Date.parse(filter.end + 'T00:00:00+08:00') + 86400000
    : Infinity
  return items
    .filter(
      (item) =>
        item.elderId === elderId &&
        (!filter.type || item.type === filter.type) &&
        ((!filter.start && !filter.end) ||
          (item.timestamp !== null &&
            item.timestamp >= start &&
            item.timestamp < end)),
    )
    .sort(
      (a, b) =>
        (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity) ||
        a.key.localeCompare(b.key),
    )
}
export function activityReferencePath(reference: ActivityReference): string {
  const base = {
    record: '/records/',
    task: '/tasks/',
    handover: '/handovers/',
    incident: '/incidents/',
    memory: '/memories/',
    family: '/family/cases/',
    other: '/audit-events/',
  }
  return (
    base[reference.type] +
    encodeURIComponent(reference.parentId || reference.id)
  )
}

const fields: Partial<Record<ActivityType, [string, string][]>> = {
  record: [
    ['happened_at', '发生'],
    ['created_at', '录入'],
    ['updated_at', '更新'],
  ],
  task: [
    ['updated_at', '更新'],
    ['completed_at', '完成'],
    ['created_at', '创建'],
  ],
  handover: [
    ['received_at', '接收'],
    ['submitted_at', '交班提交'],
    ['created_at', '交班创建'],
  ],
  incident: [
    ['occurred_at', '发生'],
    ['created_at', '上报'],
  ],
  memory: [
    ['updated_at', '更新'],
    ['confirmed_at', '确认'],
    ['created_at', '创建'],
  ],
  family: [['created_at', '建立']],
  other: [['created_at', '登记']],
}
function makeItem(
  type: ActivityType,
  row: Row,
  elderId: string,
  parent?: Row,
): ActivityItem | null {
  const id = string(row.id)
  if (
    !id.trim() ||
    row.elder_id !== elderId ||
    (type === 'handover' && !string(parent?.id).trim())
  )
    return null
  const times = (fields[type] ?? []).flatMap(([field, label]) => {
    const value = string(
      row[field] ?? (type === 'handover' ? parent?.[field] : undefined),
    )
    return value ? [{ label, value, timestamp: activityTimestamp(value) }] : []
  })
  const reference: ActivityReference = {
    type,
    id,
    ...(parent ? { parentId: string(parent.id) } : {}),
  }
  const sourceId =
    type === 'memory'
      ? string(object(row.source)?.record_id)
      : type === 'handover'
        ? string(row.source_id)
        : string(row.source_record_id)
  const sourceType = type === 'handover' ? row.kind : 'record'
  const source: ActivityReference | undefined =
    sourceId && (sourceType === 'task' || sourceType === 'record')
      ? { type: sourceType, id: sourceId }
      : undefined
  const evidenceSources: ActivityReference[] =
    type === 'incident' && Array.isArray(row.evidence)
      ? row.evidence.flatMap((value) => {
          const evidence = object(value)
          const recordId = string(evidence?.record_id)
          return recordId.trim() &&
            (evidence?.elder_id == null || evidence.elder_id === elderId)
            ? [{ type: 'record' as const, id: recordId }]
            : []
        })
      : []
  const sources = [
    ...new Map(
      [...(source ? [source] : []), ...evidenceSources].map((reference) => [
        reference.type + ':' + reference.id,
        reference,
      ]),
    ).values(),
  ]
  const replayId =
    type === 'task' || type === 'record'
      ? id
      : type === 'handover'
        ? source?.id
        : undefined
  return {
    key: `${type}:${string(parent?.id)}:${id}`,
    elderId,
    type,
    title: string(row.title) || activityTypes[type],
    text: string(
      type === 'record'
        ? row.raw_text
        : type === 'handover'
          ? row.detail
          : type === 'incident'
            ? row.description
            : type === 'memory'
              ? row.content
              : row.result,
    ),
    status: string(row.status),
    times,
    timestamp: times.find((time) => time.timestamp !== null)?.timestamp ?? null,
    reference,
    source,
    sources,
    ...(type === 'task'
      ? { detailUrl: '/tasks/' + encodeURIComponent(id) }
      : {}),
    ...(replayId
      ? { replayUrl: '/timeline/' + encodeURIComponent(replayId) }
      : {}),
  }
}
export function elderActivityItems(
  type: ActivityType,
  rows: unknown,
  elderId: string,
): ActivityItem[] {
  if (!Array.isArray(rows) || rows.some((row) => !object(row)))
    throw new Error('活动列表格式异常')
  const items: ActivityItem[] = []
  for (const row of rows as Row[]) {
    if (type === 'handover') {
      if (!Array.isArray(row.items)) throw new Error('交班事项格式异常')
      for (const value of row.items) {
        const child = object(value)
        if (!child) throw new Error('交班事项格式异常')
        // The parent summary may mention other elders. Only project this item.
        if (child.handover_id != null && child.handover_id !== row.id) continue
        const item = makeItem(type, child, elderId, row)
        if (item) items.push(item)
      }
    } else {
      const item = makeItem(type, row, elderId)
      if (item) items.push(item)
    }
  }
  return [...new Map(items.map((item) => [item.key, item])).values()]
}
export function demoElderActivity(
  tasks: Task[],
  elderId: string,
): ActivityItem[] {
  return tasks
    .filter((task) => task.elderId === elderId)
    .map((task) => ({
      key: 'demo-task:' + task.id,
      elderId,
      type: 'task',
      title: task.title,
      text: task.result || '',
      status: task.status,
      times: [],
      timestamp: null,
      reference: { type: 'task', id: task.id },
      sources: [],
      detailUrl: '/tasks/' + encodeURIComponent(task.id),
      ...(task.itemId
        ? { replayUrl: '/timeline/' + encodeURIComponent(task.itemId) }
        : {}),
    }))
}

type Slot = {
  status: 'pending' | 'ready' | 'error' | 'denied'
  items: ActivityItem[]
}
interface ActivityState {
  elderId: string
  status: 'idle' | 'pending' | 'ready' | 'partial' | 'error' | 'denied'
  slots: Partial<Record<ActivityType, Slot>>
}
export function activityLoadStatus(
  slots: ActivityState['slots'],
): ActivityState['status'] {
  const rows = Object.values(slots)
  if (rows.some((slot) => slot.status === 'pending')) return 'pending'
  const failed = rows.filter((slot) => slot.status !== 'ready').length
  return !rows.length
    ? 'idle'
    : !failed
      ? 'ready'
      : failed === rows.length
        ? 'error'
        : 'partial'
}
function allowed(
  session: FrontendSession | null,
  mode: AppMode,
): session is FrontendSession {
  return (
    !!session &&
    session.mode === mode &&
    !!session.accountKey &&
    ['admin', 'supervisor', 'caregiver'].includes(session.role || '') &&
    (mode === 'demo' || !!session.accessToken?.trim())
  )
}
function status(error: unknown) {
  return object(error)?.status
}
export function createElderActivity(deps: {
  list: (path: string) => Promise<unknown>
  request: (path: string) => Promise<unknown>
  session: () => FrontendSession | null
  demoTasks: () => Promise<Task[]>
}) {
  const state = shallowRef<ActivityState>({
    elderId: '',
    status: 'idle',
    slots: {},
  })
  const detail = shallowRef<{
    status: 'idle' | 'pending' | 'ready' | 'error'
    item?: ActivityItem
  }>({ status: 'idle' })
  let generation = 0
  let detailGeneration = 0
  let owner: FrontendSession | null = null
  function clear(denied = false) {
    generation++
    detailGeneration++
    owner = null
    state.value = { elderId: '', status: denied ? 'denied' : 'idle', slots: {} }
    detail.value = { status: 'idle' }
  }
  function current(ticket: number) {
    if (ticket !== generation) return false
    if (!sameCareSession(owner, deps.session())) {
      clear(true)
      return false
    }
    return true
  }
  function closeDetail() {
    detailGeneration++
    detail.value = { status: 'idle' }
  }
  async function load(elderId: string, mode: AppMode) {
    clear()
    const session = deps.session()
    if (!allowed(session, mode)) {
      clear(true)
      return
    }
    if (!elderId.trim()) return
    owner = { ...session }
    const ticket = generation
    state.value = { elderId, status: 'pending', slots: {} }
    if (mode === 'demo') {
      try {
        const tasks = await deps.demoTasks()
        if (current(ticket))
          state.value = {
            elderId,
            status: 'ready',
            slots: {
              task: {
                status: 'ready',
                items: demoElderActivity(tasks, elderId),
              },
            },
          }
      } catch {
        if (current(ticket))
          state.value = {
            elderId,
            status: 'error',
            slots: { task: { status: 'error', items: [] } },
          }
      }
      return
    }
    const query = '?elder_id=' + encodeURIComponent(elderId)
    const paths: Record<Exclude<ActivityType, 'family' | 'other'>, string> = {
      record: '/records' + query,
      task: '/tasks' + query,
      handover: '/handovers',
      incident: '/incidents' + query,
      memory: '/memories' + query,
    }
    state.value = {
      elderId,
      status: 'pending',
      slots: Object.fromEntries(
        Object.keys(paths).map((type) => [
          type,
          { status: 'pending', items: [] },
        ]),
      ),
    }
    await Promise.all(
      (Object.keys(paths) as Exclude<ActivityType, 'family' | 'other'>[]).map(
        async (type) => {
          let slot: Slot
          try {
            const rows = await deps.list(paths[type])
            if (!current(ticket)) return
            slot = {
              status: 'ready',
              items: elderActivityItems(type, rows, elderId),
            }
          } catch (error) {
            if (!current(ticket)) return
            if (status(error) === 401) {
              clear(true)
              return
            }
            slot = {
              status: status(error) === 403 ? 'denied' : 'error',
              items: [],
            }
          }
          if (!current(ticket)) return
          const slots = { ...state.value.slots, [type]: slot }
          state.value = { elderId, slots, status: activityLoadStatus(slots) }
        },
      ),
    )
  }
  async function openDetail(reference: ActivityReference) {
    closeDetail()
    const ticket = generation
    if (!current(ticket) || owner?.mode !== 'api' || !state.value.elderId)
      return
    const detailTicket = detailGeneration
    const elderId = state.value.elderId
    detail.value = { status: 'pending' }
    try {
      const value = await deps.request(activityReferencePath(reference))
      if (!current(ticket) || detailTicket !== detailGeneration) return
      const row = object(value)
      if (!row || row.id !== (reference.parentId || reference.id))
        throw new Error('详情编号不匹配')
      const item = elderActivityItems(reference.type, [row], elderId).find(
        (item) => item.reference.id === reference.id,
      )
      if (!item) throw new Error('详情老人不匹配')
      detail.value = { status: 'ready', item }
    } catch (error) {
      if (!current(ticket)) return
      if (status(error) === 401) {
        clear(true)
        return
      }
      if (detailTicket === detailGeneration) detail.value = { status: 'error' }
    }
  }
  return { state, detail, load, openDetail, closeDetail, clear }
}

export interface ElderTimelineFilter {
  type: ActivityType | ''
  start: string
  end: string
}
export interface ElderTimelineState {
  elderId: string
  status: 'idle' | 'pending' | 'ready' | 'error' | 'denied'
  items: ActivityItem[]
  total: number
  hasMore: boolean
  notice: string
}
const timelineEventTypes = new Set<ActivityType>(
  Object.keys(activityTypes) as ActivityType[],
)
function timelineItem(value: unknown, elderId: string): ActivityItem {
  const row = object(value)
  if (
    !row ||
    typeof row.id !== 'string' ||
    !row.id.trim() ||
    typeof row.source_id !== 'string' ||
    !row.source_id.trim() ||
    typeof row.label !== 'string' ||
    !row.label.trim() ||
    typeof row.event_type !== 'string' ||
    !timelineEventTypes.has(row.event_type as ActivityType) ||
    typeof row.action !== 'string' ||
    typeof row.detail !== 'string' ||
    typeof row.actor !== 'string'
  )
    throw new Error('老人时间线数据格式异常')
  const type = row.event_type as ActivityType
  const recordedAt =
    typeof row.recorded_at === 'string' ? row.recorded_at : row.entered_at
  const happenedAt = row.happened_at
  const times = [
    ...(typeof recordedAt === 'string'
      ? [
          {
            label: '登记',
            value: recordedAt,
            timestamp: activityTimestamp(recordedAt),
          },
        ]
      : []),
    ...(typeof happenedAt === 'string'
      ? [
          {
            label: '实际发生',
            value: happenedAt,
            timestamp: activityTimestamp(happenedAt),
          },
        ]
      : []),
  ]
  const sourceId = row.source_id
  const directActions: Partial<Record<ActivityType, string[]>> = {
    record: [
      'create_manual_record',
      'create_photo_record',
      'correct_record',
      'review_record_impact',
    ],
    task: [
      'create_task',
      'update_task',
      'complete_task',
      'task_start',
      'task_not_done',
      'task_transfer',
      'task_cancel',
      'task_reopen',
      'create_plan_task',
      'reissue_plan_task',
    ],
    incident: ['report_incident', 'triage_incident', 'reopen_incident'],
    memory: [
      'create_memory',
      'confirm_memory',
      'reject_memory',
      'memory_keep',
      'memory_suspend',
      'memory_resume',
    ],
  }
  const direct = directActions[type]?.includes(row.action) === true
  return {
    key: String(row.id),
    elderId,
    type,
    title: row.label,
    text: row.detail,
    status: row.action,
    actor: row.actor,
    times,
    timestamp: times[0]?.timestamp ?? null,
    reference: { type, id: sourceId },
    sources: [],
    detailAvailable: direct,
    ...(type === 'task' && direct
      ? { detailUrl: '/tasks/' + encodeURIComponent(sourceId) }
      : {}),
    ...(direct
      ? { replayUrl: '/timeline/' + encodeURIComponent(sourceId) }
      : {}),
  }
}
export function createElderTimeline(deps: {
  request: (path: string) => Promise<unknown>
  session: () => FrontendSession | null
}) {
  const state = shallowRef<ElderTimelineState>({
    elderId: '',
    status: 'idle',
    items: [],
    total: 0,
    hasMore: false,
    notice: '',
  })
  const detail = shallowRef<{
    status: 'idle' | 'pending' | 'ready' | 'error'
    item?: ActivityItem
  }>({ status: 'idle' })
  let generation = 0,
    detailGeneration = 0
  let owner: FrontendSession | null = null
  let lastFilter: ElderTimelineFilter = { type: '', start: '', end: '' }
  const clear = (denied = false) => {
    generation++
    detailGeneration++
    owner = null
    state.value = {
      elderId: '',
      status: denied ? 'denied' : 'idle',
      items: [],
      total: 0,
      hasMore: false,
      notice: '',
    }
    detail.value = { status: 'idle' }
  }
  const current = (ticket: number) => {
    if (ticket !== generation) return false
    if (!sameCareSession(owner, deps.session())) {
      clear(true)
      return false
    }
    return true
  }
  async function load(
    elderId: string,
    filter: ElderTimelineFilter,
    append = false,
  ) {
    if (
      append &&
      (state.value.status === 'pending' ||
        state.value.elderId !== elderId ||
        JSON.stringify(filter) !== JSON.stringify(lastFilter))
    )
      return
    if (activityFilterError(filter)) {
      clear()
      return
    }
    if (!append) clear()
    const session = deps.session()
    if (!allowed(session, 'api')) {
      clear(true)
      return
    }
    if (!elderId.trim()) return
    owner = { ...session }
    lastFilter = { ...filter }
    const ticket = append ? generation : ++generation
    const offset = append ? state.value.items.length : 0
    state.value = { ...state.value, elderId, status: 'pending' }
    const query = new URLSearchParams({ limit: '100', offset: String(offset) })
    if (filter.type) query.append('event_type', filter.type)
    if (filter.start)
      query.set(
        'start',
        new Date(filter.start + 'T00:00:00+08:00').toISOString(),
      )
    if (filter.end)
      query.set(
        'end',
        new Date(
          new Date(filter.end + 'T00:00:00+08:00').getTime() + 86400000,
        ).toISOString(),
      )
    try {
      const response = object(
        await deps.request(
          `/elders/${encodeURIComponent(elderId)}/timeline?${query}`,
        ),
      )
      if (!current(ticket)) return
      if (
        !response ||
        response.elder_id !== elderId ||
        !Array.isArray(response.events) ||
        !Number.isSafeInteger(response.total) ||
        Number(response.total) < 0 ||
        response.offset !== offset ||
        response.limit !== 100 ||
        typeof response.has_more !== 'boolean' ||
        typeof response.notice !== 'string'
      )
        throw new Error('老人时间线数据格式异常')
      const rows = response.events.map((row) => timelineItem(row, elderId))
      if (
        rows.length > 100 ||
        offset + rows.length > Number(response.total) ||
        rows.some((row) => row.times[0]?.label !== '登记')
      )
        throw new Error('老人时间线缺少登记时间或分页异常')
      if (response.has_more !== offset + rows.length < Number(response.total))
        throw new Error('老人时间线分页状态不一致')
      const merged = append ? [...state.value.items, ...rows] : rows
      const unique = [...new Map(merged.map((row) => [row.key, row])).values()]
      if (unique.length !== offset + rows.length)
        throw new Error('老人时间线分页包含重复事件')
      state.value = {
        elderId,
        status: 'ready',
        items: unique,
        total: Number(response.total),
        hasMore: response.has_more,
        notice: response.notice,
      }
    } catch (error) {
      if (!current(ticket)) return
      const code = status(error)
      if (code === 401 || code === 403) {
        clear(true)
        return
      }
      state.value = {
        ...state.value,
        status: code === 403 ? 'denied' : 'error',
      }
    }
  }
  function loadMore() {
    if (state.value.hasMore && state.value.status !== 'pending')
      return load(state.value.elderId, lastFilter, true)
  }
  function retry() {
    return load(state.value.elderId, lastFilter, state.value.items.length > 0)
  }
  async function openDetail(reference: ActivityReference) {
    const pathByType: Partial<Record<ActivityType, string>> = {
      record: '/records/',
      task: '/tasks/',
      incident: '/incidents/',
      memory: '/memories/',
    }
    const prefix = pathByType[reference.type]
    if (!prefix || !current(generation)) return
    const generationTicket = generation
    const ticket = ++detailGeneration
    detail.value = { status: 'pending' }
    try {
      const value = object(
        await deps.request(prefix + encodeURIComponent(reference.id)),
      )
      if (!current(generationTicket) || ticket !== detailGeneration) return
      if (
        !value ||
        value.id !== reference.id ||
        value.elder_id !== state.value.elderId
      )
        throw new Error('详情来源不匹配')
      const type = reference.type as Exclude<ActivityType, 'family' | 'other'>
      const item = elderActivityItems(type, [value], state.value.elderId).find(
        (row) => row.reference.id === reference.id,
      )
      if (!item) throw new Error('详情来源不匹配')
      detail.value = { status: 'ready', item }
    } catch (error) {
      if (!current(generationTicket) || ticket !== detailGeneration) return
      if (status(error) === 401 || status(error) === 403) {
        clear(true)
        return
      }
      detail.value = { status: 'error' }
    }
  }
  return {
    state,
    detail,
    load,
    loadMore,
    retry,
    openDetail,
    closeDetail: () => {
      detailGeneration++
      detail.value = { status: 'idle' }
    },
    clear,
  }
}
