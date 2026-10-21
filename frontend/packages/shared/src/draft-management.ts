import type { AppMode } from './session'
import {
  draftKey,
  openDatabase,
  requestResult,
  transactionDone,
  listRecordEditors,
  journalFingerprint,
  type StoreName,
} from './storage'
import { listWorkingDrafts, workingId } from './working-storage'

export interface LocalDraftRow {
  store: StoreName
  key: string
  id: string
  type: '记录' | '任务' | '交班草稿' | '交班版本'
  title: string
  preview: string
  status: string
  updatedAt: string
  attachments: number
  bytes: number
  protected: boolean
  url: string
  demoEpoch?: string
}
export const draftStores = [
  'recordEditors',
  'taskEditors',
  'handoverWorkingDrafts',
  'handoverEditors',
] as const
interface ScopedDraft {
  mode: AppMode
  accountKey: string
  localId?: string
  taskId?: string
  shiftId?: string
  phase?: string
  idempotencyKey?: string
  ai?: { draft: { id: string } }
  updatedAt?: string
  version?: number
  text?: string
  note?: string
  result?: string
  attachments?: File[]
  elderId?: string
  demoEpoch?: string
  review?: Record<string, string>
  itemIds?: string[]
}
function protectedDraft(
  row: ScopedDraft,
  locks: Set<string>,
  unknown: boolean,
) {
  if (
    !unknown &&
    row.taskId &&
    row.phase === 'submitted' &&
    row.idempotencyKey &&
    !locks.has(row.idempotencyKey)
  )
    return false
  return (
    unknown ||
    ['submitting', 'uncertain'].includes(row.phase ?? '') ||
    !!(row.idempotencyKey && locks.has(row.idempotencyKey)) ||
    !!(row.taskId && locks.has(JSON.stringify([row.mode, row.taskId]))) ||
    !!(
      row.ai && locks.has(JSON.stringify([row.mode, 'record', row.ai.draft.id]))
    )
  )
}
function unknownLocks(locks: Set<string>, rows: ScopedDraft[]) {
  return [...locks].some((id) => {
    try {
      const parsed = JSON.parse(id)
      if (Array.isArray(parsed) && ['api', 'demo'].includes(parsed[0]))
        return false
    } catch {
      /* Legacy UUID locks require a matching task editor. */
    }
    return !rows.some((row) => row.idempotencyKey === id)
  })
}
async function allRows() {
  const db = await openDatabase()
  const rows: Array<{
    store: (typeof draftStores)[number]
    key: string
    value: ScopedDraft
  }> = []
  const transaction = db.transaction([
    ...draftStores,
    'writeAttempts',
    'demoState',
  ])
  const done = transactionDone(transaction)
  const locksRequest = requestResult(
    transaction.objectStore('writeAttempts').getAllKeys(),
  )
  const stateRequest = requestResult(
    transaction.objectStore('demoState').get('current'),
  )
  const pending = draftStores.map(async (store) => {
    const [keys, values] = await Promise.all([
      requestResult(transaction.objectStore(store).getAllKeys()),
      requestResult(transaction.objectStore(store).getAll()),
    ])
    keys.forEach((key, index) =>
      rows.push({
        store,
        key: String(key),
        value: values[index] as ScopedDraft,
      }),
    )
  })
  await Promise.all(pending)
  const locks = new Set((await locksRequest).map(String))
  const epoch = ((await stateRequest) as { epoch?: string } | undefined)?.epoch
  await done
  return {
    rows,
    locks,
    unknown: unknownLocks(
      locks,
      rows.map((row) => row.value),
    ),
    epoch,
  }
}
export async function listLocalDrafts(
  mode: AppMode,
  account: string,
): Promise<LocalDraftRow[]> {
  const { rows, locks, unknown, epoch } = await allRows()
  const [records, tasks, handovers] = await Promise.all([
    listRecordEditors(mode, account),
    listWorkingDrafts('task', mode, account),
    listWorkingDrafts('handover', mode, account),
  ])
  const combined = [
    ...records.map((value) => ({
      store: 'recordEditors' as const,
      key: draftKey(mode, account, value.localId),
      value,
    })),
    ...tasks.map((value) => ({
      store: 'taskEditors' as const,
      key: draftKey(mode, account, workingId(value)),
      value,
    })),
    ...handovers.map((value) => ({
      store: 'handoverWorkingDrafts' as const,
      key: draftKey(mode, account, workingId(value)),
      value,
    })),
    ...rows.filter((row) => row.store === 'handoverEditors'),
  ]
  return combined
    .filter(
      ({ value }) =>
        value.mode === mode &&
        value.accountKey === account &&
        (mode !== 'demo' || value.demoEpoch === epoch),
    )
    .map(({ store, key, value }) => {
      const row = value as ScopedDraft
      const id = row.localId || row.taskId || ''
      const files = row.attachments ?? []
      const title =
        row.text ||
        row.result ||
        row.note ||
        row.elderId ||
        row.taskId ||
        row.shiftId ||
        '空白草稿'
      const url =
        store === 'recordEditors'
          ? '/records/new?draft=' + encodeURIComponent(id)
          : store === 'taskEditors'
            ? '/tasks/' +
              encodeURIComponent(row.taskId!) +
              '?draft=' +
              encodeURIComponent(id)
            : '/handover?shift=' +
              encodeURIComponent(row.shiftId!) +
              (store === 'handoverWorkingDrafts'
                ? '&draft=' + encodeURIComponent(id)
                : '')
      return {
        store,
        key,
        id,
        type:
          store === 'recordEditors'
            ? '记录'
            : store === 'taskEditors'
              ? '任务'
              : store === 'handoverEditors'
                ? '交班版本'
                : '交班草稿',
        title: title.slice(0, 160),
        preview:
          [
            row.text,
            row.result,
            row.note,
            row.review?.observation && '观察：' + row.review.observation,
            row.review?.followUp && '后续：' + row.review.followUp,
            row.itemIds?.length && '事项：' + row.itemIds.join('、'),
            ...files.map((file) => '附件：' + file.name),
          ]
            .filter(Boolean)
            .join('\n\n') || '空白草稿',
        status: row.phase ?? 'editing',
        updatedAt: row.updatedAt ?? '',
        attachments: files.length,
        bytes:
          new Blob([JSON.stringify({ ...row, attachments: [] })]).size +
          files.reduce((sum, file) => sum + file.size, 0),
        protected: protectedDraft(row, locks, unknown),
        url,
        demoEpoch: row.demoEpoch,
      } satisfies LocalDraftRow
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export interface DraftDeletion {
  store: StoreName
  key: string
  demoEpoch?: string
}
function journalSnapshots(mode: AppMode, account: string) {
  const rows: Array<{
    name: string
    raw: string
    store: StoreName
    id: string
    recoveryId: string
    demoEpoch?: string
  }> = []
  for (const name of Object.keys(localStorage)) {
    const record = name.startsWith('hulao:editor-journal:')
    if (!record && !name.startsWith('hulao:working-journal:')) continue
    try {
      const raw = localStorage.getItem(name)!
      const row = JSON.parse(raw) as ScopedDraft
      if (row.mode !== mode || row.accountKey !== account) continue
      const id = row.localId || row.taskId || ''
      const writer = record
        ? name.slice(
            ('hulao:editor-journal:' + draftKey(mode, account, id)).length + 1,
          )
        : JSON.parse(name.slice('hulao:working-journal:'.length))[4]
      rows.push({
        name,
        raw,
        id,
        recoveryId: `${id}-recovery-${writer}`,
        store: record
          ? 'recordEditors'
          : row.taskId
            ? 'taskEditors'
            : 'handoverWorkingDrafts',
        demoEpoch: row.demoEpoch,
      })
    } catch {
      /* Preserve damaged or unrelated logs. */
    }
  }
  return rows
}
export function subscribeDraftDeletions(
  callback: (rows: DraftDeletion[]) => void,
) {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) =>
    callback((event as CustomEvent<DraftDeletion[]>).detail)
  window.addEventListener('hulao:drafts-deleted', handler)
  const channel =
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('hulao:drafts')
      : undefined
  if (channel)
    channel.onmessage = (event) => callback(event.data as DraftDeletion[])
  const storageHandler = (event: StorageEvent) => {
    if (event.key === 'hulao:draft-signal' && event.newValue) {
      try {
        callback(JSON.parse(event.newValue).rows)
      } catch {
        /* Ignore damaged signals. */
      }
    }
  }
  window.addEventListener('storage', storageHandler)
  return () => {
    window.removeEventListener('hulao:drafts-deleted', handler)
    window.removeEventListener('storage', storageHandler)
    channel?.close()
  }
}
export async function deleteLocalDrafts(
  mode: AppMode,
  account: string,
  selected: DraftDeletion[],
) {
  const journals = await Promise.all(
    journalSnapshots(mode, account).map(async (journal) => ({
      ...journal,
      fingerprint: await journalFingerprint(journal.raw),
    })),
  )
  const permitted = await listLocalDrafts(mode, account)
  const targets = selected.map((target) => {
    const row = permitted.find(
      (row) => row.store === target.store && row.key === target.key,
    )
    if (
      !row ||
      row.protected ||
      (mode === 'demo' && target.demoEpoch !== row.demoEpoch)
    )
      throw new Error('包含待核实、已重置或已变化的草稿，未执行清理')
    return row
  })
  for (const target of targets) {
    if (
      permitted.some(
        (row) =>
          row.store === target.store &&
          row.id.startsWith(target.id + '-recovery-') &&
          !targets.some(
            (selected) =>
              selected.key === row.key && selected.store === row.store,
          ),
      )
    ) {
      throw new Error(
        '存在未选择的恢复分支，未执行删除。请先另存该分支，或明确选择所有相关草稿。',
      )
    }
  }
  if (!targets.length) return
  const db = await openDatabase()
  const transaction = db.transaction(
    [...draftStores, 'draftDeletions', 'writeAttempts', 'demoState'],
    'readwrite',
  )
  const done = transactionDone(transaction)
  let failure: Error | undefined
  // Read all locks and drafts in the same transaction as deletion to close the submit/delete race.
  const locksRequest = transaction.objectStore('writeAttempts').getAllKeys()
  const stateRequest = transaction.objectStore('demoState').get('current')
  const drafts: ScopedDraft[] = []
  const values = new Map<string, ScopedDraft>()
  let remaining = draftStores.length + 2
  const ready = () => {
    if (--remaining) return
    const locks = new Set(locksRequest.result.map(String))
    const unknown = unknownLocks(locks, drafts)
    const related = (
      journal: ReturnType<typeof journalSnapshots>[number],
      target: LocalDraftRow,
    ) =>
      journal.store === target.store &&
      (journal.id === target.id || journal.recoveryId === target.id) &&
      (mode !== 'demo' || journal.demoEpoch === target.demoEpoch)
    if (
      journalSnapshots(mode, account).some(
        (journal) =>
          targets.some((target) => related(journal, target)) &&
          !journals.some(
            (old) => old.name === journal.name && old.raw === journal.raw,
          ),
      )
    ) {
      failure = new Error(
        '其他窗口刚刚修改了相关草稿，未执行删除，请刷新后重新选择',
      )
      transaction.abort()
      return
    }
    if (
      [...values.entries()].some(([address, row]) => {
        const [store, key] = JSON.parse(address) as string[]
        return targets.some(
          (target) =>
            store === target.store &&
            row.mode === mode &&
            row.accountKey === account &&
            (mode !== 'demo' || row.demoEpoch === target.demoEpoch) &&
            (row.localId || row.taskId || '').startsWith(
              target.id + '-recovery-',
            ) &&
            !targets.some(
              (selected) => selected.store === store && selected.key === key,
            ),
        )
      })
    ) {
      failure = new Error('存在未选择的恢复分支，未执行删除，请刷新后重新选择')
      transaction.abort()
      return
    }
    if (
      mode === 'demo' &&
      targets.some((target) => target.demoEpoch !== stateRequest.result?.epoch)
    ) {
      failure = new Error('演示数据已重置，未执行旧草稿清理')
      transaction.abort()
      return
    }
    for (const target of targets) {
      const row = values.get(JSON.stringify([target.store, target.key]))
      if (
        unknown ||
        (row &&
          (row.mode !== mode ||
            row.accountKey !== account ||
            (mode === 'demo' && row.demoEpoch !== target.demoEpoch) ||
            protectedDraft(row, locks, unknown)))
      ) {
        failure = new Error('草稿正在提交或等待核实，未执行清理')
        transaction.abort()
        return
      }
    }
    for (const target of targets) {
      transaction.objectStore(target.store).delete(target.key)
      transaction
        .objectStore('draftDeletions')
        .put(
          {
            store: target.store,
            key: target.key,
            mode,
            accountKey: account,
            demoEpoch: target.demoEpoch,
            journals: Object.fromEntries(
              journals
                .filter((journal) => related(journal, target))
                .map((journal) => [journal.name, journal.fingerprint]),
            ),
            at: new Date().toISOString(),
          },
          JSON.stringify([target.store, target.key]),
        )
    }
  }
  locksRequest.onsuccess = ready
  stateRequest.onsuccess = ready
  for (const store of draftStores) {
    const request = transaction.objectStore(store).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        ready()
        return
      }
      const value = cursor.value as ScopedDraft
      drafts.push(value)
      values.set(JSON.stringify([store, String(cursor.key)]), value)
      cursor.continue()
    }
  }
  try {
    await done
  } catch (error) {
    throw failure ?? error
  }
  for (const journal of journals) {
    if (
      targets.some(
        (target) =>
          target.store === journal.store &&
          (target.id === journal.id || target.id === journal.recoveryId) &&
          (mode !== 'demo' || target.demoEpoch === journal.demoEpoch),
      ) &&
      localStorage.getItem(journal.name) === journal.raw
    )
      localStorage.removeItem(journal.name)
  }
  window.dispatchEvent(
    new CustomEvent('hulao:drafts-deleted', { detail: targets }),
  )
  if (typeof BroadcastChannel !== 'undefined') {
    const bus = new BroadcastChannel('hulao:drafts')
    bus.postMessage(targets)
    bus.close()
  } else {
    try {
      localStorage.setItem(
        'hulao:draft-signal',
        JSON.stringify({ rows: targets, nonce: crypto.randomUUID() }),
      )
    } catch {
      /* Transactions still enforce tombstones. */
    }
  }
}
export async function clearLocalDrafts(mode: AppMode, account: string) {
  const rows = await listLocalDrafts(mode, account)
  await deleteLocalDrafts(
    mode,
    account,
    rows.filter((row) => !row.protected),
  )
}
export function storageFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'QuotaExceededError')
    return '本机空间不足，请清理不再需要的草稿或附件'
  if (name === 'SecurityError' || name === 'NotAllowedError')
    return '浏览器禁止本机存储，请检查站点权限'
  return error instanceof Error
    ? error.message
    : '本机存储失败，请保留当前内容并重试'
}
