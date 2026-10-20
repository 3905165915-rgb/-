import { describe, expect, it } from 'vitest'
import { canConfirm, createRecordEditor, touchRecordEditor } from './editor'
import { createInitialDemoState } from './demo'
import {
  canSendTaskAction,
  createTaskEditor,
  validateTaskEditor,
} from './task-editor'
import { canAccess } from './access'
import { normalizeRole } from './session'

function reviewed() {
  const editor = createRecordEditor('demo', 'caregiver', 'elder-305-wang')
  const draft = createInitialDemoState().drafts[0]
  editor.text = draft.originalText
  editor.phase = 'reviewing'
  editor.ai = {
    draft,
    localId: editor.localId,
    elderId: editor.elderId,
    sourceText: editor.text,
    sourceRevision: editor.sourceRevision,
  }
  return editor
}
describe('record editor source binding', () => {
  it('assigns a distinct local ID to every editor', () => {
    expect(reviewed().localId).not.toBe(reviewed().localId)
  })
  it('only allows a matching reviewed draft', () => {
    expect(canConfirm(reviewed())).toBe(true)
    for (const phase of [
      'editing',
      'extracting',
      'submitting',
      'uncertain',
      'submitted',
      'discarded_local',
    ] as const) {
      const editor = reviewed()
      editor.phase = phase
      expect(canConfirm(editor)).toBe(false)
    }
  })
  it('invalidates old AI after changing the source or elder', () => {
    const text = reviewed()
    text.text += '补充'
    touchRecordEditor(text, true)
    const elder = reviewed()
    elder.elderId = 'another-elder'
    const revision = reviewed()
    revision.sourceRevision++
    const local = reviewed()
    local.localId = 'another-editor'
    for (const editor of [text, elder, revision, local])
      expect(canConfirm(editor)).toBe(false)
  })
  it('field-only review edits do not invalidate original evidence', () => {
    const editor = reviewed()
    editor.review.observation = '人工核对'
    touchRecordEditor(editor)
    expect(editor.editVersion).toBe(1)
    expect(editor.sourceRevision).toBe(0)
    expect(canConfirm(editor)).toBe(true)
  })
})
describe('task capabilities', () => {
  it('validates required fields by action', () => {
    const form = createTaskEditor('task', 'demo', 'caregiver')
    expect(validateTaskEditor(form)).toHaveLength(1)
    form.result = '已联系'
    expect(canSendTaskAction(form)).toBe(true)
    form.action = 'not_done'
    expect(canSendTaskAction(form)).toBe(false)
    form.reason = '家属未接听'
    expect(canSendTaskAction(form)).toBe(true)
    form.action = 'transfer'
    expect(canSendTaskAction(form)).toBe(false)
    form.transferTo = '晚班护理'
    expect(canSendTaskAction(form)).toBe(true)
  })
  it('permits only contract-supported writes in api mode', () => {
    const form = createTaskEditor('task', 'api', 'caregiver')
    form.result = '已联系'
    expect(canSendTaskAction(form)).toBe(true)
    form.note = '未支持的附加字段'
    expect(canSendTaskAction(form)).toBe(false)
    form.note = ''
    form.action = 'start'
    expect(canSendTaskAction(form)).toBe(false)
    form.action = 'transfer'
    form.transferTo = 'other'
    expect(canSendTaskAction(form)).toBe(false)
  })
  it('rejects oversize or excessive attachments', () => {
    const form = createTaskEditor('task', 'demo', 'caregiver')
    form.result = '完成'
    form.attachments = [{ size: 5 * 1024 * 1024 + 1 } as File]
    expect(canSendTaskAction(form)).toBe(false)
    form.attachments = Array.from({ length: 4 }, () => ({ size: 1 }) as File)
    expect(canSendTaskAction(form)).toBe(false)
  })
})
describe('frontend role boundary', () => {
  it('denies unknown roles including prototype properties', () => {
    for (const role of [undefined, null, 'owner', 'toString', '__proto__'])
      expect(normalizeRole(role)).toBeNull()
    expect(canAccess(null, ['admin'])).toBe(false)
    expect(canAccess('family', ['caregiver'])).toBe(false)
    expect(normalizeRole('护理员')).toBe('caregiver')
    expect(canAccess('supervisor', ['supervisor', 'admin'])).toBe(true)
  })
})
