import { checkResponse } from './catalogs'
import { schemas, type Row } from './model'
import { careScenes, type CareScene } from './task-care-context'

export const memoryCategories = {
  stable_preference: '稳定偏好与习惯',
  temporary_wish: '临时意愿',
  communication: '沟通方式',
  observation: '待核实观察',
}
export const memoryStates = {
  candidate: '待确认',
  confirmed: '已确认',
  review_required: '待复核',
  suspended: '已暂停',
  rejected: '已驳回',
  retired: '已停用',
}
export const expressors = {
  elder: '老人本人',
  family: '家属',
  staff: '工作人员',
  unknown: '表达者未明确',
}
export interface ElderMemory {
  id: string
  elder_id: string
  revision: number
  content: string
  category: keyof typeof memoryCategories
  status: keyof typeof memoryStates
  attributed_to: keyof typeof expressors
  scenes: CareScene[]
  source: {
    record_id: string
    revision: number
    field: 'raw_text' | 'observations'
    quote: string
    snapshot_text: string
    captured_at: string
    record_status: string
  }
  valid_from: string
  expires_at: string | null
  review_due_at: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  effective: boolean
  source_current: boolean
  review_due: boolean
  blocked_reasons: string[]
  review_state?: 'not_required' | 'pending'
  review_reasons?: string[]
  refusal_count?: number
}
function ensure(value: unknown): asserts value {
  if (!value)
    throw new Error('照护记忆数据不完整或与当前老人不匹配，请刷新核对。')
}
function date(value: unknown) {
  return (
    typeof value === 'string' &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}
export function parseElderMemories(
  value: unknown,
  elderId: string,
): ElderMemory[] {
  ensure(Array.isArray(value))
  const ids = new Set<string>()
  for (const row of value) {
    checkResponse(schemas.MemoryResponse, row)
    ensure(
      row.elder_id === elderId &&
        typeof row.id === 'string' &&
        row.id.trim() &&
        !ids.has(row.id),
    )
    ids.add(row.id)
    ensure(
      Number.isSafeInteger(row.revision) &&
        row.revision >= 1 &&
        row.content.trim(),
    )
    ensure(
      row.scenes.length &&
        new Set(row.scenes).size === row.scenes.length &&
        row.scenes.every((s: string) => Object.hasOwn(careScenes, s)),
    )
    ensure(
      Number.isSafeInteger(row.source.revision) &&
        row.source.revision >= 1 &&
        row.source.record_id.trim() &&
        row.source.quote.trim() &&
        row.source.snapshot_text.includes(row.source.quote),
    )
    ensure(
      date(row.source.captured_at) &&
        date(row.valid_from) &&
        date(row.created_at) &&
        date(row.updated_at),
    )
    for (const k of ['expires_at', 'review_due_at', 'confirmed_at'])
      ensure(row[k] === null || date(row[k]))
    ensure(row.category !== 'temporary_wish' || row.expires_at !== null)
    for (const k of ['expires_at', 'review_due_at'])
      ensure(row[k] === null || Date.parse(row[k]) > Date.parse(row.valid_from))
    ensure(
      !row.effective ||
        (row.status === 'confirmed' &&
          row.category !== 'observation' &&
          row.source_current &&
          !row.blocked_reasons.length &&
          row.confirmed_by &&
          row.confirmed_at),
    )
    if (row.refusal_count !== undefined)
      ensure(Number.isSafeInteger(row.refusal_count) && row.refusal_count >= 0)
    if (row.review_state !== undefined)
      ensure(['not_required', 'pending'].includes(row.review_state))
    if (row.review_reasons !== undefined)
      ensure(
        Array.isArray(row.review_reasons) &&
          row.review_reasons.every((r: unknown) => typeof r === 'string'),
      )
  }
  return value as ElderMemory[]
}
export function memoryGroup(
  memory: ElderMemory,
): 'current' | 'temporary' | 'review' | 'history' {
  if (['suspended', 'rejected', 'retired'].includes(memory.status))
    return 'history'
  if (
    !memory.effective ||
    memory.category === 'observation' ||
    memory.review_due ||
    memory.review_state === 'pending'
  )
    return 'review'
  return memory.category === 'temporary_wish' ? 'temporary' : 'current'
}
export interface MemoryChange {
  previous_revision: number | null
  revision: number
  action: string
  reason: string
  created_by: string
  created_at: string
  before: Row | null
  after: Row
}
export function parseMemoryHistory(
  value: unknown,
  memory: ElderMemory,
): MemoryChange[] {
  ensure(Array.isArray(value))
  const seen = new Set<number>()
  for (const row of value) {
    ensure(row && typeof row === 'object' && !Array.isArray(row))
    ensure(
      Number.isSafeInteger(row.revision) &&
        row.revision >= 1 &&
        !seen.has(row.revision),
    )
    seen.add(row.revision)
    ensure(
      row.previous_revision === null ||
        (Number.isSafeInteger(row.previous_revision) &&
          row.previous_revision >= 1 &&
          row.previous_revision < row.revision),
    )
    ensure(
      typeof row.action === 'string' &&
        typeof row.reason === 'string' &&
        typeof row.created_by === 'string' &&
        date(row.created_at),
    )
    for (const snapshot of [row.before, row.after]) {
      ensure(
        snapshot === null ||
          (typeof snapshot === 'object' &&
            !Array.isArray(snapshot) &&
            snapshot.id === memory.id &&
            snapshot.elder_id === memory.elder_id &&
            typeof snapshot.content === 'string'),
      )
    }
    ensure(row.after !== null)
    ensure(
      row.after.revision === row.revision &&
        (row.before === null
          ? row.previous_revision === null
          : row.before.revision === row.previous_revision),
    )
  }
  return value as MemoryChange[]
}
