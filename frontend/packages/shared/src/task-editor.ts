import type { AppMode } from './session'
export type TaskAction = 'start' | 'complete' | 'not_done' | 'transfer'
export interface TaskEditor {
  localId?: string
  editVersion?: number
  persistedVersion?: number
  updatedAt?: string
  phase?: 'editing' | 'submitting' | 'uncertain' | 'submitted'
  missingAttachments?: string[]
  attachmentIds?: string[]
  recoveredFrom?: string
  recoveryWriter?: string
  taskId: string
  accountKey: string
  mode: AppMode
  action: TaskAction
  result: string
  reason: string
  transferTo: string
  note: string
  attachments: File[]
  idempotencyKey: string
  demoEpoch?: string
}
export function createTaskEditor(
  taskId: string,
  mode: AppMode,
  accountKey: string,
): TaskEditor {
  return {
    localId: taskId,
    editVersion: 0,
    updatedAt: new Date().toISOString(),
    phase: 'editing',
    attachmentIds: [],
    taskId,
    mode,
    accountKey,
    action: 'complete',
    result: '',
    reason: '',
    transferTo: '',
    note: '',
    attachments: [],
    idempotencyKey: crypto.randomUUID(),
  }
}
const attachmentSelections = new WeakMap<File, string>()
export function hydrateTaskAttachments(editor: TaskEditor) {
  editor.attachmentIds = editor.attachments.map((file, index) => {
    const id =
      editor.attachmentIds?.[index] ??
      `legacy:${editor.mode}:${editor.accountKey}:${editor.localId || editor.taskId}:${index}`
    attachmentSelections.set(file, id)
    return id
  })
}
export function identifyTaskAttachments(editor: TaskEditor) {
  editor.attachmentIds = editor.attachments.map((file) => {
    const id = attachmentSelections.get(file) ?? crypto.randomUUID()
    attachmentSelections.set(file, id)
    return id
  })
}
export function snapshotTaskEditor(editor: TaskEditor) {
  identifyTaskAttachments(editor)
  const next = structuredClone(editor)
  hydrateTaskAttachments(next)
  return next
}
export function validateTaskEditor(form: TaskEditor) {
  const errors: string[] = []
  if (form.missingAttachments?.length)
    errors.push('部分附件尚未保存，请重新选择或移除缺失附件')
  if (form.action === 'complete' && !form.result.trim())
    errors.push('请填写完成结果')
  if (form.action === 'not_done' && !form.reason.trim())
    errors.push('请选择未执行原因')
  if (form.action === 'transfer' && !form.transferTo.trim())
    errors.push('请选择转交对象')
  if (
    form.attachments.length > 3 ||
    form.attachments.some((file) => file.size > 5 * 1024 * 1024)
  )
    errors.push('最多3个附件，每个不超过5MB')
  return errors
}
export function canSendTaskAction(form: TaskEditor) {
  return (
    validateTaskEditor(form).length === 0 &&
    (form.mode === 'demo' ||
      (form.action === 'complete' &&
        form.attachments.length === 0 &&
        !form.note.trim()))
  )
}
