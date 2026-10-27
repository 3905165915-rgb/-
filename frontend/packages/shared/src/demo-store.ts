import { createInitialDemoState, type DemoState } from './demo'
import { clearDemoJournals, openDatabase, transactionDone } from './storage'
import type { HandoverItem, Task, TimelineEvent } from './types'
export interface DemoStateV2 extends Omit<
  DemoState,
  'tasks' | 'timeline' | 'handover'
> {
  schemaVersion: 2
  epoch: string
  revision: number
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
}
function initial(): DemoStateV2 {
  const seed = createInitialDemoState()
  return {
    ...seed,
    schemaVersion: 2,
    epoch: crypto.randomUUID(),
    revision: 0,
    tasks: seed.tasks
      .filter((task) => task.id !== 'task-101-family')
      .map((task) => ({ ...task, itemId: 'item-101-meal' })),
    handover: [],
    timeline: seed.timeline
      .slice(0, 2)
      .map((event) => ({ ...event, itemId: 'item-101-meal', source: 'demo' })),
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
  const transaction = db.transaction('demoState', 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore('demoState')
  let state!: DemoStateV2
  const request = store.get('current')
  request.onsuccess = () => {
    state = (request.result as DemoStateV2) ?? initial()
    if (!request.result) store.put(state, 'current')
  }
  await done
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
      if (!state || state.epoch !== expectedEpoch)
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
  transaction.objectStore('demoState').put(state, 'current')
  for (const name of [
    'recordEditors',
    'taskEditors',
    'handoverEditors',
    'writeAttempts',
    'handoverWorkingDrafts',
    'draftDeletions',
  ]) {
    const request = transaction.objectStore(name).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const value = cursor.value as { mode?: string; id?: string }
      if (
        value.mode === 'demo' ||
        (name === 'writeAttempts' && String(cursor.key).includes('demo'))
      )
        cursor.delete()
      cursor.continue()
    }
  }
  await done
  clearDemoJournals()
  announce(state)
  return state
}
export async function currentDemoEpoch() {
  return (await loadDemoState()).epoch
}
