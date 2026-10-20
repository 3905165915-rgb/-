import type { AppMode } from './session'
import {
  hydrateTaskAttachments,
  identifyTaskAttachments,
  type TaskEditor,
} from './task-editor'
import type { HandoverEditor } from './handover-editor'
import {
  openDatabase,
  requestResult,
  scopedWrite,
  draftKey,
  writerId,
  previousWriterId,
  draftDeletionMarkers,
  journalFingerprint,
} from './storage'

export type WorkingKind = 'task' | 'handover'
export type WorkingEditor = TaskEditor | HandoverEditor
const prefix = 'hulao:working-journal:'
export const workingStore = (kind: WorkingKind) =>
  kind === 'task' ? 'taskEditors' : 'handoverWorkingDrafts'
export const workingId = (editor: WorkingEditor) =>
  editor.localId || ('taskId' in editor ? editor.taskId : editor.shiftId)
export const attachmentKey = (file: File) =>
  JSON.stringify([file.name, file.size, file.lastModified, file.type])
export function workingContent(editor: WorkingEditor) {
  const copy = { ...editor, persistedVersion: undefined }
  return JSON.stringify(
    'attachments' in copy
      ? { ...copy, attachments: copy.attachments.map(attachmentKey) }
      : copy,
  )
}
function journalKey(kind: WorkingKind, editor: WorkingEditor) {
  return (
    prefix +
    JSON.stringify([
      kind,
      editor.mode,
      editor.accountKey,
      workingId(editor),
      writerId(),
    ])
  )
}
export function writeWorkingJournal(kind: WorkingKind, editor: WorkingEditor) {
  if ('taskId' in editor) identifyTaskAttachments(editor)
  const copy =
    'attachments' in editor
      ? {
          ...editor,
          attachments: [],
          attachmentHints: editor.attachments.map((file, index) => ({
            id: editor.attachmentIds![index],
            name: file.name,
          })),
        }
      : editor
  localStorage.setItem(journalKey(kind, editor), JSON.stringify(copy))
}
export function clearWorkingJournal(kind: WorkingKind, editor: WorkingEditor) {
  const name = journalKey(kind, editor)
  const raw = localStorage.getItem(name)
  if (!raw) return
  const previous = JSON.parse(raw) as WorkingEditor & {
    attachmentHints?: Array<{ id?: string; name: string }>
  }
  const current =
    'taskId' in editor
      ? {
          ...editor,
          attachments: [],
          attachmentHints: editor.attachments.map((file, index) => ({
            id: editor.attachmentIds?.[index],
            name: file.name,
          })),
        }
      : editor
  if (
    JSON.stringify({ ...previous, persistedVersion: undefined }) ===
    JSON.stringify({ ...current, persistedVersion: undefined })
  )
    localStorage.removeItem(name)
}
function normalize<T extends WorkingEditor>(editor: T): T {
  return {
    ...editor,
    localId: workingId(editor),
    editVersion: editor.editVersion ?? 0,
    updatedAt: editor.updatedAt ?? new Date(0).toISOString(),
    ...('taskId' in editor
      ? {
          phase: editor.phase ?? 'editing',
          missingAttachments: editor.missingAttachments ?? [],
        }
      : {}),
  }
}
function valid(
  value: unknown,
  kind: WorkingKind,
  mode: AppMode,
  account: string,
): value is WorkingEditor {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    row.mode === mode &&
    row.accountKey === account &&
    (kind === 'task'
      ? [
          'taskId',
          'result',
          'reason',
          'note',
          'transferTo',
          'idempotencyKey',
        ].every((key) => typeof row[key] === 'string') &&
        Array.isArray(row.attachments)
      : ['localId', 'shiftId', 'note'].every(
          (key) => typeof row[key] === 'string',
        ) &&
        Array.isArray(row.itemIds) &&
        !!row.clarification)
  )
}
export async function listWorkingDrafts(
  kind: WorkingKind,
  mode: AppMode,
  account: string,
  group?: string,
): Promise<WorkingEditor[]> {
  const db = await openDatabase()
  const store = workingStore(kind)
  const saved = (await requestResult(
    db.transaction(store).objectStore(store).getAll(),
  )) as unknown[]
  const state =
    mode === 'demo'
      ? ((await requestResult(
          db.transaction('demoState').objectStore('demoState').get('current'),
        )) as { epoch?: string })
      : undefined
  const deleted = await draftDeletionMarkers(store, state?.epoch)
  const rows = new Map<string, WorkingEditor>()
  const scoped = (row: WorkingEditor) =>
    (!group || ('taskId' in row ? row.taskId : row.shiftId) === group) &&
    (mode !== 'demo' || Boolean(state?.epoch && row.demoEpoch === state.epoch))
  for (const value of saved) {
    if (!valid(value, kind, mode, account)) continue
    const row = normalize(value)
    if ('taskId' in row) hydrateTaskAttachments(row)
    if (scoped(row) && !deleted.has(draftKey(mode, account, workingId(row))))
      rows.set(workingId(row), { ...row, persistedVersion: row.editVersion })
  }
  const durable = new Map(rows)
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i)
    if (!name?.startsWith(prefix)) continue
    try {
      const serialized = localStorage.getItem(name)!
      const raw = JSON.parse(serialized) as WorkingEditor & {
        attachmentHints?: Array<{ id?: string; key?: string; name: string }>
      }
      const address = JSON.parse(name.slice(prefix.length)) as string[]
      if (address[0] !== kind || !valid(raw, kind, mode, account)) continue
      const row = normalize(raw)
      if (!scoped(row)) continue
      const ancestorDeletion = deleted.get(
        draftKey(mode, account, workingId(row)),
      )
      if (
        ancestorDeletion?.journals?.[name] ===
        (await journalFingerprint(serialized))
      )
        continue
      const committed = durable.get(workingId(row))
      if ('taskId' in row) {
        const persisted =
          committed && 'taskId' in committed ? committed : undefined
        const files = persisted?.attachments ?? []
        const hints = raw.attachmentHints ?? []
        row.attachments = hints.flatMap((hint) => {
          const index =
            persisted?.attachmentIds?.findIndex((id) => id === hint.id) ?? -1
          const file = index >= 0 ? files[index] : undefined
          return file ? [file] : []
        })
        row.attachmentIds = hints
          .filter(
            (hint) => hint.id && persisted?.attachmentIds?.includes(hint.id),
          )
          .map((hint) => hint.id!)
        hydrateTaskAttachments(row)
        row.missingAttachments = [
          ...new Set([
            ...(row.missingAttachments ?? []),
            ...hints
              .filter(
                (hint) =>
                  !hint.id || !persisted?.attachmentIds?.includes(hint.id),
              )
              .map((hint) => hint.name),
          ]),
        ]
      }
      delete (row as typeof raw).attachmentHints
      if (committed && workingContent(committed) === workingContent(row))
        continue
      if (ancestorDeletion || name !== journalKey(kind, row)) {
        row.recoveredFrom = workingId(row)
        row.recoveryWriter = address[4]
        row.localId = `${workingId(row)}-recovery-${address[4]}`
        row.persistedVersion = undefined
        if (
          deleted.has(draftKey(mode, account, row.localId)) ||
          rows.has(row.localId)
        )
          continue
      }
      rows.set(workingId(row), row)
    } catch {
      /* Ignore an unrelated or damaged journal, without removing it. */
    }
  }
  return [...rows.values()]
    .map((row) => {
      if ('taskId' in row && row.phase === 'submitting') {
        row.phase = 'uncertain'
        touchWorking(row)
      }
      return row
    })
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}
export async function saveWorkingDraft<T extends WorkingEditor>(
  kind: WorkingKind,
  editor: T,
) {
  if ('taskId' in editor) identifyTaskAttachments(editor)
  const snapshot = normalize(structuredClone(editor))
  const id = draftKey(snapshot.mode, snapshot.accountKey, workingId(snapshot))
  await scopedWrite(
    snapshot,
    workingStore(kind),
    (store, fail) => {
      const request = store.get(id)
      request.onsuccess = () => {
        try {
          const old = request.result as WorkingEditor | undefined
          const previous = old ? normalize(old) : undefined
          if (previous && 'taskId' in previous) hydrateTaskAttachments(previous)
          if (
            (!old && snapshot.persistedVersion !== undefined) ||
            (old &&
              ((old.editVersion ?? 0) !== snapshot.persistedVersion ||
                (old.editVersion ?? 0) > snapshot.editVersion! ||
                ((old.editVersion ?? 0) === snapshot.editVersion &&
                  workingContent(previous!) !== workingContent(snapshot))))
          ) {
            fail(new Error('草稿保存冲突：请载入已保存版本或另存当前内容'))
            return
          }
          snapshot.persistedVersion = snapshot.editVersion
          store.put(snapshot, id)
        } catch (error) {
          fail(error instanceof Error ? error : new Error('本机保存失败'))
        }
      }
    },
    id,
  )
  editor.persistedVersion = snapshot.editVersion
  try {
    clearWorkingJournal(kind, editor)
  } catch {
    /* The durable snapshot remains available. */
  }
}
export const saveTaskEditor = (editor: TaskEditor) =>
  saveWorkingDraft('task', editor)
export async function loadTaskEditor(
  mode: AppMode,
  account: string,
  taskId: string,
  localId?: string,
) {
  const rows = (await listWorkingDrafts(
    'task',
    mode,
    account,
    taskId,
  )) as TaskEditor[]
  const active =
    localId ??
    sessionStorage.getItem(
      'hulao:active-task:' + draftKey(mode, account, taskId),
    ) ??
    taskId
  const own = rows.find((row) => workingId(row) === active)
  if (own && localStorage.getItem(journalKey('task', own))) return own
  return (
    rows.find(
      (row) =>
        row.recoveredFrom === active &&
        row.recoveryWriter === previousWriterId(),
    ) ??
    own ??
    rows.find((row) => workingId(row) === taskId)
  )
}
export async function loadHandoverWorkingDraft(
  mode: AppMode,
  account: string,
  shift: string,
  localId?: string,
) {
  const rows = (await listWorkingDrafts(
    'handover',
    mode,
    account,
    shift,
  )) as HandoverEditor[]
  const active = localId ?? shift
  const own = rows.find((row) => workingId(row) === active)
  if (own && localStorage.getItem(journalKey('handover', own))) return own
  return (
    rows.find(
      (row) =>
        row.recoveredFrom === active &&
        row.recoveryWriter === previousWriterId(),
    ) ?? own
  )
}
export function rememberTaskDraft(editor: TaskEditor) {
  sessionStorage.setItem(
    'hulao:active-task:' +
      draftKey(editor.mode, editor.accountKey, editor.taskId),
    workingId(editor),
  )
}
export function touchWorking(editor: WorkingEditor) {
  editor.editVersion = (editor.editVersion ?? 0) + 1
  editor.updatedAt = new Date().toISOString()
}
export async function hasWriteAttempt(id: string) {
  const db = await openDatabase()
  return Boolean(
    await requestResult(
      db.transaction('writeAttempts').objectStore('writeAttempts').get(id),
    ),
  )
}
