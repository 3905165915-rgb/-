import { loadDemoState, updateDemoState, type DemoStateV2 } from './demo-store'
import { readSession, type Role } from './session'
import type { RecordDraft, Task } from './types'
import type { RecordEditor } from './editor'
import type { TaskEditor } from './task-editor'
import { validateTaskEditor } from './task-editor'
import type { HandoverEditor } from './handover-editor'

function actor() {
  return readSession()?.accountKey ?? 'demo-caregiver'
}
function checkEpoch(state: DemoStateV2, epoch?: string) {
  if (!epoch || state.epoch !== epoch)
    throw new Error('演示数据已重置，请重新载入草稿')
}
function event(
  state: DemoStateV2,
  itemId: string,
  label: string,
  detail: string,
) {
  const now = new Date().toISOString()
  state.timeline.push({
    id: crypto.randomUUID(),
    itemId,
    source: 'demo',
    label,
    detail,
    actor: actor(),
    happenedAt: now,
    enteredAt: now,
  })
}
function addRecord(
  state: DemoStateV2,
  id: string,
  elderId: string,
  fields: RecordDraft['fields'],
  owner = '',
  dueAt = '',
) {
  const existing = state.confirmedDrafts[id]
  if (existing) return existing
  const recordId = `demo-record-${crypto.randomUUID()}`
  const itemId = `item-${id}`
  const taskIds: string[] = []
  if (fields.followUp.trim()) {
    const taskId = `demo-task-${crypto.randomUUID()}`
    state.tasks.push({
      id: taskId,
      itemId,
      sourceDraftId: id,
      elderId,
      title: fields.followUp,
      shift: '晚班',
      assignee: owner || '待分派',
      dueAt: dueAt || '待确认期限',
      status: 'pending',
    })
    taskIds.push(taskId)
  }
  event(state, itemId, '人工确认', fields.observation || '手工护理记录')
  state.confirmedDrafts[id] = { record_id: recordId, task_ids: taskIds }
  return state.confirmedDrafts[id]
}
export async function saveDemoManualRecord(editor: RecordEditor) {
  if (
    editor.mode !== 'demo' ||
    !editor.elderId ||
    !editor.text.trim() ||
    !editor.review.observation.trim()
  )
    throw new Error('请确认老人并填写原文和观察结果')
  const current = await loadDemoState()
  let result!: { record_id: string; task_ids: string[] }
  await updateDemoState(current.epoch, (state) => {
    checkEpoch(state, editor.demoEpoch)
    if (!state.elders.some((elder) => elder.id === editor.elderId))
      throw new Error('老人不存在')
    result = addRecord(
      state,
      editor.localId,
      editor.elderId,
      editor.review,
      editor.review.assigneeId,
      editor.review.dueAt,
    )
  })
  return { status: 'confirmed' as const, ...result }
}
export async function applyDemoTaskAction(form: TaskEditor): Promise<Task> {
  const errors = validateTaskEditor(form)
  if (form.mode !== 'demo' || errors.length)
    throw new Error(errors[0] ?? '仅限演示模式')
  const current = await loadDemoState()
  let result!: Task
  await updateDemoState(current.epoch, (state) => {
    checkEpoch(state, form.demoEpoch)
    const task = state.tasks.find((item) => item.id === form.taskId)
    if (!task) throw new Error('任务不存在')
    const operation = `task:${form.taskId}:${form.idempotencyKey}`
    if (state.appliedOperations.includes(operation)) {
      result = task
      return
    }
    if (['completed', 'cancelled', 'not_done'].includes(task.status))
      throw new Error('任务状态已变化，请重新载入')
    if (form.action === 'start') task.status = 'in_progress'
    if (form.action === 'complete') {
      task.status = 'completed'
      task.result = form.result
    }
    if (form.action === 'not_done') {
      task.status = 'not_done'
      task.result = form.reason
    }
    if (form.action === 'transfer') {
      task.status = 'transferred'
      task.assignee = form.transferTo
      task.result = form.note || '已转交，尚未完成'
    }
    state.appliedOperations.push(operation)
    event(
      state,
      task.itemId,
      {
        start: '开始执行',
        complete: '执行完成',
        not_done: '未执行',
        transfer: '转交',
      }[form.action],
      task.result || task.title,
    )
    result = task
  })
  return result
}
export async function submitDemoHandover(editor: HandoverEditor) {
  if (editor.mode !== 'demo' || !editor.itemIds.length)
    throw new Error('请选择交班事项')
  const current = await loadDemoState()
  return updateDemoState(current.epoch, (state) => {
    checkEpoch(state, editor.demoEpoch)
    const operation = `handover:${editor.localId}:${editor.version}`
    if (state.appliedOperations.includes(operation)) return
    for (const selectedId of editor.itemIds) {
      const task = state.tasks.find(
        (item) => item.id === selectedId || item.itemId === selectedId,
      )
      if (!task) throw new Error('交班事项已变化，请重新选择')
      const clarification = editor.clarification[task.itemId]?.trim()
      const detail = [
        editor.note || task.result || task.title,
        clarification ? `待澄清：${clarification}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      state.handover.push({
        id: `handover-${crypto.randomUUID()}`,
        itemId: task.itemId,
        shiftId: editor.shiftId,
        batchId: editor.localId,
        version: editor.version,
        title: task.title,
        detail,
        status: '待接收',
        owner: task.assignee,
      })
      event(state, task.itemId, '交班', editor.note || task.title)
    }
    state.handoverVersions.push({
      id: editor.localId,
      shiftId: editor.shiftId,
      version: editor.version,
      note: editor.note,
      itemIds: [...editor.itemIds],
      createdAt: new Date().toISOString(),
    })
    state.appliedOperations.push(operation)
  })
}
export function createDemoApi() {
  return {
    async login(payload: { username: string; password: string }) {
      const users: Record<string, Role> = {
        admin: 'admin',
        supervisor: 'supervisor',
        caregiver: 'caregiver',
        family: 'family',
      }
      const role = Object.hasOwn(users, payload.username)
        ? users[payload.username]
        : null
      if (!role)
        throw new Error(
          '请选择演示身份：admin、supervisor、caregiver 或 family',
        )
      return { access_token: 'demo-token', role }
    },
    async elders(_params?: Record<string, string | number>) {
      return (await loadDemoState()).elders
    },
    async extractRecord(payload: { text: string; elder_id?: string }) {
      const current = await loadDemoState()
      const preset = current.drafts[0]
      if (
        !preset ||
        payload.text.trim() !== preset.originalText ||
        payload.elder_id !== preset.elderId
      ) {
        throw new Error('当前演示仅提供预置原文的AI草稿，请使用手工录入')
      }
      const draft: RecordDraft = {
        ...preset,
        id: `demo-draft-${crypto.randomUUID()}`,
        status: 'pending_review',
        fields: {
          observation: '午餐进食约一半',
          followUp: '晚上联系女儿',
          contactTarget: '女儿',
        },
      }
      await updateDemoState(current.epoch, (state) => {
        state.drafts.push(draft)
        event(state, `item-${draft.id}`, '发现', payload.text)
        event(state, `item-${draft.id}`, 'AI草稿', '演示预置结果，等待人工核对')
      })
      return draft
    },
    async confirmRecord(id: string, payload: Partial<RecordDraft>) {
      const current = await loadDemoState()
      let result!: { record_id: string; task_ids: string[] }
      await updateDemoState(current.epoch, (state) => {
        const draft = state.drafts.find((item) => item.id === id)
        if (!draft) throw new Error('草稿不存在或演示已重置')
        if (draft.status === 'rejected') throw new Error('草稿已放弃')
        const fields = payload.fields ?? draft.fields
        if (!fields.observation.trim()) throw new Error('请填写观察结果')
        result = addRecord(state, id, draft.elderId, fields)
        draft.status = 'confirmed'
      })
      return { status: 'confirmed' as const, ...result }
    },
    async tasks(params?: Record<string, string>) {
      const tasks = (await loadDemoState()).tasks
      return tasks.filter(
        (task) =>
          (!params?.elder_id || task.elderId === params.elder_id) &&
          (!params?.status || task.status === params.status) &&
          (!params?.shift || task.shift === params.shift),
      )
    },
    async completeTask(
      id: string,
      payload: { result: string; idempotencyKey: string },
    ) {
      const current = await loadDemoState()
      return applyDemoTaskAction({
        taskId: id,
        accountKey: actor(),
        mode: 'demo',
        action: 'complete',
        result: payload.result,
        idempotencyKey: payload.idempotencyKey,
        reason: '',
        transferTo: '',
        note: '',
        attachments: [],
        demoEpoch: current.epoch,
      })
    },
    async handover(shiftId: string) {
      return (await loadDemoState()).handover.filter(
        (item) => item.shiftId === shiftId,
      )
    },
    async receiveHandover(
      id: string,
      payload: { status: 'received' | 'clarifying'; note?: string },
    ) {
      const current = await loadDemoState()
      return updateDemoState(current.epoch, (state) => {
        const item = state.handover.find((entry) => entry.id === id)
        if (!item) throw new Error('交班事项不存在')
        if (payload.status === 'clarifying' && !payload.note?.trim())
          throw new Error('请填写澄清内容')
        if (payload.status === 'received' && item.status === '已接收') return
        item.status = payload.status === 'received' ? '已接收' : '需澄清'
        item.note = payload.note ?? ''
        item.receiverId = actor()
        item.receivedBy = actor()
        item.receivedAt = new Date().toISOString()
        event(
          state,
          item.itemId ?? id,
          payload.status === 'received' ? '接班接收' : '接班澄清',
          payload.note || item.title,
        )
      })
    },
    async timeline(itemId: string) {
      return (await loadDemoState()).timeline.filter(
        (item) => item.itemId === itemId,
      )
    },
    async familyCases() {
      return (await loadDemoState()).familyCases.filter((item) => item.public)
    },
  }
}
