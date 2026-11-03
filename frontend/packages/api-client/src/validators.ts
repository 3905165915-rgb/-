import {
  aiDraftStatuses,
  familyCaseStatuses,
  handoverDisplayStatusMeta,
  normalizeRole,
  taskStatuses,
  type Elder,
  type FamilyCase,
  type HandoverItem,
  type RecordDraft,
  type Task,
  type TimelineEvent,
  isCareContentType,
} from '@hulao/shared'
import { ContractError } from './errors'
import type { LoginResponse } from './index'
import type { InlineRecordEnvelope } from './types'

export type Parser<T> = (value: unknown, endpoint: string, path?: string) => T

export function parseInlineRecordResponse(
  value: unknown,
  elderId: string,
  endpoint = 'POST /elders/:id/record',
): InlineRecordEnvelope {
  const envelope = object(value, endpoint, '$')
  const record = object(envelope.record, endpoint, '$.record')
  strings(
    record,
    ['id', 'elder_id', 'status', 'raw_text', 'admission_id', 'created_at'],
    endpoint,
    '$.record',
    true,
  )
  if (
    record.elder_id !== elderId ||
    !['confirmed', 'corrected'].includes(String(record.status)) ||
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) < 1 ||
    !Number.isFinite(Date.parse(String(record.created_at))) ||
    (record.happened_at != null &&
      !Number.isFinite(Date.parse(String(record.happened_at))))
  )
    invalid(endpoint, '$.record', '正式记录编号、老人、状态、版本或时间无效')
  enumeration(
    envelope.analysis_status,
    ['ready', 'failed', 'confirmed', 'queued', 'processing'],
    endpoint,
    '$.analysis_status',
  )
  if (
    ['failed', 'queued', 'processing'].includes(
      String(envelope.analysis_status),
    ) &&
    envelope.analysis === null
  )
    return envelope as unknown as InlineRecordEnvelope
  const analysis = object(envelope.analysis, endpoint, '$.analysis')
  strings(
    analysis,
    ['id', 'record_id', 'status', 'created_at'],
    endpoint,
    '$.analysis',
    true,
  )
  if (
    analysis.record_id !== record.id ||
    analysis.record_revision !== record.revision ||
    !['ready', 'confirmed'].includes(String(analysis.status)) ||
    !Number.isFinite(Date.parse(String(analysis.created_at)))
  )
    invalid(endpoint, '$.analysis', '分析必须对应当前正式记录版本')
  const sourceText = String(record.raw_text)
  const cited = (value: unknown, path: string) => {
    const quote = object(value, endpoint, path)
    enumeration(
      quote.source_field,
      ['raw_text', 'observations'],
      endpoint,
      `${path}.source_field`,
    )
    string(quote.quote, endpoint, `${path}.quote`, true)
    const source =
      quote.source_field === 'raw_text'
        ? sourceText
        : Array.isArray(record.observations)
          ? record.observations.join('\n')
          : ''
    if (!source.includes(String(quote.quote)))
      invalid(endpoint, path, '引文不在正式记录原文中')
  }
  const scene = object(analysis.scene, endpoint, '$.analysis.scene')
  if (scene.citation !== null)
    cited(scene.citation, '$.analysis.scene.citation')
  for (const [index, item] of (Array.isArray(analysis.observations)
    ? analysis.observations
    : []
  ).entries()) {
    const observation = object(
      item,
      endpoint,
      `$.analysis.observations[${index}]`,
    )
    strings(
      observation,
      ['id', 'text'],
      endpoint,
      `$.analysis.observations[${index}]`,
      true,
    )
    cited(observation.citation, `$.analysis.observations[${index}].citation`)
  }
  for (const [field, fields] of [
    ['task_suggestions', ['id', 'title', 'evidence_text']],
    ['preference_suggestions', ['id', 'content', 'evidence_text']],
  ] as const) {
    if (!Array.isArray(analysis[field]))
      invalid(endpoint, `$.analysis.${field}`, '需要列表')
    for (const [index, item] of (analysis[field] as unknown[]).entries()) {
      const suggestion = object(item, endpoint, `$.analysis.${field}[${index}]`)
      strings(
        suggestion,
        fields,
        endpoint,
        `$.analysis.${field}[${index}]`,
        true,
      )
      if (!sourceText.includes(String(suggestion.evidence_text)))
        invalid(
          endpoint,
          `$.analysis.${field}[${index}].evidence_text`,
          '引文不在正式记录原文中',
        )
    }
  }
  return envelope as unknown as InlineRecordEnvelope
}

function invalid(endpoint: string, path: string, expected: string): never {
  throw new ContractError(
    `接口返回结构不匹配（${endpoint} ${path}）：${expected}`,
    endpoint,
    path,
  )
}

function object(
  value: unknown,
  endpoint: string,
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(endpoint, path, '需要对象')
  return value as Record<string, unknown>
}

function string(
  value: unknown,
  endpoint: string,
  path: string,
  nonempty = false,
): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.trim()))
    invalid(endpoint, path, nonempty ? '需要非空字符串' : '需要字符串')
}

function strings(
  row: Record<string, unknown>,
  fields: readonly string[],
  endpoint: string,
  path: string,
  nonempty = false,
) {
  for (const field of fields)
    string(row[field], endpoint, `${path}.${field}`, nonempty)
}

function optionalStrings(
  row: Record<string, unknown>,
  fields: readonly string[],
  endpoint: string,
  path: string,
  nonempty = false,
) {
  for (const field of fields) {
    if (row[field] !== undefined)
      string(row[field], endpoint, `${path}.${field}`, nonempty)
  }
}

function enumeration(
  value: unknown,
  allowed: readonly string[],
  endpoint: string,
  path: string,
) {
  if (typeof value !== 'string' || !allowed.includes(value))
    invalid(endpoint, path, '未知枚举值')
}

function stringArray(value: unknown, endpoint: string, path: string) {
  if (!Array.isArray(value)) invalid(endpoint, path, '需要字符串数组')
  for (let index = 0; index < value.length; index++)
    string(value[index], endpoint, `${path}[${index}]`)
}

function validClock(hour: string, minute: string, second = '0') {
  return Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
}

function validCalendar(year: string, month: string, day: string) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]!
}

function date(
  value: unknown,
  endpoint: string,
  path: string,
  mode: 'timestamp' | 'display' | 'deadline' | 'optional',
) {
  string(value, endpoint, path)
  if (
    (mode !== 'timestamp' && value === '') ||
    (mode === 'deadline' && value === '待确认期限')
  )
    return
  // Validate calendar/clock parts explicitly; Date.parse may normalize invalid
  // days and would obscure the original local/offset/relative display semantics.
  const relative = /^(今天|昨天|明天) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (relative && validClock(relative[2]!, relative[3]!, relative[4])) return
  const absolute =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/.exec(
      value,
    )
  if (absolute && validCalendar(absolute[1]!, absolute[2]!, absolute[3]!)) {
    const hasTime = absolute[4] !== undefined
    const validTime =
      !hasTime || validClock(absolute[4]!, absolute[5]!, absolute[6])
    const validOffset =
      absolute[7] === undefined || validClock(absolute[8]!, absolute[9]!)
    const allowsDateOnly = mode === 'display' || mode === 'deadline'
    if (validTime && validOffset && (hasTime || allowsDateOnly)) return
  }
  invalid(endpoint, path, '日期或时间格式无效')
}

export function parseList<T extends { id: string }>(
  value: unknown,
  endpoint: string,
  parse: Parser<T>,
): T[] {
  if (!Array.isArray(value)) invalid(endpoint, '$', '需要数组')
  const ids = new Set<string>()
  const rows: T[] = []
  for (let index = 0; index < value.length; index++) {
    const path = `$[${index}]`
    const row = parse(value[index], endpoint, path)
    if (ids.has(row.id)) invalid(endpoint, `${path}.id`, '编号重复')
    ids.add(row.id)
    rows.push(row)
  }
  return rows
}

export const parseElder: Parser<Elder> = (value, endpoint, path = '$') => {
  const wire = object(value, endpoint, path)
  if (
    'bed_id' in wire ||
    ['pending', 'active', 'out', 'discharged'].includes(String(wire.status))
  ) {
    enumeration(
      wire.status,
      ['pending', 'active', 'out', 'discharged'],
      endpoint,
      `${path}.status`,
    )
    if (wire.bed_id !== null && wire.bed_id !== undefined)
      string(wire.bed_id, endpoint, `${path}.bed_id`)
    if (wire.bed_label != null)
      string(wire.bed_label, endpoint, `${path}.bed_label`)
    value = {
      ...wire,
      bedLabel: wire.bed_label ?? '',
      status: (
        {
          pending: '待入住',
          active: '入住',
          out: '外出',
          discharged: '离院',
        } as Record<string, string>
      )[String(wire.status)],
      contact: wire.contact_name ?? '',
      notes: wire.notes ?? '',
    }
  }
  const row = object(value, endpoint, path)
  strings(row, ['id', 'name'], endpoint, path, true)
  strings(row, ['bedLabel'], endpoint, path)
  optionalStrings(row, ['contact', 'notes'], endpoint, path)
  if (
    row.age !== undefined &&
    (typeof row.age !== 'number' || !Number.isInteger(row.age) || row.age < 0)
  )
    invalid(endpoint, `${path}.age`, '需要非负整数')
  enumeration(
    row.status,
    ['待入住', '入住', '外出', '离院'],
    endpoint,
    `${path}.status`,
  )
  if (row.risk !== undefined)
    enumeration(row.risk, ['低', '中', '高'], endpoint, `${path}.risk`)
  if (row.lastUpdate !== undefined)
    date(row.lastUpdate, endpoint, `${path}.lastUpdate`, 'display')
  return value as Elder
}

export const parseTask: Parser<Task> = (value, endpoint, path = '$') => {
  const wire = object(value, endpoint, path)
  const wireContentType = Object.hasOwn(wire, 'content_type')
    ? wire.content_type
    : wire.contentType
  if (wireContentType !== undefined && !isCareContentType(wireContentType))
    invalid(endpoint, `${path}.content_type`, '未知照护内容类型')
  if ('elder_id' in wire)
    value = {
      ...wire,
      elderId: wire.elder_id,
      shift: wire.shift_name ?? '',
      assignee: wire.assignee_name ?? '',
      elderName: wire.elder_name ?? '',
      bedLabel: wire.bed_label ?? '',
      scheduledAt: wire.scheduled_at ?? '',
      dueAt: wire.due_at ?? '',
      result: wire.result ?? '',
      itemId: wire.id,
      assigneeName:
        typeof wire.assigned_name === 'string' ? wire.assigned_name : undefined,
      shiftName:
        typeof wire.shift_name === 'string' ? wire.shift_name : undefined,
      contentType: wireContentType,
      executionAt: wire.execution_at ?? wire.executionAt,
      deadlineAt: wire.deadline_at ?? wire.deadlineAt,
    }
  const row = object(value, endpoint, path)
  strings(row, ['id', 'elderId', 'title'], endpoint, path, true)
  strings(row, ['shift', 'assignee'], endpoint, path)
  enumeration(row.status, taskStatuses, endpoint, `${path}.status`)
  date(row.dueAt, endpoint, `${path}.dueAt`, 'deadline')
  optionalStrings(row, ['result'], endpoint, path)
  optionalStrings(row, ['itemId'], endpoint, path, true)
  optionalStrings(
    row,
    [
      'nameSnapshot',
      'bedSnapshot',
      'assigneeName',
      'shiftName',
      'sourceRecordId',
    ],
    endpoint,
    path,
    true,
  )
  for (const field of ['executionAt', 'deadlineAt']) {
    if (row[field] !== undefined)
      date(row[field], endpoint, `${path}.${field}`, 'timestamp')
  }
  if (row.scene !== undefined)
    enumeration(
      row.scene,
      ['bathing', 'activity', 'rest', 'dining', 'communication', 'other'],
      endpoint,
      `${path}.scene`,
    )
  if (row.contentType !== undefined && !isCareContentType(row.contentType))
    invalid(endpoint, `${path}.contentType`, '未知照护内容类型')
  return value as Task
}

export const parseHandoverItem: Parser<HandoverItem> = (
  value,
  endpoint,
  path = '$',
) => {
  const row = object(value, endpoint, path)
  strings(row, ['id', 'title'], endpoint, path, true)
  strings(row, ['detail', 'owner'], endpoint, path)
  enumeration(
    row.status,
    Object.keys(handoverDisplayStatusMeta),
    endpoint,
    `${path}.status`,
  )
  optionalStrings(row, ['itemId', 'receiverId'], endpoint, path, true)
  optionalStrings(row, ['receivedBy', 'note'], endpoint, path)
  if (row.receivedAt !== undefined)
    date(row.receivedAt, endpoint, `${path}.receivedAt`, 'optional')
  return value as HandoverItem
}

export const parseFamilyCase: Parser<FamilyCase> = (
  value,
  endpoint,
  path = '$',
) => {
  const row = object(value, endpoint, path)
  strings(row, ['id', 'elderId', 'subject'], endpoint, path, true)
  enumeration(row.status, familyCaseStatuses, endpoint, `${path}.status`)
  if (typeof row.public !== 'boolean')
    invalid(endpoint, `${path}.public`, '需要布尔值')
  optionalStrings(row, ['reply'], endpoint, path)
  return value as FamilyCase
}

export const parseTimelineEvent: Parser<TimelineEvent> = (
  value,
  endpoint,
  path = '$',
) => {
  const wire = object(value, endpoint, path)
  const serverEvent = 'happened_at' in wire || 'recorded_at' in wire
  if (serverEvent)
    value = {
      ...wire,
      happenedAt: wire.happened_at,
      enteredAt: 'recorded_at' in wire ? wire.recorded_at : wire.entered_at,
      recordedAt: 'recorded_at' in wire ? wire.recorded_at : wire.entered_at,
    }
  const row = object(value, endpoint, path)
  strings(row, ['id', 'label'], endpoint, path, true)
  strings(row, ['detail', 'actor'], endpoint, path)
  if (!serverEvent || row.happenedAt !== null)
    date(row.happenedAt, endpoint, `${path}.happenedAt`, 'timestamp')
  if (!(
    serverEvent &&
    row.enteredAt === null &&
    wire.recorded_at_status === 'unverified'
  ))
    date(row.enteredAt, endpoint, `${path}.enteredAt`, 'timestamp')
  optionalStrings(row, ['itemId'], endpoint, path, true)
  if (row.source !== undefined)
    enumeration(row.source, ['demo'], endpoint, `${path}.source`)
  return value as TimelineEvent
}

export const parseRecordDraft: Parser<RecordDraft> = (
  value,
  endpoint,
  path = '$',
) => {
  const wire = object(value, endpoint, path)
  if ('elder_id' in wire) {
    stringArray(wire.observations, endpoint, `${path}.observations`)
    if (!Array.isArray(wire.task_candidates))
      invalid(endpoint, `${path}.task_candidates`, '需要任务候选数组')
    const candidates = wire.task_candidates.map((item, i) => {
      const candidate = object(item, endpoint, `${path}.task_candidates[${i}]`)
      strings(
        candidate,
        ['title'],
        endpoint,
        `${path}.task_candidates[${i}]`,
        true,
      )
      return candidate
    })
    if (!Array.isArray(wire.evidence))
      invalid(endpoint, `${path}.evidence`, '需要证据数组')
    const evidence = wire.evidence.map((item, i) => {
      const source = object(item, endpoint, `${path}.evidence[${i}]`)
      strings(source, ['text'], endpoint, `${path}.evidence[${i}]`, true)
      return source.text
    })
    string(wire.provider, endpoint, `${path}.provider`, true)
    value = {
      ...wire,
      elderId: wire.elder_id,
      originalText: wire.raw_text,
      fields: {
        observation: (wire.observations as string[]).join('\n'),
        followUp: candidates.map((item) => item.title).join('\n'),
        contactTarget: '',
      },
      evidence,
      taskCandidates: candidates,
    }
  }
  const row = object(value, endpoint, path)
  strings(row, ['id', 'elderId'], endpoint, path, true)
  strings(row, ['originalText'], endpoint, path)
  const fields = object(row.fields, endpoint, `${path}.fields`)
  strings(
    fields,
    ['observation', 'followUp', 'contactTarget'],
    endpoint,
    `${path}.fields`,
  )
  stringArray(row.evidence, endpoint, `${path}.evidence`)
  stringArray(row.warnings, endpoint, `${path}.warnings`)
  enumeration(row.status, aiDraftStatuses, endpoint, `${path}.status`)
  return value as RecordDraft
}

export const parseLoginResponse: Parser<LoginResponse> = (
  value,
  endpoint,
  path = '$',
) => {
  const row = object(value, endpoint, path)
  strings(row, ['access_token'], endpoint, path, true)
  optionalStrings(
    row,
    ['token_type', 'user_id', 'display_name'],
    endpoint,
    path,
    true,
  )
  if (row.role !== undefined && normalizeRole(row.role) === null)
    invalid(endpoint, `${path}.role`, '未知角色')
  return value as LoginResponse
}
