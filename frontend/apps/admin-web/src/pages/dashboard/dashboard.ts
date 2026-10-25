/** Mirrors report_service.metrics: these are current states of dated cohorts. */
export type Row = Record<string, unknown>
export interface DateWindow { start: string; end: string }
export interface Ratio { numerator: number; denominator: number; ratio: number | null }
export interface Metrics {
  as_of: string
  timezone: 'Asia/Shanghai'
  window: { start_inclusive: string; end_exclusive: string }
  interpretation: string
  generated_plan_occurrences: {
    completion: Ratio; on_time_completion: Ratio
    cancelled: number; not_done: number; open_overdue: number
    excluded_future_task_rows: number; invalid_schedule_rows: number; definition: string
  }
  manual_task_rows_created: number
  handover_receipt: Ratio & { definition: string }
  incidents: { reported: number; closed: number; open_rectifications_overdue: number; definition: string }
  family_feedback: { created: number; closed: number; definition: string }
}
const day = 86400000
function dateNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const n = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n : null
}
export function validateWindow(window: DateWindow): string | null {
  const start = dateNumber(window.start), end = dateNumber(window.end)
  if (start === null || end === null) return '请输入有效日期（YYYY-MM-DD）。'
  const days = (end - start) / day
  return days >= 1 && days <= 366 ? null : '结束日期不计入区间，统计范围须为 1–366 天。'
}
export function defaultWindow(now = Date.now()): DateWindow {
  const start = new Date(now + 8 * 3600000).toISOString().slice(0, 10)
  return { start, end: new Date(dateNumber(start)! + day).toISOString().slice(0, 10) }
}
/** Backend stamp rejects naive/invalid timestamps; do not guess the browser timezone. */
export function stamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match || dateNumber(match[1]) === null || +match[2] > 23 || +match[3] > 59 || +match[4] > 59 || +(match[5] || 0) > 23 || +(match[6] || 0) > 59) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
function invalid(): never { throw new Error('统计数据格式或数值异常，请刷新后联系管理员。') }
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Row
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalid()
  return value
}
function ratio(value: unknown): Ratio {
  const r = object(value), numerator = count(r.numerator), denominator = count(r.denominator)
  if (numerator > denominator) return invalid()
  if (denominator === 0) {
    if (r.ratio !== null) return invalid()
  } else if (typeof r.ratio !== 'number' || !Number.isFinite(r.ratio) || Math.abs(r.ratio - numerator / denominator) > 1e-10) return invalid()
  return { numerator, denominator, ratio: r.ratio as number | null }
}
export function validateMetrics(value: unknown, requested: DateWindow): Metrics {
  if (validateWindow(requested)) return invalid()
  const m = object(value), w = object(m.window), p = object(m.generated_plan_occurrences)
  const h = object(m.handover_receipt), i = object(m.incidents), f = object(m.family_feedback)
  if (m.timezone !== 'Asia/Shanghai' || stamp(m.as_of) === null ||
    stamp(w.start_inclusive) !== Date.parse(requested.start + 'T00:00:00+08:00') ||
    stamp(w.end_exclusive) !== Date.parse(requested.end + 'T00:00:00+08:00')) return invalid()
  const completion = ratio(p.completion), onTime = ratio(p.on_time_completion)
  const cancelled = count(p.cancelled), notDone = count(p.not_done), overdue = count(p.open_overdue)
  const reported = count(i.reported), closed = count(i.closed), created = count(f.created), replied = count(f.closed)
  if (onTime.denominator !== completion.denominator || onTime.numerator > completion.numerator ||
    completion.numerator + cancelled + notDone > completion.denominator ||
    overdue > completion.denominator - completion.numerator - cancelled || closed > reported || replied > created) return invalid()
  return {
    as_of: m.as_of as string, timezone: 'Asia/Shanghai',
    window: { start_inclusive: w.start_inclusive as string, end_exclusive: w.end_exclusive as string },
    interpretation: text(m.interpretation),
    generated_plan_occurrences: { completion, on_time_completion: onTime, cancelled, not_done: notDone, open_overdue: overdue,
      excluded_future_task_rows: count(p.excluded_future_task_rows), invalid_schedule_rows: count(p.invalid_schedule_rows), definition: text(p.definition) },
    manual_task_rows_created: count(m.manual_task_rows_created),
    handover_receipt: { ...ratio(h), definition: text(h.definition) },
    incidents: { reported, closed, open_rectifications_overdue: count(i.open_rectifications_overdue), definition: text(i.definition) },
    family_feedback: { created, closed: replied, definition: text(f.definition) },
  }
}
export function formatRatio(value: Ratio): string {
  return value.ratio === null ? '暂无分母' : new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(value.ratio)
}
export function formatTime(value: unknown): string {
  const n = stamp(value)
  return n === null ? '未提供有效时间' : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(n)
}
export const metricLabels = {
  plan: '已到时刻的计划服务批次', completed: '已完成批次', onTime: '按时完成批次', cancelled: '取消批次', notDone: '未完成登记批次', overdue: '未关闭逾期批次',
  manual: '手工创建任务行', future: '排除的未来计划任务行', invalid: '全量无效计划时间行',
  handover: '提交交班条目', received: '已接收条目', incidents: '发生事件', closedIncidents: '已关闭事件', rectifications: '未关闭超期整改',
  feedback: '创建反馈', replied: '主管已回复反馈',
} as const
export type MetricKey = keyof typeof metricLabels
export interface ChartMetric { key: MetricKey; label: string; count: number }
export interface ChartGroup { title: string; definition: string; summary: string; items: ChartMetric[] }
export function chartGroups(m: Metrics): ChartGroup[] {
  const p = m.generated_plan_occurrences
  const items = (values: [MetricKey, number][]) => values.map(([key, count]) => ({ key, count, label: metricLabels[key] }))
  return [
    { title: '已生成计划服务', definition: p.definition,
      summary: `完成率 ${formatRatio(p.completion)} · 按时完成率 ${formatRatio(p.on_time_completion)}（共同分母 ${p.completion.denominator} 批次）`,
      items: items([['plan', p.completion.denominator], ['completed', p.completion.numerator], ['onTime', p.on_time_completion.numerator], ['cancelled', p.cancelled], ['notDone', p.not_done], ['overdue', p.open_overdue]]) },
    { title: '交班接收', definition: m.handover_receipt.definition, summary: `条目接收率 ${formatRatio(m.handover_receipt)}`,
      items: items([['handover', m.handover_receipt.denominator], ['received', m.handover_receipt.numerator]]) },
    { title: '安全事件与整改', definition: m.incidents.definition, summary: '事件按发生时间选取；整改计数单位为整改单。',
      items: items([['incidents', m.incidents.reported], ['closedIncidents', m.incidents.closed], ['rectifications', m.incidents.open_rectifications_overdue]]) },
    { title: '家属反馈', definition: m.family_feedback.definition, summary: '已回复表示主管已回复，不代表家属满意。',
      items: items([['feedback', m.family_feedback.created], ['replied', m.family_feedback.closed]]) },
    { title: '任务口径补充', definition: '手工任务按 created_at 入区间；未来行按 scheduled_at 入区间且晚于 as_of；无效计划时间行统计全部可见计划任务，不限窗口。行数不等于批次数。',
      summary: '这些任务行均不进入计划服务批次分母。',
      items: items([['manual', m.manual_task_rows_created], ['future', p.excluded_future_task_rows], ['invalid', p.invalid_schedule_rows]]) },
  ]
}
export interface Sources { tasks: unknown; handovers: unknown; incidents: unknown; feedback: unknown }
export interface DrillRow {
  id: string; elder: string; status: string; at: unknown; to: string; source: Row; note: string
}
export type Breakdown = Record<MetricKey, DrillRow[]>
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error('明细列表格式异常，请刷新重试。')
  const ids = new Set<string>()
  return value.map((value) => {
    const row = object(value), id = text(row.id)
    text(row.status)
    if (ids.has(id)) throw new Error('明细出现重复编号，无法核对数量。')
    ids.add(id)
    return row
  })
}
function drill(row: Row, at: unknown, to: string, note = ''): DrillRow {
  return { id: text(row.id), elder: typeof row.elder_id === 'string' ? row.elder_id : '未指定老人', status: text(row.status), at, to, source: row, note }
}
/** Use raw lists, never gateway task projections (they can discard occurrence fields). */
export function buildBreakdown(m: Metrics, sources: Sources): Breakdown {
  const result = Object.fromEntries(Object.keys(metricLabels).map((key) => [key, []])) as unknown as Breakdown
  const lower = stamp(m.window.start_inclusive)!, upper = stamp(m.window.end_exclusive)!, instant = stamp(m.as_of)!
  const within = (value: unknown) => { const n = stamp(value); return n !== null && lower <= n && n < upper && n <= instant }
  const taskDrill = (r: Row) => drill(r, r.occurrence_key ? r.scheduled_at : r.created_at, '/tasks?task=' + encodeURIComponent(text(r.id)),
    r.occurrence_key ? `批次 ${r.occurrence_key}；替代 ${r.replaces_task_id || '无'}；截止 ${formatTime(r.due_at)}；完成 ${formatTime(r.completed_at)}` : '手工任务，按创建时间入区间')
  const groups = new Map<string, Row[]>()
  for (const r of rows(sources.tasks)) {
    if (!r.occurrence_key) { if (within(r.created_at)) result.manual.push(taskDrill(r)); continue }
    const key = text(r.occurrence_key), scheduled = stamp(r.scheduled_at)
    if (scheduled === null) { result.invalid.push(taskDrill(r)); continue }
    if (lower <= scheduled && scheduled < upper && scheduled > instant) result.future.push(taskDrill(r))
    if (within(r.scheduled_at)) groups.set(key, [...(groups.get(key) || []), r])
  }
  for (const group of groups.values()) {
    const replaced = new Set(group.map((r) => r.replaces_task_id))
    const leaves = group.filter((r) => !replaced.has(r.id))
    if (leaves.length !== 1) throw new Error('可见计划批次的补发链末项不唯一，明细无法按服务器口径核对。请刷新或联系管理员。')
    const r = leaves[0], item = taskDrill(r), due = stamp(r.due_at), completed = stamp(r.completed_at)
    result.plan.push(item)
    if (r.status === 'completed') {
      result.completed.push(item)
      if (due !== null && completed !== null && completed <= due) result.onTime.push(item)
    }
    if (r.status === 'cancelled') result.cancelled.push(item)
    if (r.status === 'not_done') result.notDone.push(item)
    // Backend includes not_done in overdue; don't substitute UI "open" status enums.
    if (!['completed', 'cancelled'].includes(String(r.status)) && due !== null && due < instant) result.overdue.push(item)
  }
  const itemIds = new Set<string>()
  for (const h of rows(sources.handovers)) {
    if (!['submitted', 'received'].includes(String(h.status)) || !within(h.submitted_at)) continue
    for (const r of rows(h.items)) {
      if (itemIds.has(text(r.id)) || r.handover_id !== h.id) throw new Error('交班条目编号或所属交班单异常。')
      itemIds.add(text(r.id))
      const item = drill(r, h.submitted_at, '/workflows/handovers?' + new URLSearchParams({ handover_id: text(h.id), item_id: text(r.id), action: '/handovers/{handover_id}', read: '1' }), `交班单 ${h.id}；来源 ${r.source_id || '未提供'}`)
      result.handover.push(item)
      if (r.status === 'received') result.received.push(item)
    }
  }
  for (const r of rows(sources.incidents)) {
    if (!within(r.occurred_at)) continue
    const to = '/workflows/incidents?' + new URLSearchParams({ incident_id: text(r.id), action: '/incidents/{incident_id}', read: '1' })
    const item = drill(r, r.occurred_at, to)
    result.incidents.push(item)
    if (r.status === 'closed') result.closedIncidents.push(item)
    if (r.rectification !== null) {
      const rect = object(r.rectification)
      text(rect.id); text(rect.status)
      if (rect.incident_id !== r.id) throw new Error('整改所属事件异常。')
      const due = stamp(rect.due_at)
      if (rect.status !== 'closed' && due !== null && due < instant) result.rectifications.push(drill({ ...rect, elder_id: r.elder_id }, rect.due_at, to, `所属事件 ${r.id}；时间为整改截止时间`))
    }
  }
  for (const r of rows(sources.feedback)) {
    if (r.kind !== 'feedback' || !within(r.created_at)) continue
    // The current family page has no case-detail route: show exact row here and name the list link honestly.
    const item = drill(r, r.created_at, '/family', '来源链接打开家属沟通列表；本行展示该反馈原始字段。')
    result.feedback.push(item)
    if (r.status === 'closed') result.replied.push(item)
  }
  return result
}
export function mismatches(m: Metrics, breakdown: Breakdown): ChartMetric[] {
  return chartGroups(m).flatMap((g) => g.items).filter((metric) => metric.count !== breakdown[metric.key].length)
}
/** Invalidate on new range, session change and unmount; checks include credentials, not only account name. */
export function createRequestGuard(scope: () => string | null) {
  let sequence = 0
  return {
    invalidate() { sequence++ },
    begin() {
      const id = ++sequence, owner = scope()
      return () => owner !== null && id === sequence && owner === scope()
    },
  }
}
