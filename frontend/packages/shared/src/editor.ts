import type { RecordDraft } from './types'
import type { AppMode } from './session'
export type { AppMode } from './session'
export type EditorPhase =
  | 'editing'
  | 'extracting'
  | 'reviewing'
  | 'submitting'
  | 'submitted'
  | 'uncertain'
  | 'discarded_local'
export interface RecordEditor {
  localId: string
  mode: AppMode
  accountKey: string
  elderId: string
  text: string
  sourceRevision: number
  editVersion: number
  persistedVersion?: number
  recoveredFrom?: string
  updatedAt: string
  phase: EditorPhase
  review: {
    observation: string
    followUp: string
    contactTarget: string
    assigneeId: string
    dueAt: string
    linkedTaskId: string
  }
  discardReason: string
  demoEpoch?: string
  ai?: {
    draft: RecordDraft
    localId: string
    elderId: string
    sourceText: string
    sourceRevision: number
  }
}
export function createRecordEditor(
  mode: AppMode,
  accountKey: string,
  elderId = '',
): RecordEditor {
  return {
    localId: crypto.randomUUID(),
    mode,
    accountKey,
    elderId,
    text: '',
    sourceRevision: 0,
    editVersion: 0,
    updatedAt: new Date().toISOString(),
    phase: 'editing',
    discardReason: '',
    review: {
      observation: '',
      followUp: '',
      contactTarget: '',
      assigneeId: '',
      dueAt: '',
      linkedTaskId: '',
    },
  }
}
export function touchRecordEditor(editor: RecordEditor, sourceChanged = false) {
  editor.editVersion += 1
  editor.updatedAt = new Date().toISOString()
  if (sourceChanged) {
    editor.sourceRevision += 1
    if (!['submitted', 'submitting', 'uncertain'].includes(editor.phase))
      editor.phase = 'editing'
  }
}
export function canConfirm(editor: RecordEditor) {
  const ai = editor.ai
  return (
    editor.phase === 'reviewing' &&
    Boolean(editor.elderId && editor.text.trim() && ai?.draft.id) &&
    ai?.localId === editor.localId &&
    ai?.elderId === editor.elderId &&
    ai?.draft.elderId === editor.elderId &&
    ai?.sourceRevision === editor.sourceRevision &&
    ai?.sourceText === editor.text
  )
}
