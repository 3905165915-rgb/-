import type { DemoPlan } from './demo'
import { loadDemoState, updateDemoState, type DemoStateV2 } from './demo-store'
import { readSession, type FrontendSession } from './session'
import { businessDay } from './business-time'

export interface DemoPlanConfirmation {
  epoch: string
  expectedRevision: number
  operationKey: string
  elderId: string
  assessmentId: string
  items: DemoPlan['items']
  humanConfirmed: boolean
}
export interface DemoPlanReceipt {
  plan: DemoPlan
  taskIds: string[]
  replayed: boolean
}
export class DemoPlanStateChanged extends Error {}
function manager(session: FrontendSession | null): FrontendSession {
  if (session?.mode !== 'demo' || !session.accountKey || !['admin', 'supervisor'].includes(session.role || ''))
    throw new Error('照护计划须由主管或管理员人工确认。')
  return session
}
function validate(input: DemoPlanConfirmation) {
  if (!input.humanConfirmed) throw new Error('请先逐项核对并勾选人工确认。')
  if (!input.operationKey || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.operationKey) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    throw new Error('计划请求编号或资料版本无效，请重新载入。')
  if (!input.items.length || input.items.length > 120) throw new Error('请核对照护事项，至少需要一项，最多120项。')
  const occurrences = new Set<string>()
  for (const item of input.items) {
    if (!item.title?.trim() || !item.assignee?.trim() || !item.shiftName?.trim() ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.executionAt) ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.deadlineAt) ||
        !businessDay(item.executionAt) || !businessDay(item.deadlineAt) ||
        Date.parse(item.deadlineAt) <= Date.parse(item.executionAt))
      throw new Error('请补全事项、执行时间、晚于执行时间的截止时间、责任人和班次。')
    const occurrence = JSON.stringify([item.title.trim(), Date.parse(item.executionAt)])
    if (occurrences.has(occurrence)) throw new Error('同一事项的执行时间不能重复。')
    occurrences.add(occurrence)
  }
}
const normalizedItems = (items: DemoPlan['items']): DemoPlan['items'] => items.map(item => ({
  title: item.title.trim(), executionAt: new Date(item.executionAt).toISOString(), deadlineAt: new Date(item.deadlineAt).toISOString(),
  assignee: item.assignee.trim(), shiftName: item.shiftName.trim(),
}))

// Exported for deterministic transaction tests. updateDemoState commits this
// mutation, the operation marker and every pending task in one IDB transaction.
export function applyDemoPlanConfirmation(state: DemoStateV2, input: DemoPlanConfirmation, session: FrontendSession | null, now: string): DemoPlanReceipt {
  const actor = manager(session)
  validate(input)
  if (state.epoch !== input.epoch) throw new DemoPlanStateChanged('演示数据已重置，请重新载入后核对计划。')
  const items = normalizedItems(input.items)
  const confirmedBy = actor.userId || actor.accountKey
  const id = `plan-${input.operationKey}`
  const marker = `plan-confirm:${input.operationKey}`
  const plan = state.plans.find(row => row.id === id)
  const taskIds = items.map((_, index) => `task-${input.operationKey}-${index + 1}`)
  if (state.appliedOperations.includes(marker)) {
    if (!plan || plan.elderId !== input.elderId || plan.assessmentId !== input.assessmentId || plan.confirmedBy !== confirmedBy ||
        JSON.stringify(plan.items) !== JSON.stringify(items) || taskIds.some(taskId => !state.tasks.some(task => task.id === taskId)))
      throw new Error('请求编号已用于其他内容或回执不完整，请保留原请求核实。')
    return { plan, taskIds, replayed: true }
  }
  if (state.revision !== input.expectedRevision) throw new DemoPlanStateChanged('演示资料已变化，请重新载入并核对后确认。')
  const elder = state.elders.find(row => row.id === input.elderId)
  if (!elder || elder.status !== '入住') throw new Error('请先选择当前入住老人。')
  if (!state.assessments.some(row => row.id === input.assessmentId && row.elderId === input.elderId && row.status === 'valid'))
    throw new Error('当前老人缺少有效评估，请先完成评估。')
  if (plan || taskIds.some(taskId => state.tasks.some(task => task.id === taskId))) throw new Error('计划或任务编号已存在，请核实原请求。')
  if (items.some(item => state.tasks.some(task => task.elderId === input.elderId && task.status !== 'cancelled' && task.title.trim() === item.title && Date.parse(task.executionAt || task.dueAt) === Date.parse(item.executionAt))))
    throw new DemoPlanStateChanged('同一老人已有相同事项与执行时间的任务，请调整预览，避免重复派发。')
  const confirmed: DemoPlan = { id, elderId: input.elderId, assessmentId: input.assessmentId, status: 'active', confirmedBy, confirmedAt: now, items }
  state.plans.push(confirmed)
  state.tasks.push(...items.map((item, index) => ({
    id: taskIds[index], itemId: `${id}:item:${index + 1}`, elderId: input.elderId, title: item.title,
    executionAt: item.executionAt, deadlineAt: item.deadlineAt, dueAt: item.deadlineAt,
    assignee: item.assignee, shift: item.shiftName, shiftName: item.shiftName,
    bedSnapshot: elder.bedLabel, nameSnapshot: elder.name, source: 'plan' as const, status: 'pending' as const,
  })))
  state.appliedOperations.push(marker)
  return { plan: confirmed, taskIds, replayed: false }
}
export async function confirmDemoPlan(input: DemoPlanConfirmation): Promise<DemoPlanReceipt> {
  const actor = manager(readSession())
  // Give a reset a clear error before starting a write; the transaction checks
  // epoch and revision again, so the read does not authorize stale data.
  const current = await loadDemoState()
  if (current.epoch !== input.epoch) throw new DemoPlanStateChanged('演示数据已重置，请重新载入后核对计划。')
  let receipt: DemoPlanReceipt | undefined
  await updateDemoState(input.epoch, state => {
    const latest = manager(readSession())
    if (latest.accountKey !== actor.accountKey || latest.role !== actor.role || latest.userId !== actor.userId)
      throw new Error('登录身份已变化，请重新载入后操作。')
    receipt = applyDemoPlanConfirmation(state, input, latest, new Date().toISOString())
  })
  if (!receipt) throw new Error('计划确认结果待核实，请使用原请求重试。')
  return receipt
}
