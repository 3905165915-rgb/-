import type { DemoState } from './demo'
import type { DemoRecord, Task } from './types'

export const demoMetricLabels = {
  scheduled: '应执行',
  completed: '已完成',
  notDone: '未执行',
  pending: '待处理',
} as const
export type DemoMetricKey = keyof typeof demoMetricLabels

// Optional while the demo seed/store is being upgraded by its owner.
export interface DemoMemoryReview {
  id: string
  elderId: string
  memoryId: string
  itemId: string
  status: 'pending' | 'awaiting_review' | 'closed'
  description: string
  revision: number
}
type MetricsState = Pick<DemoState, 'elders' | 'tasks'> & {
  demoDay?: string
  memoryReviews?: readonly DemoMemoryReview[]
}
const pendingStatuses = new Set([
  'pending',
  'in_progress',
  'transferred',
  'overdue',
])
const knownStatuses = new Set([
  ...pendingStatuses,
  'completed',
  'not_done',
  'cancelled',
])
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export function beijingDay(value: number | Date): string {
  const parts = dayFormatter.formatToParts(value)
  return ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join('-')
}
function validDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}
// Never interpret a timezone-less timestamp in the browser's local zone.
export function demoTimestamp(value: string | undefined): number | null {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !validDay(value.slice(0, 10))
  )
    return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}
export function demoTime(value: string | undefined): string {
  const timestamp = demoTimestamp(value)
  return timestamp === null
    ? '时间待核实'
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(timestamp)
}
export function buildDemoMetrics(
  state: MetricsState | undefined,
  elderId: string,
  now = Date.now(),
) {
  if (!state || !state.elders.some((elder) => elder.id === elderId)) return null
  // An explicitly invalid demoDay is unknown; only older snapshots use the clock.
  const day = state.demoDay === undefined ? beijingDay(now) : state.demoDay
  if (!validDay(day)) return null
  const elderTasks = state.tasks.filter((task) => task.elderId === elderId)
  const unknownContent = elderTasks.filter(
    (task) =>
      task.contentType !== undefined &&
      !['routine_hint', 'one_off_reminder', 'followup_task'].includes(
        task.contentType,
      ),
  )
  const tasks = elderTasks.filter(
    (task) =>
      task.contentType === undefined || task.contentType === 'followup_task',
  )
  const dated = tasks.map((task) => ({
    task,
    timestamp: demoTimestamp(task.executionAt),
  }))
  const undated = dated
    .filter((row) => row.timestamp === null && row.task.status !== 'cancelled')
    .map((row) => row.task)
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${day}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - 6 + index)
    const target = date.toISOString().slice(0, 10)
    const rows = dated
      .filter(
        (row) => row.timestamp !== null && beijingDay(row.timestamp) === target,
      )
      .map((row) => row.task)
      .sort(
        (a, b) =>
          demoTimestamp(a.executionAt)! - demoTimestamp(b.executionAt)! ||
          a.id.localeCompare(b.id),
      )
    const groups: Record<DemoMetricKey, Task[]> = {
      scheduled: rows.filter((task) => task.status !== 'cancelled'),
      completed: rows.filter((task) => task.status === 'completed'),
      notDone: rows.filter((task) => task.status === 'not_done'),
      pending: rows.filter((task) => pendingStatuses.has(task.status)),
    }
    const uncertain =
      undated.length > 0 ||
      unknownContent.length > 0 ||
      rows.some((task) => !knownStatuses.has(task.status))
    const counts: Record<DemoMetricKey, number | null> = {
      scheduled: uncertain ? null : groups.scheduled.length,
      completed: uncertain ? null : groups.completed.length,
      notDone: uncertain ? null : groups.notDone.length,
      pending: uncertain ? null : groups.pending.length,
    }
    return { day: target, rows, groups, counts }
  })
  const reviews = state.memoryReviews?.filter(
    (review) => review.elderId === elderId,
  )
  const openReviews = reviews?.filter((review) =>
    ['pending', 'awaiting_review'].includes(review.status),
  )
  const reviewCount =
    reviews === undefined ||
    reviews.some(
      (review) =>
        !['pending', 'awaiting_review', 'closed'].includes(review.status),
    )
      ? null
      : openReviews!.length
  return { day, today: trend[6], trend, undated, openReviews, reviewCount }
}
/** Demo only: the named seed is the authorized family view, never an API ACL. */
export function familyDemoRecords(
  state: Pick<DemoState, 'elders' | 'records'> | undefined,
): DemoRecord[] {
  if (!state) return []
  const elders = state.elders.filter((elder) => elder.name === '王爷爷')
  if (elders.length !== 1) return []
  return state.records
    .filter(
      (record) =>
        record.elderId === elders[0].id && record.familyVisible === true,
    )
    .slice()
    .sort((a, b) => {
      const left = demoTimestamp(a.happenedAt),
        right = demoTimestamp(b.happenedAt)
      if (left === null || right === null)
        return left === right
          ? a.id.localeCompare(b.id)
          : left === null
            ? 1
            : -1
      return (
        right - left ||
        (demoTimestamp(b.enteredAt) ?? 0) - (demoTimestamp(a.enteredAt) ?? 0) ||
        a.id.localeCompare(b.id)
      )
    })
}
