import { createInitialDemoState, DEMO_BATCH_ID, type DemoState } from './demo'
import { businessDay } from './business-time'
import { clearDemoJournals, demoRecoveryEntries, openDatabase, transactionDone } from './storage'
import type { HandoverItem, Task, TimelineEvent } from './types'
export interface DemoStateV2 extends Omit<
  DemoState,
  'tasks' | 'timeline' | 'handover'
> {
  schemaVersion: 3
  epoch: string
  revision: number
  batchId: string
  tasks: Array<Task & { itemId: string; sourceDraftId?: string }>
  timeline: Array<TimelineEvent & { itemId: string; source: 'demo' }>
  handover: Array<
    HandoverItem & { shiftId: string; batchId: string; version: number }
  >
  handoverVersions: Array<{
    id: string
    shiftId: string
    version: number
    note: string
    itemIds: string[]
    createdAt: string
  }>
  confirmedDrafts: Record<string, { record_id: string; task_ids: string[] }>
  appliedOperations: string[]
  confirmationBodies?: Record<string, string>
}
function initial(): DemoStateV2 {
  const seed = createInitialDemoState()
  const epoch = crypto.randomUUID()
  return {
    ...seed,
    schemaVersion: 3,
    epoch,
    revision: 0,
    batchId: DEMO_BATCH_ID,
    tasks: seed.tasks.map((task) => ({ ...task, nameSnapshot: seed.elders.find(elder => elder.id === task.elderId)?.name, itemId: task.itemId || `item-${task.id}` })),
    handover: seed.handover.map((item) => ({ ...item, shiftId: '晚班', batchId: DEMO_BATCH_ID, version: 1, demoEpoch: epoch })),
    timeline: seed.timeline
      .map((event) => ({ ...event, itemId: event.itemId || 'item-wang-listen', source: 'demo' })),
    handoverVersions: [],
    confirmedDrafts: {},
    appliedOperations: [],
  }
}
const listeners = new Set<() => void>()
let channel: BroadcastChannel | undefined
let listening = false
function notify() {
  for (const callback of listeners) callback()
}
function announce(state: DemoStateV2) {
  notify()
  if (typeof BroadcastChannel !== 'undefined') {
    const bus = new BroadcastChannel('hulao:demo:v2')
    bus.postMessage({ epoch: state.epoch, revision: state.revision })
    bus.close()
  } else {
    try {
      localStorage.setItem(
        'hulao:demo:signal',
        JSON.stringify({
          epoch: state.epoch,
          revision: state.revision,
          nonce: crypto.randomUUID(),
        }),
      )
    } catch {
      /* Focus refresh still recovers missed notifications. */
    }
  }
}
export function subscribeDemo(callback: () => void) {
  listeners.add(callback)
  if (!listening && typeof window !== 'undefined') {
    listening = true
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('hulao:demo:v2')
      channel.onmessage = notify
    }
    window.addEventListener('storage', storageChanged)
    window.addEventListener('focus', notify)
  }
  return () => {
    listeners.delete(callback)
    if (!listeners.size && typeof window !== 'undefined') {
      channel?.close()
      channel = undefined
      listening = false
      window.removeEventListener('storage', storageChanged)
      window.removeEventListener('focus', notify)
    }
  }
}
function storageChanged(event: StorageEvent) {
  if (event.key === 'hulao:demo:signal') notify()
}
export async function loadDemoState(): Promise<DemoStateV2> {
  const db = await openDatabase()
  const transaction = db.transaction(['demoState', ...demoEditorStores], 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore('demoState')
  let state!: DemoStateV2
  let rebuilt = false
  let journals: Array<[string, string]> = []
  const request = store.get('current')
  request.onsuccess = () => {
    const saved = request.result as DemoStateV2 | undefined
    const current =
      saved?.schemaVersion === 3 && saved.batchId === DEMO_BATCH_ID && saved.demoDay === businessDay()
        ? saved
        : initial()
    state = current
    if (current !== saved) {
      rebuilt = true
      journals = archiveAndClear(transaction, saved, state, saved ? '批次升级或演示日期更新' : '首次建立')
      store.put(state, 'current')
    }
  }
  await done
  if (rebuilt) { clearDemoJournals(journals); announce(state) }
  return state
}
export async function updateDemoState(
  expectedEpoch: string,
  mutate: (state: DemoStateV2) => void,
): Promise<DemoStateV2> {
  const db = await openDatabase()
  const transaction = db.transaction('demoState', 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore('demoState')
  let state!: DemoStateV2
  let failure: unknown
  const request = store.get('current')
  request.onsuccess = () => {
    try {
      state = request.result as DemoStateV2
      if (!state || state.epoch !== expectedEpoch || state.batchId !== DEMO_BATCH_ID || state.demoDay !== businessDay())
        throw new Error('演示数据已重置，请重新载入后操作')
      mutate(state)
      state.revision += 1
      store.put(state, 'current')
    } catch (error) {
      failure = error
      transaction.abort()
    }
  }
  try {
    await done
  } catch (error) {
    throw failure ?? error
  }
  announce(state)
  return state
}
const demoEditorStores = ['recordEditors', 'taskEditors', 'handoverEditors', 'writeAttempts', 'handoverWorkingDrafts', 'draftDeletions'] as const
function archiveAndClear(transaction: IDBTransaction, previous: DemoStateV2 | undefined, next: DemoStateV2, reason: string) {
  const archive = transaction.objectStore('demoState')
  const archiveId = previous?.epoch || next.epoch
  const journals = demoRecoveryEntries()
  for (const [name, raw] of journals) archive.put({ name, raw }, `archive:${archiveId}:recovery:${name}`)
  if (previous) archive.put(previous, `archive:${archiveId}:snapshot`)
  archive.put({ at: new Date().toISOString(), reason, previousBatch: previous?.batchId || null, nextBatch: next.batchId, nextEpoch: next.epoch, demoDay: next.demoDay }, `audit:${next.epoch}`)
  for (const name of demoEditorStores) {
    const request = transaction.objectStore(name).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const value = cursor.value as { mode?: string }
      if (value.mode === 'demo' || (name === 'writeAttempts' && String(cursor.key).includes('demo'))) {
        archive.put(cursor.value, `archive:${archiveId}:${name}:${String(cursor.key)}`)
        cursor.delete()
      }
      cursor.continue()
    }
  }
  return journals
}
export async function resetDemo(): Promise<DemoStateV2> {
  const db = await openDatabase()
  const transaction = db.transaction(
    [
      'demoState',
      'recordEditors',
      'taskEditors',
      'handoverEditors',
      'writeAttempts',
      'handoverWorkingDrafts',
      'draftDeletions',
    ],
    'readwrite',
  )
  const done = transactionDone(transaction)
  const state = initial()
  const store = transaction.objectStore('demoState')
  let journals: Array<[string, string]> = []
  const request = store.get('current')
  request.onsuccess = () => {
    journals = archiveAndClear(transaction, request.result as DemoStateV2 | undefined, state, '手动重建')
    store.put(state, 'current')
  }
  await done
  clearDemoJournals(journals)
  announce(state)
  return state
}
export async function currentDemoEpoch() {
  return (await loadDemoState()).epoch
}
