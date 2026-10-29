import type { Row } from './model'

export const careContentTypes = [
  'routine_hint',
  'one_off_reminder',
  'followup_task',
] as const
export type CareContentType = (typeof careContentTypes)[number]

export const careContentTypeLabels: Record<CareContentType, string> = {
  routine_hint: '日常提示',
  one_off_reminder: '本次照护提醒',
  followup_task: '跟进任务',
}

export const careContentTypeDescriptions: Record<CareContentType, string> = {
  routine_hint: '在对应生活场景中提醒护理员留意，不需要每次单独打卡。',
  one_off_reminder:
    '只用于这一次照护，记录实际询问和老人回应，不形成长期习惯。',
  followup_task: '确实需要交付和追踪的事项，进入任务办理流程。',
}

export const careHintStatuses = [
  'pending',
  'enabled',
  'needs_adjustment',
  'disabled',
] as const
export type CareHintStatus = (typeof careHintStatuses)[number]

export const careHintStatusLabels: Record<CareHintStatus, string> = {
  pending: '待确认',
  enabled: '已启用',
  needs_adjustment: '需调整',
  disabled: '已停用',
}

export const careHintScenes = {
  communication: '沟通时',
  before_activity: '活动前',
  activity: '活动中',
  dining: '用餐时',
  rest: '午休时',
  bathing: '洗漱时',
  other: '其他场景',
} as const
export type CareHintScene = keyof typeof careHintScenes

export const careReminderOccasions = {
  before_activity: '本次活动前',
  after_lunch: '今天午休后',
  during_meal: '本次用餐时',
  during_communication: '本次沟通时',
  other: '其他本次场景',
} as const
export type CareReminderOccasion = keyof typeof careReminderOccasions

export function isCareContentType(value: unknown): value is CareContentType {
  return (
    typeof value === 'string' &&
    (careContentTypes as readonly string[]).includes(value)
  )
}

export function isCareHintStatus(value: unknown): value is CareHintStatus {
  return (
    typeof value === 'string' &&
    (careHintStatuses as readonly string[]).includes(value)
  )
}

export function careContentTypeOf(row: Row): CareContentType {
  return isCareContentType(row.content_type)
    ? row.content_type
    : 'followup_task'
}

export function isTaskContent(row: Row): boolean {
  return row.content_type === undefined || row.content_type === 'followup_task'
}

export function contentTypeRecommendation(
  context: Row | null,
): CareContentType | null {
  if (!context) return null
  const recommendation =
    context.ai_recommendation && typeof context.ai_recommendation === 'object'
      ? (context.ai_recommendation as Row)
      : null
  const values = [
    recommendation?.content_type,
    context.recommended_content_type,
  ]
  return values.find(isCareContentType) || null
}

export function defaultRecordWhat(type: CareContentType, title = ''): string {
  if (type === 'routine_hint')
    return '留意是否需要放慢语速、一次只说一件事，以及老人是否主动表达调整需求。'
  if (type === 'one_off_reminder') {
    if (/询问|意愿|参加|活动/.test(title))
      return '记录老人是否愿意参加、选择其他活动、想休息，或暂未得到明确回应。'
    return '记录实际询问内容、老人回应和是否需要调整本次安排。'
  }
  return ''
}

export function validateCareLine(line: Row, type: CareContentType): string[] {
  const errors: string[] = []
  if (typeof line.title !== 'string' || !line.title.trim())
    errors.push('请填写照护内容。')
  if (type === 'routine_hint') {
    const scene = typeof line.scene === 'string' ? line.scene : ''
    if (!Object.hasOwn(careHintScenes, scene))
      errors.push('请选择日常提示场景。')
    if (typeof line.instruction !== 'string' || !line.instruction.trim())
      errors.push('请填写照护提示。')
  } else if (type === 'one_off_reminder') {
    const occasion = typeof line.occasion === 'string' ? line.occasion : ''
    if (!Object.hasOwn(careReminderOccasions, occasion))
      errors.push('请选择本次照护场景时间。')
    if (typeof line.record_what !== 'string' || !line.record_what.trim())
      errors.push('请填写本次需要记录的内容。')
  } else if (typeof line.instruction !== 'string' || !line.instruction.trim()) {
    errors.push('请填写任务执行要求。')
  }
  return errors
}

export function metricContentType(row: Row): CareContentType | 'unknown' {
  if (row.content_type === undefined) return 'followup_task'
  return isCareContentType(row.content_type) ? row.content_type : 'unknown'
}

export const careReminderStatusLabels: Record<string, string> = {
  active: '本次有效',
  recorded: '已记录本次回应',
  cancelled: '已取消',
  expired: '已到期',
}

export function supportsCareType(
  context: Row | null,
  type: CareContentType,
): boolean {
  if (!context || context.supported_content_types === undefined)
    return type === 'followup_task'
  return (
    Array.isArray(context.supported_content_types) &&
    context.supported_content_types.includes(type)
  )
}

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('照护安排回执格式不完整，请核实原提交。')
  return value as Row
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim()
}
export function validCareDay(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}

/** Serialize a whitelist so switching the form never submits hidden task fields. */
export function careArrangementBody(form: Row, type: CareContentType): Row {
  const items = Array.isArray(form.items) ? form.items.map(object) : []
  if (!items.length) throw new Error('请至少填写一项照护内容。')
  for (const line of items) {
    const errors = validateCareLine(line, type)
    if (errors.length) throw new Error(errors[0])
  }
  const common: Row = {
    title: String(form.title || '').trim(),
    goal: String(form.goal || '').trim(),
    content_type: type,
    items: items.map((line) => {
      const item = {
        title: String(line.title).trim(),
        content_type: type,
        ...(nonempty(line.condition)
          ? { condition: line.condition.trim() }
          : {}),
      }
      if (type === 'routine_hint')
        return {
          ...item,
          scene: line.scene,
          instruction: String(line.instruction).trim(),
        }
      if (type === 'one_off_reminder')
        return {
          ...item,
          occasion: line.occasion,
          record_what: String(line.record_what).trim(),
        }
      const taskItem: Row = {
        ...item,
        instruction: String(line.instruction).trim(),
      }
      for (const field of [
        'key',
        'scene',
        'times',
        'weekdays',
        'every_n_days',
        'window_minutes',
      ])
        if (line[field] !== undefined) taskItem[field] = line[field]
      return taskItem
    }),
  }
  if (type !== 'routine_hint') {
    if (!validCareDay(form.service_date))
      throw new Error('请核对本次服务日期。')
    common.service_date = form.service_date
  }
  if (type === 'followup_task')
    Object.assign(common, {
      starts_on: form.starts_on,
      ends_on: form.ends_on,
      shift_id: form.shift_id || null,
      assigned_to: form.assigned_to || null,
    })
  return common
}

export function validateCareGuidance(value: unknown, elderId: string): Row {
  const row = object(value)
  if (
    !nonempty(row.id) ||
    row.elder_id !== elderId ||
    !nonempty(row.title) ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1
  )
    throw new Error('照护提示的老人、编号或版本异常，请重新读取。')
  if (row.content_type === 'routine_hint') {
    if (
      !isCareHintStatus(row.status) ||
      validateCareLine(row, 'routine_hint').length
    )
      throw new Error('日常提示的状态、场景或内容异常。')
  } else if (row.content_type === 'one_off_reminder') {
    if (
      !nonempty(row.status) ||
      !Object.hasOwn(careReminderStatusLabels, row.status) ||
      !validCareDay(row.service_date) ||
      validateCareLine(row, 'one_off_reminder').length
    )
      throw new Error('本次提醒的日期、状态或记录要求异常。')
  } else throw new Error('照护提示包含未知内容类型，未载入页面。')
  return row
}

export function validateCareGuidanceList(
  value: unknown,
  elderId: string,
): Row[] {
  const envelope = object(value)
  if (envelope.elder_id !== elderId || !Array.isArray(envelope.items))
    throw new Error('照护提示列表与当前老人不一致。')
  const items = envelope.items.map((item) =>
    validateCareGuidance(item, elderId),
  )
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('照护提示编号重复，请重新读取。')
  return items
}

export function validateCarePreview(
  value: unknown,
  elderId: string,
  type: CareContentType,
): Row {
  const row = object(value)
  if (
    !nonempty(row.context_token) ||
    !Array.isArray(row.items) ||
    (row.elder_id !== undefined && row.elder_id !== elderId) ||
    (row.content_type !== undefined && row.content_type !== type)
  )
    throw new Error('预览回执与当前老人或采用方式不一致。')
  if (type !== 'followup_task') {
    if (
      row.elder_id !== elderId ||
      row.content_type !== type ||
      !row.items.length ||
      row.items.some((item) => {
        const line = object(item)
        return (
          line.content_type !== type || validateCareLine(line, type).length > 0
        )
      })
    )
      throw new Error('服务端尚未确认这种采用方式，请联系后端核对后重试。')
  }
  if (
    type === 'followup_task' &&
    row.items.some((item) => !isTaskContent(object(item)))
  )
    throw new Error('任务预览中混入了提示或未知类型。')
  for (const field of ['affected_task_ids', 'unassigned_items'])
    if (row[field] !== undefined && !Array.isArray(row[field]))
      throw new Error('预览的任务影响范围格式异常。')
  return row
}

export function validateCareArrangementReceipt(
  value: unknown,
  elderId: string,
  type: CareContentType,
): Row {
  const row = object(value),
    plan = object(row.plan)
  if (
    plan.elder_id !== elderId ||
    !Array.isArray(row.created_tasks) ||
    (plan.content_type !== undefined && plan.content_type !== type)
  )
    throw new Error('安排回执与当前老人或采用方式不一致。')
  if (
    row.created_tasks.some((item) => {
      const task = object(item)
      return (
        !nonempty(task.id) ||
        !isTaskContent(task) ||
        (task.elder_id !== undefined && task.elder_id !== elderId)
      )
    })
  )
    throw new Error('安排回执包含其他老人的任务或非任务内容。')
  if (type !== 'followup_task') {
    if (
      plan.content_type !== type ||
      row.created_tasks.length ||
      !Array.isArray(row.guidance) ||
      !row.guidance.length
    )
      throw new Error(
        '提示或提醒回执未确认，或错误地关联了任务，请核实原提交。',
      )
    row.guidance.forEach((item) => {
      const guidance = validateCareGuidance(item, elderId)
      if (guidance.content_type !== type)
        throw new Error('保存回执的内容类型不一致。')
    })
  }
  return row
}

const sceneAliases: Record<string, string> = {
  communication: 'communication',
  activity: 'activity',
  before_activity: 'activity',
  dining: 'meal',
  meal: 'meal',
  rest: 'rest',
  bathing: 'hygiene',
  hygiene: 'hygiene',
  other: 'other',
}
/** Observations may show every hint. A task only shows hints for its own scene. */
export function guidanceForScene(row: Row, scene?: string): boolean {
  if (!scene || scene === 'other') return true
  const rowScene =
    row.content_type === 'routine_hint'
      ? String(row.scene)
      : (
          {
            before_activity: 'activity',
            after_lunch: 'rest',
            during_meal: 'meal',
            during_communication: 'communication',
            other: 'other',
          } as Record<string, string>
        )[String(row.occasion)]
  return (
    !!sceneAliases[rowScene] &&
    !!sceneAliases[scene] &&
    sceneAliases[rowScene] === sceneAliases[scene]
  )
}

/** An unknown/mismatched receipt must keep the original idempotent attempt. */
export function validateCareGuidanceUpdate(
  value: unknown,
  elderId: string,
  id: string,
  expectedRevision: number,
  target: string,
  recorded = false,
): Row {
  const envelope = object(value)
  const row = validateCareGuidance(
    recorded ? envelope.guidance : value,
    elderId,
  )
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    row.id !== id ||
    Number(row.revision) <= expectedRevision ||
    row.status !== target ||
    (recorded && row.content_type !== 'one_off_reminder')
  )
    throw new Error('提示更新回执与原提交不一致，请保留原请求核实。')
  if (recorded) {
    const record = object(envelope.record)
    if (
      !nonempty(record.id) ||
      record.elder_id !== elderId ||
      envelope.task ||
      (envelope.created_tasks !== undefined &&
        (!Array.isArray(envelope.created_tasks) ||
          envelope.created_tasks.length))
    )
      throw new Error('本次回应记录回执不完整，或错误地关联了任务。')
  }
  return row
}

export function careGuidanceActions(row: Row, management: boolean): string[] {
  if (row.content_type === 'routine_hint') {
    if (!isCareHintStatus(row.status)) return []
    if (!management) return row.status === 'enabled' ? ['needs_adjustment'] : []
    return careHintStatuses.filter((status) => status !== row.status)
  }
  return management &&
    row.content_type === 'one_off_reminder' &&
    row.status === 'active'
    ? ['cancelled']
    : []
}
