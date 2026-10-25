import contract from './contract.json'
import { clearSession, readSession, type Role } from '../session'
import { sameCareSession } from './task-care-context'

export type Row = Record<string, unknown>
export interface Schema {
  $ref?: string
  type?: string
  anyOf?: Schema[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  enum?: (string | number)[]
  const?: string
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  additionalProperties?: Schema | boolean
  pattern?: string
}
export interface Parameter {
  name: string
  in: string
  required?: boolean
  schema: Schema
}
export interface Operation {
  id: string
  group: string
  title: string
  path: string
  method: string
  roles: Role[]
  parameters: Parameter[]
  paginated: boolean
  schema: Schema | null
}
export const operations = contract.operations as Operation[]
export const schemas = contract.schemas as Record<string, Schema>
export const labels: Record<string, string> = {
  name: '姓名／名称',
  elder_id: '老人',
  contact_name: '联系人',
  contact_phone: '联系电话',
  notes: '注意事项',
  room: '房间',
  label: '床位名称',
  enabled: '启用',
  active: '启用账号',
  username: '登录账号',
  password: '密码（至少12位）',
  display_name: '员工／家属姓名',
  role: '账号角色',
  expected_revision: '当前版本',
  reason: '操作原因',
  bed_id: '床位',
  expected_bed_revision: '床位当前版本',
  expected_elder_revision: '老人当前版本',
  admission_id: '入住单',
  kind: '类型',
  action: '操作',
  status: '状态',
  id: '唯一编号',
  revision: '版本',
  current_admission_id: '当前入住单',
  start_at: '开始时间',
  end_at: '结束时间',
  caregiver_ids: '班次成员',
  shift_id: '班次',
  source_shift_id: '交出班次',
  target_shift_id: '接入班次',
  raw_text: '原始记录',
  text: '本次记录内容',
  observations: '已核对观察',
  task_candidates: '待办候选（确认后才生成）',
  review_notes: '任务安排核对提示',
  object_review_required: '需要核对任务所属老人',
  responsible_name: '负责人',
  title: '事项标题',
  assigned_to: '责任人',
  due_at: '截止时间',
  due_text: '原文时间表达',
  condition: '执行前提条件',
  result: '完成结果',
  source_type: '任务来源类型',
  note: '说明',
  happened_at: '实际发生时间',
  created_at: '录入时间',
  updated_at: '更新时间',
  created_by: '记录人',
  completed_by: '完成人',
  completed_at: '完成时间',
  source_record_id: '来源正式记录',
  source_draft_id: '来源AI草稿',
  draft_id: 'AI草稿',
  record_id: '正式记录',
  task_id: '任务',
  provider: 'AI服务来源',
  generation_kind: '生成方式',
  evidence: '原文证据',
  warnings: '待核对提醒',
  source_id: '来源编号',
  quote: '原文引文',
  field: '引用字段',
  snapshot_text: '当时原文快照',
  source_revision: '来源版本',
  summary: '交班注意事项',
  approve_ai_summary: '已逐项审核并采用AI摘要',
  ai_summary: 'AI摘要草稿',
  handover_id: '交班单',
  item_id: '交班事项',
  items: '服务项目／明细',
  detail: '具体内容',
  received_at: '接班时间',
  received_by: '接班人',
  include_ai: '启用真实AI质检',
  issues: '待核对提示',
  report_id: '质检报告',
  issue_id: '质检提示',
  explanation: '提示说明',
  citations: '原文引用',
  type: '提示类型',
  review_note: '人工核对说明',
  content: '记忆内容',
  category: '记忆类型',
  scenes: '适用场景',
  scene: '本次服务场景',
  attributed_to: '信息表达者',
  source_field: '来源字段',
  source_quote: '来源原文引文',
  valid_from: '生效时间',
  expires_at: '有效截止时间',
  review_due_at: '复核时间',
  memory_id: '个性化记忆',
  candidate_index: 'AI候选序号（从0开始）',
  expected_record_revision: '正式记录当前版本',
  memory_candidates: 'AI记忆候选（需人工选中并经主管确认）',
  context_notes: '历史情境提示',
  context_snapshot: '生成时的情境快照',
  source: '来源证据',
  effective: '当前有效',
  source_current: '来源当前有效',
  review_due: '到期需复核',
  blocked_reasons: '阻止生效原因',
  expected_task_revision: '任务当前版本',
  expected_memory_revision: '记忆当前版本',
  reference_id: '采用关系',
  references: '已采用依据',
  current: '当前核验状态',
  needs_review: '需要复核',
  historical_only: '仅供历史查看',
  criterion: '人工核验标准',
  checker_id: '指定核验人',
  check_due_at: '核验提醒期限',
  outcome: '核验结论',
  valid_until: '结论有效截止',
  verification: '核验记录',
  ready: '当前可执行',
  reasons: '当前限制原因',
  case_id: '变更核验单',
  expected_fingerprint: '当前资料校验值',
  disposition: '处理结论',
  acknowledged_handover_ids: '已人工核对的交班单',
  decision: '复查结论',
  fingerprint: '当前资料校验值',
  observations_history: '观察历史',
  submissions: '提交历史',
  reviews: '复查历史',
  initial_snapshot: '初始快照',
  template_id: '评估量表',
  scores: '量表评分',
  assessed_at: '评估时间',
  supersedes_id: '替代的旧版本',
  care_level_label: '机构护理档位',
  care_level_basis: '机构档位认定依据',
  total_score: '评估总分',
  assessment_id: '已确认评估',
  expected_assessment_revision: '评估当前版本',
  goal: '照护目标',
  starts_on: '生效日期',
  ends_on: '结束日期',
  key: '项目固定编号',
  instruction: '服务要求',
  times: '每日时段（时:分）',
  weekdays: '每周执行日（1周一至7周日）',
  every_n_days: '间隔天数',
  window_minutes: '执行窗口（分钟）',
  service_date: '服务日期',
  previous_task_id: '待补发的已取消任务',
  plan_id: '照护计划',
  expected_task_revision_legacy: '任务版本',
  family_id: '家属账号',
  account_id: '家属账号',
  relationship: '与老人关系',
  consent_reference: '授权凭证说明',
  scopes: '授权范围',
  binding_id: '授权关系',
  period_start: '简报开始时间',
  period_end: '简报结束时间',
  summary_id: '家属简报',
  feedback_id: '家属问题单',
  reply: '经核实的回复',
  incident_id: '照护安全事件',
  rectification_id: '整改事项',
  occurred_at: '事件发生时间',
  description: '事件描述',
  severity: '人工分级',
  immediate_action: '即时处置',
  rectification_plan: '整改计划',
  assigned_due_at: '整改期限',
  start: '统计开始日期',
  end: '统计结束日期',
  include_text: '包含内部原文',
  source_plan_id: '来源计划',
  source_plan_revision: '来源计划版本',
  plan_item_key: '服务项目编号',
  scheduled_at: '计划服务时间',
  metrics: '统计指标',
  as_of: '本次计算时间',
  start_date: '开始日期',
  end_date: '结束日期',
  task_count: '任务数',
  sources: '证据来源',
  historical_snapshot: '扫描时的历史快照',
  uncovered_task_ids: 'AI摘要未引用的待办',
  clarifications: '交接澄清记录',
  memory_references: '已采用的个性化照护依据',
  condition_verification: '执行前提核验记录',
  condition_check: '执行前提当前状态',
  plan_check: '照护计划依据核验',
  source_plan_snapshot: '交班时的计划依据',
  record: '照护记录',
  confirmed_by: '确认人',
  confirmed_at: '确认时间',
  source_fingerprint: '扫描时资料校验值',
  scope: '核对范围',
  revisions: '版本历史',
  feeding: '进食',
  bathing: '洗澡',
  grooming: '修饰',
  dressing: '穿衣',
  bowels: '大便控制',
  bladder: '小便控制',
  toilet: '如厕',
  transfer: '床椅转移',
  mobility: '平地移动',
  stairs: '上下楼梯',
  classification_basis: '人工分级依据',
  corrective_plan: '整改计划',
  expected_incident_revision: '事件当前版本',
  expected_rectification_revision: '整改当前版本',
  occurrence_key: '计划发生项',
  coverage_status: '记录覆盖状态',
  requirement: '计划记录要求',
  human_reviews: '人工核对历史',
  event_ids: '所选变更事件',
  events: '新增与变化事件',
  since: '从此时开始',
  unresolved_tasks: '重要未完成事项（已读仍保留）',
  differences: '计划项目变化',
  before: '旧要求',
  after: '新要求',
  future_tasks_requiring_human_review: '未来待办影响预览',
  historical_completed_task_ids: '保持原快照的已完成任务',
  affected_shift_ids: '受影响班次',
  notice: '口径与说明',
  reason_code: '未执行原因',
  explicit_references: '明确引用关系',
  possible_relations: '可能相关（需人工判断）',
  possible_related_objects: '可能相关对象（非明确引用）',
  completion_criteria: '完成标准',
  timezone: '显示时区',
  window: '统计时段',
  start_inclusive: '统计开始时间（含）',
  end_exclusive: '统计截止时间（不含）',
  interpretation: '统计口径说明',
  generated_plan_occurrences: '已生成且已到服务时间的计划任务',
  completion: '完成情况',
  on_time_completion: '按时完成情况',
  numerator: '已达成数量',
  denominator: '纳入统计数量',
  ratio: '达成比例',
  cancelled: '已取消数量',
  not_done: '未执行数量',
  open_overdue: '未完成且已逾期数量',
  excluded_future_task_rows: '尚未到服务时间的任务（暂不计入）',
  invalid_schedule_rows: '服务时间异常的任务',
  definition: '计算规则',
  manual_task_rows_created: '本时段新建的非计划任务',
  handover_receipt: '交班事项接收情况',
  incidents: '不良事件情况',
  reported: '已上报数量',
  closed: '已关闭数量',
  open_rectifications_overdue: '未关闭且已逾期的整改',
  family_feedback: '家属反馈情况',
  created: '新增数量',
}
export const valueLabels: Record<string, string> = {
  admin: '管理员',
  supervisor: '主管',
  caregiver: '护理员',
  family: '家属',
  elder: '老人本人',
  staff: '工作人员',
  unknown: '未明确',
  pending: '待处理',
  active: '在院／有效',
  out: '外出',
  discharged: '已离院',
  draft: '草稿',
  confirmed: '已人工确认',
  corrected: '已更正',
  pending_review: '待人工核对',
  rejected: '已驳回',
  failed: '失败',
  completed: '已完成',
  in_progress: '进行中',
  not_done: '未执行',
  transferred: '已转交',
  cancelled: '已取消',
  overdue: '已逾期',
  open: '开放',
  submitted: '已提交',
  received: '已接收',
  clarifying: '待澄清',
  closed: '已关闭',
  record: '照护记录',
  task: '照护任务',
  start: '开始执行',
  transfer: '转交／换床',
  cancel: '取消',
  reopen: '重新开启',
  admit: '新入住',
  legacy_registration: '补登记既有入住',
  return: '返院／退回',
  discharge: '离院',
  confirm: '确认',
  reject: '驳回',
  retire: '停用',
  approve: '审批通过',
  bathing: '洗浴',
  dining: '饮食',
  activity: '活动',
  communication: '沟通',
  rest: '休息',
  other: '其他',
  stable_preference: '稳定偏好',
  temporary_wish: '临时意愿',
  observation: '已确认观察',
  candidate: '候选',
  review_required: '待复核',
  retired: '已停用',
  request_review: '要求重新核实',
  manual: '人工安排',
  suspend: '暂停使用',
  suspended: '已暂停',
  resume: '恢复使用',
  keep: '复核后维持',
  memory_confirm: '人工确认记忆',
  memory_keep: '复核后维持',
  memory_suspend: '暂停使用',
  memory_resume: '恢复使用',
  revise_memory: '人工修订',
  memory_source_changed: '来源变更待复核',
  memory_request_review: '要求复核',
  memory_reject: '驳回',
  memory_retire: '停用',
  raw_text: '原始文本',
  observations: '已核对观察',
  met: '条件满足',
  not_met: '条件未满足',
  acknowledged: '确认需跟进',
  not_applicable: '说明不适用',
  rule: '规则提示',
  ai_suggestion: 'AI建议',
  reviewed: '已核对',
  publish: '审核并发布',
  withdraw: '撤回',
  summary: '服务简报',
  feedback: '沟通反馈',
  binding: '授权关系',
  accept: '复查通过',
  assigned: '已指派',
  awaiting_review: '等待独立复查',
  reported: '待人工分级',
  rectifying: '整改中',
  reference_withdrawn: '旧依据已撤回',
  reference_replaced: '已明确替换依据',
  task_terminal: '原任务已结束',
  no_current_difference: '当前无差异',
  elder_refused: '老人拒绝',
  unwell: '身体不适',
  staff_shortage: '人员不足',
  equipment: '设备原因',
  family_request: '家属要求',
  covered: '已登记完成结果',
  partial: '部分有据，仍需核对',
  missing_record: '缺少完成记录，不能认定未服务',
  needs_followup: '缺项待跟进',
  reopen_review: '重新核对',
  low: '低',
  medium: '中',
  high: '高',
  fall: '跌倒',
  choking: '噎食',
  pressure_injury: '压疮',
  wandering: '走失',
  medication: '用药相关',
  burn: '烫伤',
  conflict: '冲突',
  infection_concern: '感染疑虑',
  service_omission: '服务遗漏',
}
export function label(name: string) {
  return labels[name] || name
}
export function display(value: unknown, field?: string): string {
  if (field === 'ratio') {
    if (value === null || value === undefined) return '暂无可统计数据'
    if (typeof value === 'number' && Number.isFinite(value))
      return new Intl.NumberFormat('zh-CN', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(value)
  }
  if (value === null || value === undefined || value === '') return '未提供'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (value === 'Asia/Shanghai') return '北京时间（UTC+8）'
  if (
    typeof value === 'string' &&
    field &&
    /(?:_at$|_until$|_from$|_inclusive$|_exclusive$|^as_of$)/.test(field) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    const date = new Date(value)
    if (Number.isFinite(date.valueOf())) {
      const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date)
      const part = (type: string) =>
        parts.find((p) => p.type === type)?.value || ''
      return `${part('year')}年${part('month')}月${part('day')}日 ${part('hour')}:${part('minute')}:${part('second')}（北京时间）`
    }
  }
  if (typeof value === 'string') return valueLabels[value] || value
  return String(value)
}
export function resolveSchema(schema: Schema): Schema {
  if (schema.$ref)
    return resolveSchema(schemas[schema.$ref.split('/').pop()!] || {})
  if (schema.anyOf)
    return {
      ...schema,
      ...resolveSchema(schema.anyOf.find((x) => x.type !== 'null') || {}),
      anyOf: undefined,
    }
  return schema
}
export function initial(schema: Schema, field = ''): unknown {
  const s = resolveSchema(schema)
  if (s.default !== undefined && s.default !== null)
    return structuredClone(s.default)
  if (s.const) return s.const
  if (s.type === 'object')
    return Object.fromEntries(
      Object.entries(s.properties || {}).map(([key, item]) => [
        key,
        initial(item, key),
      ]),
    )
  if (s.type === 'array')
    return Array.from({ length: s.minItems || 0 }, () =>
      initial(s.items || {}, field),
    )
  if (s.type === 'boolean') return ''
  return ''
}
export function clean(
  schema: Schema,
  value: unknown,
  field = '',
  required = true,
): unknown {
  const s = resolveSchema(schema)
  if (value === '' || value === undefined || value === null) {
    if (required && s.default === undefined)
      throw new Error(`请填写${label(field)}`)
    return undefined
  }
  if (s.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${label(field)}格式不正确`)
    const row = value as Row
    const props = s.properties || {}
    const entries = Object.entries(props).map(([key, child]) => [
      key,
      clean(child, row[key], key, s.required?.includes(key) || false),
    ])
    return Object.fromEntries(entries.filter(([, v]) => v !== undefined))
  }
  if (s.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${label(field)}必须为列表`)
    const items = value as unknown[]
    if (items.length < (s.minItems || 0))
      throw new Error(`请补全${label(field)}`)
    if (s.maxItems !== undefined && items.length > s.maxItems)
      throw new Error(`${label(field)}不能超过${s.maxItems}项`)
    return items.map((x) => clean(s.items || {}, x, field))
  }
  if (s.type === 'integer' || s.type === 'number') {
    const n = Number(value)
    if (!Number.isFinite(n) || (s.type === 'integer' && !Number.isInteger(n)))
      throw new Error(`${label(field)}必须为有效数字`)
    if (s.minimum !== undefined && n < s.minimum)
      throw new Error(`${label(field)}不能小于${s.minimum}`)
    if (s.maximum !== undefined && n > s.maximum)
      throw new Error(`${label(field)}不能大于${s.maximum}`)
    if (s.enum && !s.enum.includes(n))
      throw new Error(`请选择有效的${label(field)}`)
    return n
  }
  if (s.type === 'boolean' && typeof value !== 'boolean')
    throw new Error(`请选择有效的${label(field)}`)
  if (s.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${label(field)}必须为文本`)
    if ((required || (s.minLength ?? 0) > 0) && !value.trim())
      throw new Error(`请填写${label(field)}`)
    if (s.minLength !== undefined && value.length < s.minLength)
      throw new Error(`${label(field)}至少${s.minLength}字`)
    if (s.maxLength !== undefined && value.length > s.maxLength)
      throw new Error(`${label(field)}不能超过${s.maxLength}字`)
    if (s.pattern && !new RegExp(s.pattern).test(value))
      throw new Error(`${label(field)}格式不正确`)
  }
  if (s.enum && !s.enum.includes(value as string | number))
    throw new Error(`请选择有效的${label(field)}`)
  if (s.const !== undefined && value !== s.const)
    throw new Error(`${label(field)}与当前操作不符`)
  if (
    s.format === 'date' &&
    (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)
  )
    throw new Error(`请填写有效的${label(field)}`)
  if (s.format === 'date-time') {
    const time = new Date(String(value))
    if (!Number.isFinite(time.valueOf()))
      throw new Error(`请填写有效的${label(field)}`)
    return time.toISOString()
  }
  return value
}
export function materialize(op: Operation, params: Row) {
  let path = op.path
  const query = new URLSearchParams()
  for (const param of op.parameters) {
    const v = clean(
      param.schema,
      params[param.name],
      param.name,
      param.required,
    )
    if (v === undefined) continue
    if (param.in === 'path')
      path = path.replace(`{${param.name}}`, encodeURIComponent(String(v)))
    else query.set(param.name, String(v))
  }
  return path + (query.size ? '?' + query.toString() : '')
}
export function requestBody(path: string, schema: Schema, value: unknown) {
  const payload = clean(schema, value) as Row
  // Manual entry can use the reviewed raw text when no separate observations
  // were entered. Do not apply this to AI confirmation: [] task candidates is
  // an explicit human decision to remove suggested tasks.
  if (
    path === '/records/manual' &&
    Array.isArray(payload.observations) &&
    payload.observations.length === 0
  )
    delete payload.observations
  return payload
}
export async function request(
  path: string,
  method = 'get',
  body?: unknown,
  key?: string,
  timeoutMs = 90000,
): Promise<unknown> {
  const current = readSession()
  if (!current?.accessToken || current.mode !== 'api')
    throw new Error('请使用服务器测试账号登录')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '') +
        path,
      {
        method: method.toUpperCase(),
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + current.accessToken,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
    )
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      if (res.status === 401 && sameCareSession(readSession(), current)) {
        clearSession()
        window.dispatchEvent(new Event('hulao:unauthorized'))
      }
      const detail = data?.detail
      const errors: Record<string, string> = {
        'Insufficient permissions':
          '此操作仅限主管或管理员办理。护理员可查看并处理本人负责的任务。',
        insufficient_permissions:
          '此操作仅限主管或管理员办理。护理员可查看并处理本人负责的任务。',
        not_a_shift_member:
          '当前账号不是所选班次成员，请选择自己的开放班次，或请主管安排班次。',
        management_required_to_assign_others:
          '护理员只能为本人创建任务；安排其他责任人或调整期限请由主管或管理员处理。',
        impression_no_records:
          '这位老人还没有已确认记录，请先登记日常照护情况。',
        impression_sources_changed:
          '历史记录已新增或更正，请重新整理印象后核对。',
        impression_history_too_large:
          '当前示范版最多整理240条、16万字记录，未截断或忽略历史，请联系管理员。',
        impression_record_too_long: '单条记录过长，暂无法完整整理。',
        impression_historical_review:
          '这是历史版本或已到复核时间，请先重新整理当前印象。',
        quality_scope_mismatch:
          '所选班次必须是该交班单的交出班次，请重新选择。',
        quality_sources_changed_retry_scan:
          '检查期间来源资料发生变化，请刷新可选数据并重新检查。',
        shift_closed:
          '该班次已完成交班，请选择开放班次；跨班任务需先完成接班。',
        assignee_not_in_shift: '所选负责人不在该班次中，请核对班次成员。',
        task_source_revision_changed: '来源记录版本已变化，请刷新并核对来源后重新安排。',
        task_source_elder_mismatch: '来源记录与任务老人不匹配，请重新选择。',
        task_source_not_confirmed: '来源记录未确认或已撤销，不能用于安排任务。',
        task_source_admission_changed: '来源记录属于其他入住阶段，请核对当前入住关系。',
        due_at_must_be_future: '截止时间必须晚于当前时间，请重新填写。',
        task_assigned_to_another_caregiver:
          '该任务由其他护理员负责，请由主管核对或转交。',
        draft_already_confirmed_refresh_record:
          '该AI草稿已经确认，本次内容未覆盖原记录。请查看正式记录，需修改时使用追加更正。',
      }
      const message = Array.isArray(detail)
        ? detail
            .map(
              (x: Row) =>
                `${label(String((x.loc as string[])?.at(-1) || ''))}：${x.msg}`,
            )
            .join('；')
        : typeof detail === 'string'
          ? errors[detail] || (typeof data?.safe_message === 'string' ? data.safe_message : detail)
          : JSON.stringify(detail || data)
      throw new WorkflowRequestError(
        res.status,
        `${res.status === 409 ? '资料或状态已变化，请刷新后核对。' : res.status === 503 ? 'AI暂不可用，可重试或转人工记录。' : ''}${message}`,
      )
    }
    if (data === null && res.status !== 204)
      throw new WorkflowRequestError(
        502,
        '服务器响应格式异常，写入结果待核实，不能重新创建操作。',
      )
    return data
  } finally {
    clearTimeout(timeout)
  }
}

async function authorizedRequest<T>(path: string, init: NonNullable<Parameters<typeof fetch>[1]>, consume: (response: Response) => Promise<T>, timeoutMs = 90000): Promise<T> {
  const current = readSession()
  if (!current?.accessToken || current.mode !== 'api')
    throw new Error('请使用服务器测试账号登录')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '') + path,
      {
        ...init,
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + current.accessToken,
          ...init.headers,
        },
      },
    )
    if (response.status === 401 && sameCareSession(readSession(), current)) {
      clearSession()
      window.dispatchEvent(new Event('hulao:unauthorized'))
    }
    if (!response.ok) {
      const data = await response.clone().json().catch(() => null)
      const message = typeof data?.safe_message === 'string'
        ? data.safe_message
        : typeof data?.detail === 'string' ? data.detail : '请求未完成，请核对后重试。'
      throw new WorkflowRequestError(response.status, `${response.status === 409 ? '资料或状态已变化，请刷新后核对。' : ''}${message}`)
    }
    return await consume(response)
  } catch (error) {
    if (error instanceof WorkflowRequestError) throw error
    throw new WorkflowRequestError(0, '网络请求未能确认结果，请检查连接后使用同一请求编号重试。')
  } finally {
    clearTimeout(timeout)
  }
}

export async function requestBinary(
  path: string,
  file: Blob,
  contentType: 'image/jpeg' | 'image/png',
  key: string,
  timeoutMs = 90000,
): Promise<unknown> {
  if (file.size < 1 || file.size > 4 * 1024 * 1024)
    throw new WorkflowRequestError(413, '照片不能为空且不能超过4MiB。')
  const value = await authorizedRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'Idempotency-Key': key },
    body: file,
  }, response => response.json().catch(() => null), timeoutMs)
  if (!value || typeof value !== 'object' || typeof value.id !== 'string')
    throw new WorkflowRequestError(502, '照片上传结果格式异常，请核实当前状态后再重试。')
  return value
}

export async function requestBlob(path: string, timeoutMs = 30000): Promise<Blob> {
  const value = await authorizedRequest(path, { method: 'GET' }, response => response.blob(), timeoutMs)
  if (!value.size) throw new WorkflowRequestError(502, '照片内容为空，未能生成预览。')
  return value
}

export class WorkflowRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
export async function listAll(path: string): Promise<Row[]> {
  const result: Row[] = []
  let offset = 0
  while (true) {
    const data = await request(
      path + (path.includes('?') ? '&' : '?') + `limit=200&offset=${offset}`,
    )
    const rows = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && 'admissions' in data
        ? (data as Row).admissions
        : null
    if (!Array.isArray(rows)) throw new Error('列表返回格式异常')
    result.push(...rows)
    if (rows.length < 200) return result
    offset += rows.length
  }
}
export const resourceFor: Record<string, string> = {
  elder_id: 'elders',
  bed_id: 'beds',
  staff_id: 'staff',
  assigned_to: 'staff',
  checker_id: 'staff',
  caregiver_ids: 'staff',
  shift_id: 'shifts',
  source_shift_id: 'shifts',
  target_shift_id: 'shifts',
  draft_id: 'drafts',
  record_id: 'records',
  source_record_id: 'records',
  task_id: 'tasks',
  previous_task_id: 'tasks',
  memory_id: 'memories',
  handover_id: 'handovers',
  item_id: 'handover_items',
  assessment_id: 'assessments',
  plan_id: 'plans',
  family_id: 'family_accounts',
  account_id: 'family_accounts',
  binding_id: 'bindings',
  summary_id: 'summaries',
  feedback_id: 'feedback',
  case_id: 'changes',
  report_id: 'quality',
  issue_id: 'issues',
  incident_id: 'incidents',
  rectification_id: 'rectifications',
  reference_id: 'references',
  admission_id: 'admissions',
  event_ids: 'events',
  occurrence_key: 'occurrences',
}
export function rowName(row: Row) {
  return String(
    row.name ||
      row.display_name ||
      row.title ||
      row.label ||
      row.content ||
      row.detail ||
      row.text ||
      row.id ||
      '',
  ).slice(0, 90)
}

export function optionLabel(
  field: string,
  row: Row,
  choices: Row[],
  catalogs: Record<string, Row[]> = {},
): string {
  const raw = rowName(row)
  const index = Math.max(
    0,
    choices.findIndex((item) => item.id === row.id),
  )
  const name = raw && raw !== row.id ? raw : `${label(field)}${index + 1}`
  if (resourceFor[field] === 'elders') {
    const sameName = choices.filter((item) => rowName(item) === raw)
    if (sameName.length < 2) return name
    if (row.bed_label) return `${name} · ${row.bed_label}`
    return `${name}（同名${sameName.findIndex((item) => item.id === row.id) + 1}）`
  }
  if (resourceFor[field] === 'tasks') {
    const elder = catalogs.elders?.find((item) => item.id === row.elder_id)
    const elderName = elder ? rowName(elder) : ''
    const bed = elder?.bed_label ? ` · ${elder.bed_label}` : ''
    const taskName = row.title && row.title !== row.id ? String(row.title) : `任务${index + 1}`
    return `${elderName ? `${elderName}${bed} · ` : ''}${taskName}${row.status ? ` · ${display(row.status)}` : ''}`
  }
  return name + (row.status ? ` · ${display(row.status)}` : '')
}
