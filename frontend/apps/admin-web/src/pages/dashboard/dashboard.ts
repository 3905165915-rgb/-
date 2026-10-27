export interface DateWindow { start: string; end: string }
export interface DashboardFilters { elder_id: string; shift_id: string; status: string }
export interface DashboardSelection { kind: 'card' | 'comparison' | 'distribution' | 'trend' | 'activity' | 'pending'; section?: string; key?: string }
export type Row = Record<string, unknown>
export interface DashboardCard { count: number; previous_count: number; change: number; change_ratio: number | null; items: Row[] }
export interface DashboardGroup { key: string; count: number; ids: string[] }
export interface DashboardSnapshot {
  as_of: string
  timezone: 'Asia/Shanghai'
  filters: { start_inclusive: string; end_exclusive: string; elder_id: string | null; shift_id: string | null; status: string | null }
  cards: Record<string, DashboardCard>
  distributions: Record<string, DashboardGroup[]>
  task_trend: Row[]
  details: Record<string, { count: number; items: Row[] }>
  pending_work: { count: number; items: Row[]; definition: string }
  comparison: { filters: Row; cards: Record<string, { count: number; items: Row[] }>; definition: string }
  excluded: Row
  definitions: Record<string, string>
}
const day = 86400000
function dateNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null
  const n = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n : null
}
export function validateWindow(window: DateWindow): string | null {
  const start = dateNumber(window.start), end = dateNumber(window.end)
  if (start === null || end === null) return '请输入有效日期（YYYY-MM-DD）。'
  const days = (end - start) / day
  return days >= 1 && days <= 366 ? null : '结束日期不计入区间，统计范围须为 1–366 天。'
}
export function defaultWindow(now = Date.now(), days = 1): DateWindow {
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10)
  return { start: new Date(dateNumber(today)! - (days - 1) * day).toISOString().slice(0, 10),
    end: new Date(dateNumber(today)! + day).toISOString().slice(0, 10) }
}

/** All loaded task types, grouped by the dashboard's service/deadline date. */
export function taskArrangementSeries(snapshot: DashboardSnapshot) {
  return snapshot.task_trend.map(point => {
    const date = String(point.date)
    const tasks = (snapshot.details.tasks?.items || []).filter(task => {
      const at = stamp(task.metric_at)
      return at !== null && new Date(at + 8 * 3600000).toISOString().slice(0, 10) === date
    })
    return { date, count: tasks.length, ids: tasks.map(task => String(task.id)),
      completed: tasks.filter(task => task.status === 'completed').length,
      overdue: tasks.filter(task => task.status === 'overdue').length }
  })
}

export function taskStatusSegments(snapshot: DashboardSnapshot) {
  const groups = snapshot.distributions.tasks || []
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  let offset = 0
  return { total, groups: groups.map(group => {
    const fraction = total ? group.count / total : 0
    const segment = { ...group, fraction, offset }
    offset += fraction
    return segment
  }) }
}
export function stamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match || dateNumber(match[1]) === null) return null
  const [, , hour, minute, second, , , offsetHour, offsetMinute] = match
  if (+hour > 23 || +minute > 59 || +second > 59 || (offsetHour && (+offsetHour > 14 || +offsetMinute > 59 || (+offsetHour === 14 && +offsetMinute !== 0)))) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
function fail(): never { throw new Error('管理看板数据格式异常，请刷新后联系管理员。') }
function obj(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Row
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail()
  return value
}
function str(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return fail()
  return value
}
function ratio(value: unknown) {
  const row = obj(value), numerator = count(row.numerator), denominator = count(row.denominator)
  if (numerator > denominator) return fail()
  if (denominator === 0 ? row.ratio !== null : typeof row.ratio !== 'number' || !Number.isFinite(row.ratio) || Math.abs(row.ratio - numerator / denominator) > 1e-10) return fail()
  return { numerator, denominator, ratio: row.ratio as number | null }
}
function objectRows(value: unknown) {
  if (!Array.isArray(value)) return fail()
  return value.map(row => obj(row))
}
export function dashboardRowKey(row: Row): string { return `${str(row.kind)}:${str(row.id)}` }
function identifiedRows(value: unknown) {
  const rows = objectRows(value), ids = new Set<string>()
  for (const row of rows) {
    const id = dashboardRowKey(row)
    str(row.status)
    if (ids.has(id)) return fail()
    ids.add(id)
  }
  return rows
}
function countedRows(value: unknown) {
  const row = obj(value), items = identifiedRows(row.items)
  if (count(row.count) !== items.length) return fail()
  return { count: items.length, items }
}
function card(value: unknown): DashboardCard {
  const row = obj(value), items = identifiedRows(row.items)
  const total = count(row.count), previous = count(row.previous_count), change = row.change
  if (total !== items.length || typeof change !== 'number' || !Number.isSafeInteger(change) || change !== total - previous) return fail()
  const changeRatio = previous === 0 ? null : change / previous
  if (changeRatio === null ? row.change_ratio !== null : typeof row.change_ratio !== 'number' || !Number.isFinite(row.change_ratio) || Math.abs(row.change_ratio - changeRatio) >= 1e-10) return fail()
  return { count: total, previous_count: previous, change, change_ratio: row.change_ratio as number | null, items }
}
const sectionKinds: Record<string, string[]> = {
  tasks: ['task'], handovers: ['handover_item'], incidents: ['incident'], memories: ['memory'],
  impressions: ['impression_point'], family: ['summary', 'feedback'], photo_reviews: ['attachments', 'image_analyses'],
}
const cardTests: Record<string, (item: Row) => boolean> = {
  pending_tasks: item => item.kind === 'task' && ['pending', 'in_progress', 'overdue'].includes(String(item.status)),
  overdue_tasks: item => item.kind === 'task' && item.status === 'overdue',
  pending_handovers: item => item.kind === 'handover_item' && item.status !== 'received',
  untriaged_incidents: item => item.kind === 'incident' && item.status === 'reported',
  pending_rectification_review: item => item.kind === 'incident' && item.status === 'awaiting_review',
  pending_reviews: item => ['attachments', 'image_analyses'].includes(String(item.kind)) ||
    (item.kind === 'memory' && ['candidate', 'review_required', 'review_due'].includes(String(item.status))) ||
    (item.kind === 'impression_point' && item.status === 'candidate') || (item.kind === 'summary' && item.status === 'draft'),
}
function exactKeys(value: unknown, keys: string[]) {
  const row = obj(value)
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) return fail()
  return row
}
function sameIds(actual: string[], expected: string[]) {
  // Distribution IDs are bare IDs and can repeat for different kinds in the same section.
  const counts = new Map<string, number>()
  for (const id of expected) counts.set(id, (counts.get(id) || 0) + 1)
  for (const id of actual) {
    const remaining = counts.get(id) || 0
    if (!remaining) return fail()
    counts.set(id, remaining - 1)
  }
  if (actual.length !== expected.length) return fail()
}
function sameRows(actual: Row[], expected: Row[]) {
  const source = new Map(expected.map(item => [dashboardRowKey(item), item]))
  if (actual.length !== expected.length) return fail()
  for (const item of actual) {
    const original = source.get(dashboardRowKey(item))
    if (!original || Object.entries(original).some(([key, value]) => !sameJson(item[key], value))) return fail()
  }
}
function sameJson(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => sameJson(actual[index], value))
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
    const entries = Object.entries(expected)
    return Object.keys(actual).length === entries.length && entries.every(([key, value]) => Object.prototype.hasOwnProperty.call(actual, key) && sameJson((actual as Row)[key], value))
  }
  return false
}
function distributionSource(section: string) {
  return section === 'incident_categories' ? { section: 'incidents', field: 'category' }
    : section === 'family_kind' ? { section: 'family', field: 'kind' } : { section, field: 'status' }
}
function groupValue(item: Row, field: string) { return String(item[field] || 'unclassified') }
function validateFilters(value: unknown, start: number, end: number, requested: DashboardFilters) {
  const filters = obj(value)
  if (stamp(filters.start_inclusive) !== start || stamp(filters.end_exclusive) !== end ||
    ['elder_id', 'shift_id', 'status'].some(key => filters[key] !== (requested[key as keyof DashboardFilters] || null))) return fail()
  return filters as DashboardSnapshot['filters']
}
function validateItem(item: Row, start: number, end: number, asOf: number, filters: DashboardFilters) {
  const metric = stamp(item.metric_at)
  if (!Object.values(sectionKinds).some(kinds => kinds.includes(String(item.kind))) || metric === null || metric < start || metric >= end ||
    (item.kind !== 'task' && metric > asOf) || (filters.elder_id && item.elder_id !== filters.elder_id) ||
    (filters.status && item.status !== filters.status)) return fail()
  if (item.kind === 'task' && (typeof item.is_plan_occurrence !== 'boolean' ||
    (item.is_plan_occurrence && stamp(item.scheduled_at) !== metric))) return fail()
}
export function validateDashboard(value: unknown, requested: DateWindow, filters: DashboardFilters): DashboardSnapshot {
  if (validateWindow(requested)) return fail()
  const row = obj(value), rawFilters = obj(row.filters)
  const start = Date.parse(requested.start + 'T00:00:00+08:00'), end = Date.parse(requested.end + 'T00:00:00+08:00')
  const asOf = stamp(row.as_of)
  if (row.timezone !== 'Asia/Shanghai' || asOf === null) return fail()
  validateFilters(rawFilters, start, end, filters)
  const rawCards = exactKeys(row.cards, Object.keys(cardTests)), cards: Record<string, DashboardCard> = {}
  for (const [key, value] of Object.entries(rawCards)) cards[key] = card(value)
  const rawDetails = exactKeys(row.details, Object.keys(sectionKinds)), details: DashboardSnapshot['details'] = {}
  for (const [key, value] of Object.entries(rawDetails)) {
    const section = countedRows(value)
    for (const item of section.items) {
      if (!sectionKinds[key].includes(String(item.kind))) return fail()
      validateItem(item, start, end, asOf, filters)
    }
    details[key] = section
  }
  const all = Object.values(details).flatMap(section => section.items)
  if (all.length > 10000) return fail()
  for (const [key, value] of Object.entries(cards)) sameRows(value.items, all.filter(cardTests[key]))
  const distributions: Record<string, DashboardGroup[]> = {}
  for (const [key, values] of Object.entries(exactKeys(row.distributions, [...Object.keys(sectionKinds), 'incident_categories', 'family_kind']))) {
    const groups: DashboardGroup[] = [], seen = new Set<string>()
    const source = distributionSource(key), items = details[source.section].items
    for (const value of objectRows(values)) {
      const groupKey = str(value.key), ids = value.ids
      if (seen.has(groupKey) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()) || count(value.count) !== ids.length || !ids.length) return fail()
      sameIds(ids as string[], items.filter(item => groupValue(item, source.field) === groupKey).map(item => str(item.id)))
      seen.add(groupKey)
      groups.push({ key: groupKey, count: ids.length, ids: ids as string[] })
    }
    if (items.some(item => !seen.has(groupValue(item, source.field)))) return fail()
    distributions[key] = groups
  }
  const trends = objectRows(row.task_trend)
  if (trends.length !== (end - start) / day) return fail()
  for (const [index, item] of trends.entries()) {
    const lower = start + index * day
    if (item.date !== new Date(lower + 8 * 3600000).toISOString().slice(0, 10)) return fail()
    const tasks = details.tasks.items.filter(task => task.is_plan_occurrence && stamp(task.metric_at)! <= asOf &&
      stamp(task.metric_at)! >= lower && stamp(task.metric_at)! < lower + day)
    if (!Array.isArray(item.ids) || item.ids.some(id => typeof id !== 'string') || count(item.count) !== tasks.length) return fail()
    sameIds(item.ids as string[], tasks.map(task => str(task.id)))
    const completion = ratio(item.completion)
    const done = tasks.filter(task => task.status === 'completed')
    const onTime = done.filter(task => stamp(task.completed_at) !== null && stamp(task.due_at) !== null && stamp(task.completed_at)! <= stamp(task.due_at)!)
    if (completion.denominator !== tasks.length || completion.numerator !== done.length || count(item.on_time) !== onTime.length ||
      count(item.not_done) !== tasks.filter(task => task.status === 'not_done').length || count(item.overdue) !== tasks.filter(task => task.status === 'overdue').length) return fail()
  }
  const pendingRaw = obj(row.pending_work), pendingItems = identifiedRows(pendingRaw.items)
  if (count(pendingRaw.count) !== pendingItems.length || typeof pendingRaw.definition !== 'string') return fail()
  sameRows(pendingItems, all.filter(item => Object.values(cardTests).some(test => test(item)) ||
    (item.kind === 'incident' && item.status !== 'closed') || (item.kind === 'feedback' && item.status !== 'closed')))
  const excluded = exactKeys(row.excluded, ['future_trend_task_rows', 'invalid_task_time_rows']), definitions = obj(row.definitions)
  for (const value of Object.values(excluded)) count(value)
  if (excluded.future_trend_task_rows !== details.tasks.items.filter(task => stamp(task.metric_at)! > asOf).length) return fail()
  for (const value of Object.values(definitions)) str(value)
  const comparison = obj(row.comparison), comparisonCards: Record<string, { count: number; items: Row[] }> = {}
  const comparisonFilters = validateFilters(comparison.filters, start - (end - start), start, filters)
  const previousItems = new Map<string, Row>()
  for (const [key, value] of Object.entries(exactKeys(comparison.cards, Object.keys(cardTests)))) {
    const entry = countedRows(value)
    if (cards[key].previous_count !== entry.count) return fail()
    for (const item of entry.items) {
      if (!cardTests[key](item)) return fail()
      validateItem(item, start - (end - start), start, asOf, filters)
      const existing = previousItems.get(dashboardRowKey(item))
      if (existing) sameRows([item], [existing])
      previousItems.set(dashboardRowKey(item), item)
    }
    comparisonCards[key] = entry
  }
  for (const [key, entry] of Object.entries(comparisonCards)) sameRows(entry.items, [...previousItems.values()].filter(cardTests[key]))
  if (typeof comparison.definition !== 'string') return fail()
  return {
    as_of: row.as_of as string, timezone: 'Asia/Shanghai',
    filters: { start_inclusive: rawFilters.start_inclusive as string, end_exclusive: rawFilters.end_exclusive as string,
      elder_id: typeof rawFilters.elder_id === 'string' ? rawFilters.elder_id : null,
      shift_id: typeof rawFilters.shift_id === 'string' ? rawFilters.shift_id : null,
      status: typeof rawFilters.status === 'string' ? rawFilters.status : null },
    cards, distributions, task_trend: trends, details, pending_work: { count: pendingItems.length, items: pendingItems, definition: pendingRaw.definition },
    comparison: { filters: comparisonFilters, cards: comparisonCards, definition: comparison.definition }, excluded, definitions: definitions as Record<string, string>,
  }
}
export function formatTime(value: unknown) {
  const n = stamp(value)
  return n === null ? '时间待核实' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(n)
}
export function formatRatio(value: unknown) {
  const result = ratio(value)
  return result.ratio === null ? '暂无可计算数据' : new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(result.ratio)
}
export const statusLabels: Record<string, string> = {
  pending: '待执行', in_progress: '进行中', overdue: '已逾期', completed: '已完成', not_done: '未完成', cancelled: '已取消',
  submitted: '已提交', received: '已接收', clarifying: '待澄清', reported: '待人工分级', rectifying: '整改中', closed: '已关闭',
  awaiting_review: '待独立复查', assigned: '待整改', candidate: '待核实', pending_review: '待审核', pending_management: '待主管审核',
  review_due: '待复核', effective: '有效', published: '已发布', draft: '草稿', open: '待回复', unclassified: '待分类',
  transferred: '已转交', confirmed: '已确认', review_required: '待复核', suspended: '已暂停', rejected: '已驳回', retired: '已停用', withdrawn: '已撤回',
}
export const statusOptions = Object.keys(statusLabels).filter(key => key !== 'unclassified')
export const incidentCategoryLabels: Record<string, string> = {
  fall: '跌倒', choking: '噎食', pressure_injury: '压力性损伤', wandering: '走失', medication: '用药相关', burn: '烫伤',
  conflict: '冲突', infection_concern: '感染相关关注', service_omission: '服务遗漏', restraint: '约束相关', injury: '伤害相关', other: '其他', unclassified: '待分类',
}
export const kindLabels: Record<string, string> = {
  task: '照护任务', handover_item: '交班事项', incident: '安全事件', memory: '照护记忆', impression_point: '老人印象',
  summary: '家属简报', feedback: '家属反馈', attachments: '观察照片', image_analyses: '照片观察草稿',
}
export function dashboardGroupLabel(section: string, key: string) {
  return (section === 'incident_categories' ? incidentCategoryLabels[key] : section === 'family_kind' ? kindLabels[key] : statusLabels[key]) || '分类待核实'
}
export const dashboardLabels: Record<string, string> = {
  pending_tasks: '待执行任务', overdue_tasks: '逾期任务', pending_handovers: '待接续交班', untriaged_incidents: '待分级事件',
  pending_rectification_review: '待独立复查整改', pending_reviews: '待审核事项', tasks: '任务', handovers: '交班事项', incidents: '安全事件',
  memories: '照护记忆', impressions: '老人印象候选', family: '家属沟通', photo_reviews: '照片审核', incident_categories: '安全事件类别', family_kind: '家属沟通类型',
  snapshot: '快照口径', time: '时间口径', task_trend: '计划任务口径', pending: '待处理口径', shift: '班次口径', personalization: '个性化照护口径', safety: '安全事件口径',
}
export function dashboardLocation(item: Row) {
  const id = typeof item.id === 'string' ? item.id : ''
  const query = new URLSearchParams()
  if (item.kind === 'task') { query.set('task', id); return '/tasks?' + query }
  if (item.kind === 'handover_item') { query.set('handover_id', String(item.handover_id || '')); query.set('item_id', String(item.id)); query.set('action', '/handovers/{handover_id}'); query.set('read', '1'); return '/workflows/handovers?' + query }
  if (item.kind === 'incident') { query.set('incident_id', id); query.set('action', '/incidents/{incident_id}'); query.set('read', '1'); return '/workflows/incidents?' + query }
  if (item.kind === 'memory') { query.set('memory_id', id); query.set('action', '/memories/{memory_id}'); query.set('read', '1'); return '/workflows/memories?' + query }
  if (item.kind === 'change_review') { query.set('change_review_id', id); return '/workflows/changes?' + query }
  if (item.kind === 'summary' || item.kind === 'feedback') {
    const summary = item.kind === 'summary'
    query.set(summary ? 'summary_id' : 'feedback_id', id)
    query.set('action', summary ? '/family/summaries/{summary_id}/review' : '/family/feedback/{feedback_id}/reply')
    return '/workflows/family?' + query
  }
  if (item.kind === 'attachments' || item.kind === 'image_analyses') { query.set('elder', String(item.elder_id || '')); query.set('elder_id', String(item.elder_id || '')); query.set(item.kind === 'attachments' ? 'attachment_id' : 'analysis_id', id); query.set('action', '/records/manual'); return '/workflows/records?' + query }
  if (item.kind === 'impression_point') { query.set('impression_id', String(item.report_id || '')); query.set('point_id', String(item.point_id || '')); return '/elders/' + encodeURIComponent(String(item.elder_id || '')) + '?' + query }
  return '/dashboard'
}
export function selectedDashboardRows(snapshot: DashboardSnapshot, selection: DashboardSelection): Row[] {
  if (selection.kind === 'card') return snapshot.cards[selection.key || '']?.items || []
  if (selection.kind === 'comparison') return snapshot.comparison.cards[selection.key || '']?.items || []
  if (selection.kind === 'pending') return snapshot.pending_work.items
  if (selection.kind === 'activity') {
    const ids = new Set(taskArrangementSeries(snapshot).find(point => point.date === selection.key)?.ids || [])
    return snapshot.details.tasks.items.filter(task => ids.has(String(task.id)))
  }
  if (selection.kind === 'distribution') {
    const group = snapshot.distributions[selection.section || '']?.find(row => row.key === selection.key)
    if (!group) return []
    const source = distributionSource(selection.section || '')
    const items = snapshot.details[source.section]?.items || []
    const buckets = new Map<string, Row[]>()
    for (const item of items.filter(item => groupValue(item, source.field) === selection.key)) {
      const id = String(item.id)
      buckets.set(id, [...(buckets.get(id) || []), item])
    }
    return group.ids.flatMap(id => { const item = buckets.get(id)?.shift(); return item ? [item] : [] })
  }
  const trend = snapshot.task_trend.find(row => row.date === selection.key)
  if (!trend || !Array.isArray(trend.ids)) return []
  const map = new Map((snapshot.details.tasks?.items || []).map(row => [String(row.id), row]))
  return trend.ids.map(id => map.get(String(id))!).filter(Boolean)
}
/** Invalidate late responses after filter/session changes and unmount. */
export function createRequestGuard(scope: () => string | null) {
  let sequence = 0
  return { invalidate() { sequence++ }, begin() { const id = ++sequence, owner = scope(); return () => owner !== null && id === sequence && owner === scope() } }
}

/** Capture draft filters once, for both the URL and response echo validation. */
export function captureDashboardRequest(window: DateWindow, filters: DashboardFilters) {
  const captured = { window: { ...window }, filters: { ...filters } }
  const params = new URLSearchParams(captured.window)
  for (const [key, value] of Object.entries(captured.filters)) if (value) params.set(key, value)
  return { ...captured, path: '/reports/dashboard?' + params }
}

/** Stop pagination when the session/request is superseded, before issuing another request. */
export async function loadDashboardDirectory(request: (path: string) => Promise<unknown>, path: '/elders' | '/shifts', accepts: () => boolean): Promise<Row[] | null> {
  const items: Row[] = [], ids = new Set<string>()
  while (accepts()) {
    const response = await request(`${path}?limit=200&offset=${items.length}`)
    if (!accepts()) return null
    const rows = objectRows(response)
    if (rows.length > 200) return fail()
    for (const row of rows) {
      const id = str(row.id)
      str(row.name)
      if (ids.has(id)) return fail()
      ids.add(id); items.push(row)
    }
    if (rows.length < 200) return items
  }
  return null
}
