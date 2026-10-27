import { businessDay } from './business-time'
import { updateDemoState, type DemoStateV2 } from './demo-store'
import { readSession, type FrontendSession } from './session'
import type { Task } from './types'

export interface DemoTaskInput {
  epoch: string
  operationKey: string
  elderId: string
  title: string
  executionAt: string
  deadlineAt: string
  assignee: string
  shiftName: string
  scene: NonNullable<Task['scene']>
  confirmed: boolean
  sourceRecordId?: string
}
export function applyDemoTaskCreation(state: DemoStateV2, input: DemoTaskInput, actor: FrontendSession | null): Task {
  if (actor?.mode !== 'demo' || !actor.accountKey || !['admin', 'supervisor', 'caregiver'].includes(actor.role || '')) throw new Error('当前身份不能新建照护任务')
  if (state.epoch !== input.epoch) throw new Error('演示已重建，请重新进入页面核对')
  if (!input.confirmed || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.operationKey)) throw new Error('请核对并确认本次任务')
  const elder = state.elders.find(row => row.id === input.elderId && row.status === '入住')
  if (!elder) throw new Error('请重新选择当前入住老人')
  if (input.sourceRecordId && !state.records.some(record => record.id === input.sourceRecordId && record.elderId === input.elderId)) throw new Error('来源记录与当前老人不匹配，请重新核对')
  if (!input.title.trim() || !input.assignee.trim() || !input.shiftName.trim() || !['activity', 'rest', 'dining', 'communication', 'other'].includes(input.scene)) throw new Error('请补全事项、责任人、班次与服务场景')
  if (!businessDay(input.executionAt) || !businessDay(input.deadlineAt) || Date.parse(input.deadlineAt) <= Date.parse(input.executionAt)) throw new Error('请填写带时区的执行时间和晚于执行时间的截止时间')
  const id = `task-${input.operationKey}`
  const signature = JSON.stringify([input.elderId, input.title.trim(), new Date(input.executionAt).toISOString(), new Date(input.deadlineAt).toISOString(), input.assignee.trim(), input.shiftName.trim(), input.scene, actor.accountKey, input.sourceRecordId || ''])
  const marker = `task-create:${input.operationKey}`
  const previous = state.tasks.find(task => task.id === id)
  if (state.appliedOperations.includes(marker)) {
    if (!previous || state.confirmationBodies?.[marker] !== signature) throw new Error('同一请求内容不一致，请保留原内容核实')
    return previous
  }
  if (previous || state.tasks.some(task => task.elderId === input.elderId && task.status !== 'cancelled' && task.title.trim() === input.title.trim() && Date.parse(task.executionAt || task.dueAt) === Date.parse(input.executionAt))) throw new Error('已有相同事项与执行时间的任务，请勿重复新建')
  const task = { id, itemId: `item-${input.operationKey}`, elderId: elder.id, title: input.title.trim(), executionAt: input.executionAt, deadlineAt: input.deadlineAt, dueAt: input.deadlineAt, assignee: input.assignee.trim(), shift: input.shiftName.trim(), shiftName: input.shiftName.trim(), scene: input.scene, bedSnapshot: elder.bedLabel, nameSnapshot: elder.name, status: 'pending' as const, source: input.sourceRecordId ? 'record' as const : 'manual' as const, sourceRecordId: input.sourceRecordId }
  state.tasks.push(task)
  state.appliedOperations.push(marker)
  ;(state.confirmationBodies ||= {})[marker] = signature
  const at = new Date().toISOString()
  state.timeline.push({ id: `event-${input.operationKey}`, itemId: task.itemId, source: 'demo', label: '人工新建任务', detail: task.title, actor: actor.accountKey, happenedAt: at, enteredAt: at })
  if (input.sourceRecordId) {
    const record = state.records.find(record => record.id === input.sourceRecordId)!
    state.timeline.push({ id: `event-source-${input.operationKey}`, itemId: task.itemId, source: 'demo', label: '来源记录', detail: record.content, actor: record.actor, happenedAt: record.happenedAt, enteredAt: record.enteredAt })
  }
  return task
}
export async function createDemoTask(input: DemoTaskInput) {
  const actor = readSession()
  let result!: Task
  await updateDemoState(input.epoch, state => {
    const current = readSession()
    if (current?.accountKey !== actor?.accountKey || current?.role !== actor?.role || current?.mode !== actor?.mode) throw new Error('登录身份已变化，请重新进入页面')
    result = applyDemoTaskCreation(state, input, current)
  })
  return result
}
