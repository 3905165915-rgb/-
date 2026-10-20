import type { AppMode } from './session'
export interface HandoverEditor {
  editVersion?: number
  persistedVersion?: number
  recoveredFrom?: string
  recoveryWriter?: string
  localId: string
  mode: AppMode
  accountKey: string
  shiftId: string
  version: number
  note: string
  itemIds: string[]
  clarification: Record<string, string>
  phase: 'editing' | 'saved_local' | 'submitted_demo'
  updatedAt: string
  demoEpoch?: string
}
export function createHandoverEditor(
  mode: AppMode,
  accountKey: string,
  shiftId: string,
): HandoverEditor {
  return {
    editVersion: 0,
    localId: crypto.randomUUID(),
    mode,
    accountKey,
    shiftId,
    version: 1,
    note: '',
    itemIds: [],
    clarification: {},
    phase: 'editing',
    updatedAt: new Date().toISOString(),
  }
}
