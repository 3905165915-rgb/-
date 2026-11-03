import { requestBody, schemas, type Row } from './model'

export interface PlanItemDraft {
  key: string
  title: string
  scene: string
  instruction: string
  times: string[]
  weekdays: number[]
  every_n_days: number
  window_minutes: number
  condition: string
}
export interface PlanDraft {
  title: string
  goal: string
  startsOn: string
  endsOn: string
  serviceDate: string
  shiftId: string
  assignedTo: string
  reason: string
  items: PlanItemDraft[]
}
export interface PlanOccurrence {
  key: string
  title: string
  instruction: string
  condition: string
  time: string
  deadline: string
}
export function newPlanItem(key: string): PlanItemDraft {
  return { key, title: '', scene: 'other', instruction: '', times: [''], weekdays: [1, 2, 3, 4, 5, 6, 7], every_n_days: 1, window_minutes: 60, condition: '' }
}
export function businessDate(now = new Date()): string {
  return new Date(now.valueOf() + 8 * 3600000).toISOString().slice(0, 10)
}
export function selectPlanElder(context: unknown, elders: { id: string }[]): string {
  // An invalid explicit context must never silently select a different elder.
  if (typeof context === 'string' && context) return elders.some(row => row.id === context) ? context : ''
  return elders.length === 1 ? elders[0].id : ''
}
export function usableAssessments(rows: Row[], elderId: string, now = Date.now()): Row[] {
  return rows.filter(row => row.elder_id === elderId && row.status === 'confirmed' &&
    row.effective !== false && row.review_due !== true &&
    Number.isSafeInteger(row.revision) && Number(row.revision) >= 1 &&
    typeof row.review_due_at === 'string' && Date.parse(row.review_due_at) > now)
}
export function planOccurrences(create: Row, serviceDate: string): PlanOccurrence[] {
  const day = new Date(serviceDate + 'T00:00:00Z')
  if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== serviceDate ||
      serviceDate < String(create.starts_on) || serviceDate > String(create.ends_on))
    throw new Error('服务日期必须在计划生效日期内。')
  const elapsed = Math.round((day.valueOf() - Date.parse(String(create.starts_on) + 'T00:00:00Z')) / 86400000)
  return (create.items as Row[]).flatMap(item => {
    if (!(item.weekdays as number[]).includes(day.getUTCDay() || 7) || elapsed % Number(item.every_n_days ?? 1)) return []
    return (item.times as string[]).map(time => {
      const at = Date.parse(`${serviceDate}T${time}:00+08:00`)
      return { key: `${item.key}:${time}`, title: String(item.title), instruction: String(item.instruction), condition: String(item.condition || ''), time: new Date(at).toISOString(), deadline: new Date(at + Number(item.window_minutes ?? 60) * 60000).toISOString() }
    })
  }).sort((a, b) => a.time.localeCompare(b.time))
}
export function preparePlan(elderId: string, assessment: Row | undefined, draft: PlanDraft, shifts: Row[], staff: Row[]) {
  if (!assessment || !usableAssessments([assessment], elderId).length) throw new Error('请先选择当前老人有效且已人工确认的评估。')
  const create = requestBody('/care-plans', schemas.PlanCreate, {
    elder_id: elderId, assessment_id: assessment.id, expected_assessment_revision: assessment.revision,
    title: draft.title.trim(), goal: draft.goal.trim(), starts_on: draft.startsOn, ends_on: draft.endsOn,
    items: draft.items.map(item => ({ ...item, title: item.title.trim(), instruction: item.instruction.trim(), condition: item.condition.trim() || undefined })),
  })
  if (draft.startsOn > draft.endsOn) throw new Error('结束日期不能早于生效日期。')
  const keys = new Set<string>()
  for (const item of create.items as Row[]) {
    if (keys.has(String(item.key))) throw new Error('照护事项不能重复。')
    keys.add(String(item.key))
    if (new Set(item.times as string[]).size !== (item.times as string[]).length) throw new Error('同一事项的执行时间不能重复。')
    if (new Set(item.weekdays as number[]).size !== (item.weekdays as number[]).length) throw new Error('每周执行日不能重复。')
  }
  const shift = shifts.find(row => row.id === draft.shiftId && row.status === 'open')
  const owner = staff.find(row => row.id === draft.assignedTo && row.active !== false)
  if (!shift || !owner || !Array.isArray(shift.caregiver_ids) || !shift.caregiver_ids.includes(owner.id))
    throw new Error('请选择开放班次及该班次内的有效责任人。')
  const occurrences = planOccurrences(create, draft.serviceDate)
  if (!occurrences.length) throw new Error('所选服务日期没有应执行事项，请核对周期和日期。')
  if (occurrences.some(item => Date.parse(item.time) < Date.parse(String(shift.start_at)) || Date.parse(item.deadline) > Date.parse(String(shift.end_at))))
    throw new Error('事项执行时间及执行窗口须落在所选班次内；请调整时间或选择覆盖这些时段的班次。')
  const generate = requestBody('/care-plans/{plan_id}/generate', schemas.PlanGenerate, {
    expected_revision: 1, service_date: draft.serviceDate, shift_id: shift.id, assigned_to: owner.id,
  })
  delete generate.expected_revision
  const review = requestBody('/care-plans/{plan_id}/review', schemas.PlanReview, { expected_revision: 1, action: 'approve', reason: draft.reason.trim() })
  return { create, generate, reason: String(review.reason), occurrences }
}

export type PlanStepKind = 'create' | 'approve' | 'generate'
export const planStepLabels: Record<PlanStepKind, string> = { create: '保存计划草稿', approve: '人工审批计划', generate: '生成所选日任务' }
export interface PlanStep {
  kind: PlanStepKind
  key: string
  pending?: { path: string; payload: Row }
  receipt?: unknown
}
export interface PlanExecution {
  version: 1
  account: string
  create: Row
  generate: Row
  reason: string
  steps: PlanStep[]
}
export function newPlanExecution(account: string, prepared: Pick<ReturnType<typeof preparePlan>, 'create' | 'generate' | 'reason'>, key: () => string): PlanExecution {
  return structuredClone({ version: 1, account, create: prepared.create, generate: prepared.generate, reason: prepared.reason,
    steps: (['create', 'approve', 'generate'] as const).map(kind => ({ kind, key: key() })) })
}
function planReceipt(value: unknown, elderId: unknown, planId?: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('计划回执格式异常，请保留原请求重试核实。')
  const row = value as Row
  if (typeof row.id !== 'string' || !row.id.trim() || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 ||
      row.elder_id !== elderId || (planId !== undefined && row.id !== planId))
    throw new Error('计划回执与当前老人或计划不匹配，请保留原请求重试核实。')
  return row
}
export function restorePlanExecution(value: unknown, account: string, elderId: string): PlanExecution {
  const tx = value as PlanExecution
  if (!tx || tx.version !== 1 || tx.account !== account || tx.create?.elder_id !== elderId || !tx.generate ||
      typeof tx.reason !== 'string' || !Array.isArray(tx.steps) || tx.steps.length !== 3 ||
      tx.steps.some((step, index) => step.kind !== ['create', 'approve', 'generate'][index] || !step.key ||
        (step.receipt !== undefined && !step.pending) || (index > 0 && step.pending && tx.steps[index - 1].receipt === undefined)))
    throw new Error('计划恢复日志不完整，请保留日志并核实已有计划，不能重新创建。')
  for (let index = 0; index < tx.steps.length; index++) {
    const step = tx.steps[index]
    if (step.pending) {
      const expected = pendingStep(tx, index)
      if (step.pending.path !== expected.path || JSON.stringify(step.pending.payload) !== JSON.stringify(expected.payload))
        throw new Error('计划恢复日志与原请求不符，请保留日志并联系管理员。')
    }
    if (step.receipt !== undefined) validateReceipt(tx, index, step.receipt)
  }
  return tx
}
function pendingStep(tx: PlanExecution, index: number): { path: string; payload: Row } {
  if (index === 0) return { path: '/care-plans', payload: tx.create }
  const previous = planReceipt(tx.steps[index - 1].receipt, tx.create.elder_id)
  return { path: `/care-plans/${encodeURIComponent(String(previous.id))}/${index === 1 ? 'review' : 'generate'}`,
    payload: index === 1 ? { expected_revision: previous.revision, action: 'approve', reason: tx.reason }
      : { ...tx.generate, expected_revision: previous.revision } }
}
function validateReceipt(tx: PlanExecution, index: number, value: unknown) {
  if (index < 2) {
    const row = planReceipt(value, tx.create.elder_id, index === 1 ? (tx.steps[0].receipt as Row).id : undefined)
    if (index === 1 && Number(row.revision) <= Number((tx.steps[0].receipt as Row).revision))
      throw new Error('审批回执版本未更新，请保留原请求重试核实。')
  } else {
    // No response schema is published for generation. Require explicit task
    // identities; an arbitrary 200 response is not evidence of task creation.
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成任务回执格式异常，请保留原请求重试核实。')
    const row = value as Row
    const tasks = row.tasks ?? row.created ?? row.task_ids
    if ('error' in row || ['failed', 'partial', 'pending'].includes(String(row.status)) || Number(row.failed_count || 0) > 0 || (Array.isArray(row.failed) && row.failed.length) || !Array.isArray(tasks) || tasks.some(task => typeof task === 'string' ? !task.trim() : !task || typeof task !== 'object' || typeof task.id !== 'string' || !task.id.trim()))
      throw new Error('生成任务结果待核实，请保留原请求，查看失败明细后接续。')
  }
}
export async function runPlanExecution(tx: PlanExecution,
  write: (path: string, payload: Row, key: string) => Promise<unknown>,
  save: (tx: PlanExecution) => void,
): Promise<void> {
  for (const [index, step] of tx.steps.entries()) {
    if (step.receipt !== undefined) continue
    if (!step.pending) step.pending = structuredClone(pendingStep(tx, index))
    // Persist the exact body and key BEFORE sending any write, including retries.
    save(tx)
    const receipt = await write(step.pending.path, step.pending.payload, step.key)
    validateReceipt(tx, index, receipt)
    step.receipt = receipt
    save(tx)
  }
}
