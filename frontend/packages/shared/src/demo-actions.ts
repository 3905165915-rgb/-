import { loadDemoState, updateDemoState, type DemoStateV2 } from './demo-store'
import { readSession, type Role } from './session'
import type { RecordDraft, Task } from './types'
import type { RecordEditor } from './editor'
import type { TaskEditor } from './task-editor'
import { validateTaskEditor } from './task-editor'
import type { HandoverEditor } from './handover-editor'
import { businessDay } from './business-time'
import { offsetDemoDay } from './demo-sample'

/**
 * Demo identifiers are deliberately short so they can be read during a live
 * presentation. They are still unique within the current demo snapshot;
 * browser-only UUIDs remain reserved for local draft locks and idempotency.
 */
export function nextDemoIdentifier(state: DemoStateV2, prefix: string) {
  const values = [
    ...state.elders.map((row) => row.id),
    ...state.tasks.map((row) => row.id),
    ...state.drafts.map((row) => row.id),
    ...state.handover.map((row) => row.id),
    ...state.timeline.map((row) => row.id),
    ...state.familyCases.map((row) => row.id),
    ...state.records.map((row) => row.id),
    ...state.originals.map((row) => row.id),
    ...Object.values(state.confirmedDrafts).flatMap((row) => [
      row.record_id,
      ...row.task_ids,
    ]),
  ]
  const used = new Set(values)
  for (let number = 1; ; number += 1) {
    const candidate = `${prefix}-${String(number).padStart(2, '0')}`
    if (!used.has(candidate)) return candidate
  }
}

function actor() {
  return readSession()?.accountKey ?? 'demo-caregiver'
}
function checkEpoch(state: DemoStateV2, epoch?: string) {
  if (!epoch || state.epoch !== epoch)
    throw new Error('演示数据已重置，请重新载入草稿')
}
function requireInternal(expectedAccount?: string) {
  const session = readSession()
  if (session?.mode !== 'demo' || !session.accountKey || !['admin', 'supervisor', 'caregiver'].includes(session.role || ''))
    throw new Error('当前身份不能办理内部照护事项')
  if (expectedAccount && session.accountKey !== expectedAccount) throw new Error('登录账号已变化，请重新进入页面')
  return session.accountKey
}
export async function saveDemoOriginal(editor: RecordEditor) {
  const account = requireInternal(editor.accountKey)
  if (!editor.elderId || !editor.text.trim() || !editor.demoEpoch) throw new Error('请先选择老人并填写原文')
  let originalId = ''
  await updateDemoState(editor.demoEpoch, state => {
    requireInternal(account)
    if (!state.elders.some(e => e.id === editor.elderId)) throw new Error('老人已变化，请重新选择')
    const sourceKey = `${editor.localId}:${editor.sourceRevision}`
    const existing = state.originals.find(r => r.localId === sourceKey)
    if (existing) {
      if (existing.text !== editor.text || existing.elderId !== editor.elderId) throw new Error('同一原文版本存在冲突，请另存草稿')
      originalId = existing.id
      return
    }
    originalId = nextDemoIdentifier(state, 'original')
    state.originals.push({ id: originalId, elderId: editor.elderId, text: editor.text, localId: sourceKey, sourceRevision: editor.sourceRevision, savedAt: new Date().toISOString(), status: 'waiting' })
  })
  return originalId
}
function event(
  state: DemoStateV2,
  itemId: string,
  label: string,
  detail: string,
) {
  const now = new Date().toISOString()
  state.timeline.push({
    id: nextDemoIdentifier(state, 'event'),
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
  originalText = fields.observation,
) {
  const signature = JSON.stringify([elderId, fields, owner, dueAt, originalText])
  const existing = state.confirmedDrafts[id]
  if (existing) {
    if (state.confirmationBodies?.[id] !== signature) throw new Error('同一确认请求的内容已变化，请保留原内容核实')
    return existing
  }
  const recordId = nextDemoIdentifier(state, 'record')
  const itemId = `item-${id}`
  const taskIds: string[] = []
  // A suggestion is not an executable task: use the task form to explicitly
  // confirm its execution time, deadline, owner and shift.
  state.records.push({ id: recordId, elderId, title: '护理记录', content: originalText, category: '护理观察', happenedAt: new Date().toISOString(), enteredAt: new Date().toISOString(), actor: actor(), familyVisible: false })
  if (originalText === state.drafts[0]?.originalText) {
    const at = new Date().toISOString()
    state.memories.push({ id: `memory-${recordId}`, elderId, group: 'recentChanges', content: '本次想先休息，活动前先询问，声音小一点。', kind: 'temporary', status: 'candidate', sourceRecordIds: [recordId], quote: originalText, revision: 1, expiresAt: `${offsetDemoDay(businessDay(), 1)}T00:00:00+08:00`, history: [{ content: originalText, action: '整理为候选，待人工核对', actor: actor(), at }] })
  }
  event(state, itemId, '人工确认', fields.observation || '手工护理记录')
  state.confirmedDrafts[id] = { record_id: recordId, task_ids: taskIds }
  ;(state.confirmationBodies ||= {})[id] = signature
  return state.confirmedDrafts[id]
}
export async function saveDemoManualRecord(editor: RecordEditor) {
  const account = requireInternal(editor.accountKey)
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
    requireInternal(account)
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
      editor.text,
    )
  })
  return { status: 'confirmed' as const, ...result }
}
export async function applyDemoTaskAction(form: TaskEditor): Promise<Task> {
  const account = requireInternal(form.accountKey)
  const errors = validateTaskEditor(form)
  if (form.mode !== 'demo' || errors.length)
    throw new Error(errors[0] ?? '仅限演示模式')
  const current = await loadDemoState()
  let result!: Task
  await updateDemoState(current.epoch, (state) => {
    requireInternal(account)
    checkEpoch(state, form.demoEpoch)
    const task = state.tasks.find((item) => item.id === form.taskId)
    if (!task) throw new Error('任务不存在')
    const operation = `task:${form.taskId}:${form.idempotencyKey}`
    const signature = JSON.stringify([account, form.action, form.result, form.reason, form.transferTo, form.note, form.attachmentIds || []])
    if (state.appliedOperations.includes(operation)) {
      if (state.confirmationBodies?.[operation] !== signature) throw new Error('同一任务请求内容已变化，请核实原操作')
      result = task
      return
    }
    if (['completed', 'cancelled', 'not_done'].includes(task.status))
      throw new Error('任务状态已变化，请重新载入')
    if (form.action === 'start' && task.status === 'in_progress')
      throw new Error('任务已开始，请重新载入后登记结果')
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
    ;(state.confirmationBodies ||= {})[operation] = signature
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
  const account = requireInternal(editor.accountKey)
  if (editor.mode !== 'demo' || !editor.itemIds.length)
    throw new Error('请选择交班事项')
  const current = await loadDemoState()
  return updateDemoState(current.epoch, (state) => {
    requireInternal(account)
    checkEpoch(state, editor.demoEpoch)
    const operation = `handover:${editor.localId}:${editor.version}`
    const signature = JSON.stringify([account, editor.shiftId, editor.itemIds, editor.note, editor.clarification])
    if (state.appliedOperations.includes(operation)) {
      if (state.confirmationBodies?.[operation] !== signature) throw new Error('同一交班版本内容已变化，请核实原版本')
      return
    }
    for (const selectedId of editor.itemIds) {
      const task = state.tasks.find(
        (item) => item.id === selectedId || item.itemId === selectedId,
      )
      if (!task || !['pending', 'in_progress', 'overdue', 'transferred'].includes(task.status)) throw new Error('交班事项已变化，请重新选择')
      const clarification = editor.clarification[task.itemId]?.trim()
      const detail = [
        editor.note || task.result || task.title,
        clarification ? `待澄清：${clarification}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      state.handover.push({
        id: nextDemoIdentifier(state, 'handover'),
        itemId: task.itemId,
        shiftId: editor.shiftId,
        batchId: editor.localId,
        version: editor.version,
        title: task.title,
        detail,
        status: '待接收',
        owner: task.assignee,
        demoEpoch: state.epoch,
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
    ;(state.confirmationBodies ||= {})[operation] = signature
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
    async extractRecord(payload: { text: string; elder_id?: string; expectedEpoch?: string; sourceKey?: string }) {
      const account = requireInternal()
      const current = await loadDemoState()
      checkEpoch(current, payload.expectedEpoch)
      const preset = current.drafts[0]
      if (
        !preset ||
        payload.text.trim() !== preset.originalText ||
        payload.elder_id !== preset.elderId
      ) {
        await updateDemoState(current.epoch, state => {
          requireInternal(account)
          const original = state.originals.find(row => row.localId === payload.sourceKey && row.elderId === payload.elder_id && row.text === payload.text)
          if (original) { original.status = 'failed'; original.error = '当前演示没有此原文的预置整理结果，可手工核对或保留原文。' }
        })
        throw new Error('当前演示仅提供预置原文的AI草稿，请使用手工录入')
      }
      let draft!: RecordDraft
      await updateDemoState(current.epoch, (state) => {
        requireInternal(account)
        const original = state.originals.find(r => r.localId === payload.sourceKey && r.elderId === payload.elder_id && r.text === payload.text)
        if (!original) throw new Error('请先保存原文，再重试整理')
        const previous = state.drafts.find(row => row.id === original.draftId)
        if (previous) { draft = previous; return }
        draft = {
        ...preset,
        id: nextDemoIdentifier(state, 'draft'),
        demoEpoch: state.epoch,
        status: 'pending_review',
        fields: { ...preset.fields },
      }
        state.drafts.push(draft)
        original.status = 'completed'
        original.draftId = draft.id
        event(state, `item-${draft.id}`, '发现', payload.text)
        event(state, `item-${draft.id}`, 'AI草稿', '演示预置结果，等待人工核对')
      })
      return draft
    },
    async confirmRecord(id: string, payload: Partial<RecordDraft>) {
      const account = requireInternal()
      const current = await loadDemoState()
      let result!: { record_id: string; task_ids: string[] }
      await updateDemoState(current.epoch, (state) => {
        requireInternal(account)
        checkEpoch(state, payload.demoEpoch)
        const draft = state.drafts.find((item) => item.id === id)
        if (!draft) throw new Error('草稿不存在或演示已重置')
        if (draft.status === 'rejected') throw new Error('草稿已放弃')
        const fields = payload.fields ?? draft.fields
        if (!fields.observation.trim()) throw new Error('请填写观察结果')
        const candidate = payload.taskCandidates?.[0]
        result = addRecord(state, id, draft.elderId, fields, typeof candidate?.assigned_to === 'string' ? candidate.assigned_to : '', typeof candidate?.deadline_at === 'string' ? candidate.deadline_at : '', draft.originalText)
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
      payload: { status: 'received' | 'clarifying'; note?: string; expectedEpoch?: string },
    ) {
      const account = requireInternal()
      const current = await loadDemoState()
      return updateDemoState(current.epoch, (state) => {
        requireInternal(account)
        checkEpoch(state, payload.expectedEpoch)
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
