import type { RecordEditor } from './editor'
import type { HandoverEditor } from './handover-editor'
import type { AppMode } from './session'

const databaseName = 'hulao-frontend-v2'
export const stores = [
  'recordEditors',
  'taskEditors',
  'handoverEditors',
  'writeAttempts',
  'demoState',
  'handoverWorkingDrafts',
  'draftDeletions',
] as const
export type StoreName = (typeof stores)[number]
let database: Promise<IDBDatabase> | undefined
export function openDatabase(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onupgradeneeded = () => {
        for (const name of stores)
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name)
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          database = undefined
          window.dispatchEvent(new Event('hulao:storage-upgraded'))
        }
        resolve(request.result)
      }
      request.onerror = () => {
        database = undefined
        reject(request.error)
      }
      request.onblocked = () => {
        database = undefined
        reject(new Error('请关闭旧的演示页面后重试'))
      }
    })
  return database
}
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('本机保存失败'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('本机保存已中止'))
  })
}
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export function draftKey(mode: AppMode, accountKey: string, id: string) {
  return JSON.stringify([mode, accountKey, id])
}
const key = draftKey
const journalPrefix = 'hulao:editor-journal:'
let tabWriter: string | undefined
let precedingWriter: string | undefined
export function writerId() {
  if (!tabWriter) {
    try {
      precedingWriter =
        sessionStorage.getItem('hulao:editor-writer') ?? undefined
      tabWriter = crypto.randomUUID()
      sessionStorage.setItem('hulao:editor-writer', tabWriter)
    } catch {
      tabWriter = crypto.randomUUID()
    }
  }
  return tabWriter
}
export function previousWriterId() {
  writerId()
  return precedingWriter
}
function journalKey(editor: RecordEditor) {
  return (
    journalPrefix +
    key(editor.mode, editor.accountKey, editor.localId) +
    ':' +
    writerId()
  )
}
function recover(editor: RecordEditor): RecordEditor {
  if (editor.phase === 'submitting' || editor.phase === 'extracting') {
    editor.phase = editor.phase === 'submitting' ? 'uncertain' : 'editing'
    editor.editVersion += 1
    editor.updatedAt = new Date().toISOString()
  }
  return editor
}
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
function editorContent(editor: RecordEditor) {
  return JSON.stringify({ ...editor, persistedVersion: undefined })
}
async function demoEpoch(db: IDBDatabase) {
  return (
    (await requestResult(
      db.transaction('demoState').objectStore('demoState').get('current'),
    )) as { epoch?: string } | undefined
  )?.epoch
}
export async function scopedWrite(
  editor: { mode: AppMode; demoEpoch?: string },
  name: StoreName,
  write: (store: IDBObjectStore, fail: (error: Error) => void) => void,
  identity?: string,
) {
  const db = await openDatabase()
  const transaction = db.transaction(
    editor.mode === 'demo'
      ? [name, 'demoState', 'draftDeletions']
      : [name, 'draftDeletions'],
    'readwrite',
  )
  const done = transactionDone(transaction)
  let failure: Error | undefined
  const fail = (error: Error) => {
    failure = error
    transaction.abort()
  }
  const writeNow = () => {
    try {
      write(transaction.objectStore(name), fail)
    } catch (error) {
      fail(error instanceof Error ? error : new Error('本机保存失败'))
    }
  }
  const run = () => {
    if (!identity) return writeNow()
    const request = transaction
      .objectStore('draftDeletions')
      .get(JSON.stringify([name, identity]))
    request.onsuccess = () => {
      if (
        request.result &&
        (editor.mode !== 'demo' ||
          request.result.demoEpoch === editor.demoEpoch)
      )
        fail(new Error('此草稿已被清理，请另存当前内容'))
      else writeNow()
    }
  }
  if (editor.mode === 'demo') {
    const request = transaction.objectStore('demoState').get('current')
    request.onsuccess = () => {
      if (
        !editor.demoEpoch ||
        (request.result as { epoch?: string } | undefined)?.epoch !==
          editor.demoEpoch
      )
        fail(new Error('演示数据已重置，请新建草稿'))
      else run()
    }
  } else run()
  try {
    await done
  } catch (error) {
    throw failure ?? error
  }
}
function validEditor(
  value: unknown,
  mode: AppMode,
  account: string,
): value is RecordEditor {
  if (!value || typeof value !== 'object') return false
  const item = value as RecordEditor
  return (
    item.mode === mode &&
    item.accountKey === account &&
    typeof item.localId === 'string' &&
    Number.isSafeInteger(item.editVersion) &&
    item.editVersion >= 0 &&
    typeof item.text === 'string' &&
    typeof item.elderId === 'string' &&
    Number.isSafeInteger(item.sourceRevision) &&
    typeof item.updatedAt === 'string' &&
    Boolean(item.review) &&
    [
      'observation',
      'followUp',
      'contactTarget',
      'assigneeId',
      'dueAt',
      'linkedTaskId',
    ].every(
      (field) =>
        typeof item.review[field as keyof RecordEditor['review']] === 'string',
    ) &&
    [
      'editing',
      'extracting',
      'reviewing',
      'submitting',
      'submitted',
      'uncertain',
      'discarded_local',
    ].includes(item.phase)
  )
}
export function writeRecordJournal(editor: RecordEditor) {
  const storageKey = journalKey(editor)
  const previous = localStorage.getItem(storageKey)
  if (previous) {
    let old: RecordEditor | undefined
    try {
      old = JSON.parse(previous) as RecordEditor
    } catch {
      /* Replace a corrupt recovery log. */
    }
    if (
      old &&
      (old.editVersion > editor.editVersion ||
        (old.editVersion === editor.editVersion &&
          editorContent(old) !== editorContent(editor)))
    )
      throw new Error('草稿已在其他窗口修改，请保留当前文字并另建草稿')
  }
  localStorage.setItem(storageKey, JSON.stringify(editor))
}
export function clearRecordJournal(editor: RecordEditor) {
  const storageKey = journalKey(editor)
  const raw = localStorage.getItem(storageKey)
  if (
    raw &&
    editorContent(JSON.parse(raw) as RecordEditor) === editorContent(editor)
  )
    localStorage.removeItem(storageKey)
}
export async function saveRecordEditor(editor: RecordEditor) {
  const snapshot = plain(editor)
  const id = key(snapshot.mode, snapshot.accountKey, snapshot.localId)
  await scopedWrite(
    snapshot,
    'recordEditors',
    (store, fail) => {
      const request = store.get(id)
      request.onsuccess = () => {
        try {
          const old = request.result as RecordEditor | undefined
          if (!old && snapshot.persistedVersion !== undefined) {
            fail(new Error('草稿保存冲突：本机草稿已被清理，请另存当前内容'))
            return
          }
          if (
            old &&
            (old.editVersion !== snapshot.persistedVersion ||
              old.editVersion > snapshot.editVersion ||
              (old.editVersion === snapshot.editVersion &&
                editorContent(old) !== editorContent(snapshot)))
          ) {
            fail(
              new Error('草稿保存冲突：其他窗口已有更新，请保留文字并另建草稿'),
            )
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
  editor.persistedVersion = snapshot.persistedVersion
  try {
    clearRecordJournal(snapshot)
  } catch {
    /* The committed IDB snapshot remains the recovery source. */
  }
}
export async function loadRecordEditor(
  mode: AppMode,
  accountKey: string,
  localId: string,
) {
  const rows = await listRecordEditors(mode, accountKey)
  const own = rows.find((item) => item.localId === localId)
  if (own && localStorage.getItem(journalKey(own))) return own
  const previousRecovery = `${localId}-recovery-${previousWriterId()}`
  return rows.find((item) => item.localId === previousRecovery) ?? own
}
export async function listRecordEditors(
  mode: AppMode,
  accountKey: string,
): Promise<RecordEditor[]> {
  const db = await openDatabase()
  const epoch = mode === 'demo' ? await demoEpoch(db) : undefined
  const saved = (await requestResult(
    db.transaction('recordEditors').objectStore('recordEditors').getAll(),
  )) as unknown[]
  const map = new Map<string, RecordEditor>()
  for (const item of saved)
    if (validEditor(item, mode, accountKey))
      map.set(item.localId, { ...item, persistedVersion: item.editVersion })
  const durable = new Map(map)
  const deleted = await draftDeletionMarkers('recordEditors', epoch)
  for (const [id] of map)
    if (deleted.has(key(mode, accountKey, id))) map.delete(id)
  for (let index = 0; index < localStorage.length; index++) {
    const name = localStorage.key(index)
    if (!name?.startsWith(journalPrefix)) continue
    try {
      const raw = localStorage.getItem(name) ?? 'null'
      const item: unknown = JSON.parse(raw)
      if (!validEditor(item, mode, accountKey)) continue
      const ancestorDeletion = deleted.get(key(mode, accountKey, item.localId))
      if (
        ancestorDeletion?.journals?.[name] === (await journalFingerprint(raw))
      )
        continue
      const committed = durable.get(item.localId)
      if (committed && editorContent(committed) === editorContent(item))
        continue
      if (!ancestorDeletion && name === journalKey(item)) {
        map.set(item.localId, item)
      } else {
        const suffix =
          name.slice(
            (journalPrefix + key(mode, accountKey, item.localId)).length + 1,
          ) || 'legacy'
        const recoveryId = `${item.localId}-recovery-${suffix}`
        if (deleted.has(key(mode, accountKey, recoveryId))) continue
        if (!map.has(recoveryId))
          map.set(recoveryId, {
            ...item,
            localId: recoveryId,
            recoveredFrom: item.localId,
            persistedVersion: undefined,
            ai: undefined,
            phase: ['submitting', 'uncertain'].includes(item.phase)
              ? 'uncertain'
              : 'editing',
          })
      }
    } catch {
      /* Ignore an unrelated or corrupt recovery log. */
    }
  }
  return [...map.values()]
    .filter(
      (item) => mode !== 'demo' || Boolean(epoch && item.demoEpoch === epoch),
    )
    .map(recover)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export async function saveHandoverEditor(editor: HandoverEditor) {
  const snapshot = plain(editor)
  await scopedWrite(
    snapshot,
    'handoverEditors',
    (store, fail) => {
      const request = store.getAll()
      request.onsuccess = () => {
        try {
          const versions = (request.result as HandoverEditor[]).filter(
            (item) =>
              item.mode === snapshot.mode &&
              item.accountKey === snapshot.accountKey &&
              item.shiftId === snapshot.shiftId,
          )
          if (
            !versions.some(
              (item) =>
                item.localId === snapshot.localId &&
                item.version === snapshot.version,
            )
          ) {
            snapshot.version = Math.max(
              snapshot.version,
              ...versions.map((item) => item.version + 1),
            )
          }
          store.put(
            snapshot,
            key(
              snapshot.mode,
              snapshot.accountKey,
              `${snapshot.localId}:${snapshot.version}`,
            ),
          )
        } catch (error) {
          fail(error instanceof Error ? error : new Error('本机保存失败'))
        }
      }
    },
    key(
      snapshot.mode,
      snapshot.accountKey,
      `${snapshot.localId}:${snapshot.version}`,
    ),
  )
  editor.version = snapshot.version
}
export async function listHandoverEditors(
  mode: AppMode,
  accountKey: string,
  shiftId: string,
): Promise<HandoverEditor[]> {
  const db = await openDatabase()
  const all = (await requestResult(
    db.transaction('handoverEditors').objectStore('handoverEditors').getAll(),
  )) as HandoverEditor[]
  const epoch = mode === 'demo' ? await demoEpoch(db) : undefined
  return all
    .filter(
      (item) =>
        item.mode === mode &&
        item.accountKey === accountKey &&
        item.shiftId === shiftId &&
        (mode !== 'demo' || Boolean(epoch && item.demoEpoch === epoch)),
    )
    .sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version,
    )
}
export async function claimWriteAttempt(id: string) {
  const db = await openDatabase()
  const transaction = db.transaction('writeAttempts', 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore('writeAttempts')
  let claimed = false
  const request = store.get(id)
  request.onsuccess = () => {
    if (!request.result) {
      store.put({ id, createdAt: new Date().toISOString() }, id)
      claimed = true
    }
  }
  await done
  return claimed
}
export async function finishWriteAttempt(id: string) {
  const db = await openDatabase()
  const transaction = db.transaction('writeAttempts', 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore('writeAttempts').delete(id)
  await done
}
export function demoRecoveryEntries(): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  try {
  for (let index = 0; index < localStorage.length; index++) {
    const name = localStorage.key(index)
    if (
      name?.startsWith(journalPrefix) ||
      name?.startsWith('hulao:working-journal:') ||
      name?.startsWith('hulao:demo-form:') ||
      (name?.startsWith('hulao:workflow:v2:') && name.includes('care-plan-guide:demo'))
    ) {
      try {
        const raw = localStorage.getItem(name)
        const value = JSON.parse(raw || 'null')
        if (raw && (value?.mode === 'demo' || name.startsWith('hulao:demo-form:') || value?.body?.kind === 'demo')) entries.push([name, raw])
      } catch {
        /* Leave unrelated storage alone. */
      }
    }
  }
  } catch { /* IDB batch fencing still rejects stale forms if storage is denied. */ }
  return entries
}
export function clearDemoJournals(entries = demoRecoveryEntries()) {
  for (const [name, raw] of entries) {
    try { if (localStorage.getItem(name) === raw) localStorage.removeItem(name) }
    catch { /* Never turn a committed rebuild into a reported failure. */ }
  }
  try {
    const keys = Object.keys(sessionStorage).filter(name => name.startsWith('hulao:active-handover:') && name.includes('["demo",'))
    for (const name of keys) sessionStorage.removeItem(name)
  } catch { /* Stale pointers are harmless: draft loading checks the epoch. */ }
}

export async function deletedDraftKeys(store: StoreName, epoch?: string) {
  return new Set((await draftDeletionMarkers(store, epoch)).keys())
}
interface DraftDeletionMarker {
  store: string
  key: string
  mode?: string
  demoEpoch?: string
  journals?: Record<string, string>
}
export async function journalFingerprint(raw: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw),
  )
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
export async function draftDeletionMarkers(store: StoreName, epoch?: string) {
  const db = await openDatabase()
  const rows = (await requestResult(
    db.transaction('draftDeletions').objectStore('draftDeletions').getAll(),
  )) as DraftDeletionMarker[]
  return new Map(
    rows
      .filter(
        (row) =>
          row.store === store &&
          (!epoch || row.mode !== 'demo' || row.demoEpoch === epoch),
      )
      .map((row) => [row.key, row]),
  )
}
