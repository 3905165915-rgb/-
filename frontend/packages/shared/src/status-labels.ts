import type {
  AiDraftStatus,
  FamilyCaseStatus,
  HandoverStatus,
  TaskStatus,
} from './statuses'
import type { HandoverItem } from './types'

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export interface StatusMeta {
  readonly label: string
  readonly tone: StatusTone
}

export const taskStatusMeta: Readonly<Record<TaskStatus, StatusMeta>> = {
  pending: { label: '待处理', tone: 'warning' },
  in_progress: { label: '进行中', tone: 'info' },
  completed: { label: '已完成', tone: 'success' },
  not_done: { label: '未执行', tone: 'danger' },
  transferred: { label: '已转交', tone: 'info' },
  cancelled: { label: '已取消', tone: 'neutral' },
  overdue: { label: '已逾期', tone: 'danger' },
}

export const familyCaseStatusMeta: Readonly<
  Record<FamilyCaseStatus, StatusMeta>
> = {
  received: { label: '已受理', tone: 'info' },
  verifying: { label: '核实中', tone: 'warning' },
  replied: { label: '已回复', tone: 'success' },
  continuing: { label: '持续跟进', tone: 'info' },
  closed: { label: '已关闭', tone: 'neutral' },
}

export const aiDraftStatusMeta: Readonly<Record<AiDraftStatus, StatusMeta>> = {
  generating: { label: '生成中', tone: 'info' },
  pending_review: { label: '待审核', tone: 'warning' },
  confirmed: { label: '已确认', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'neutral' },
  failed: { label: '生成失败', tone: 'danger' },
}

export const handoverStatusMeta: Readonly<Record<HandoverStatus, StatusMeta>> =
  {
    draft: { label: '草稿', tone: 'neutral' },
    submitted: { label: '已提交', tone: 'info' },
    received: { label: '已接收', tone: 'success' },
    clarifying: { label: '需澄清', tone: 'warning' },
    closed: { label: '已关闭', tone: 'neutral' },
  }

// HandoverItem currently uses display values, independently of the lifecycle enum.
export const handoverDisplayStatusMeta: Readonly<
  Record<HandoverItem['status'], StatusMeta>
> = {
  待接收: { label: '待接收', tone: 'warning' },
  已接收: { label: '已接收', tone: 'success' },
  需澄清: { label: '需澄清', tone: 'warning' },
}

export const unknownStatusMeta: StatusMeta = {
  label: '状态待核实',
  tone: 'warning',
}

export function isKnownStatus<T extends string>(
  dictionary: Readonly<Record<T, StatusMeta>>,
  status: unknown,
): status is T {
  return typeof status === 'string' && Object.hasOwn(dictionary, status)
}

export function resolveStatus<T extends string>(
  dictionary: Readonly<Record<T, StatusMeta>>,
  status: unknown,
) {
  const known = isKnownStatus(dictionary, status)
  const meta = known ? dictionary[status] : unknownStatusMeta
  // This guard supplements, rather than replaces, each action's lifecycle rules.
  return { ...meta, known, rawStatus: status, writeBlocked: !known }
}

function labelsFor<T extends string>(
  dictionary: Readonly<Record<T, StatusMeta>>,
) {
  const labels = Object.fromEntries(
    Object.entries<StatusMeta>(dictionary).map(([status, meta]) => [
      status,
      meta.label,
    ]),
  ) as Record<T, string> & Record<string, string>
  // Existing pages index this map directly; only declared statuses are enumerated
  // as filter options, while legacy cache values still receive the safe fallback.
  return new Proxy(Object.freeze(labels), {
    get(target, key, receiver) {
      if (typeof key === 'string' && !Object.hasOwn(target, key))
        return unknownStatusMeta.label
      return Reflect.get(target, key, receiver)
    },
  })
}

export const taskStatusLabels = labelsFor(taskStatusMeta)
