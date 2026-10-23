import { readSession } from '../session'
import { recoveryKey, withSubmissionLock } from './recovery'
import type { PendingWrite, WorkflowSnapshot } from './recovery'

const prefix = 'hulao:workflow:v2:'
export type JournalStorage = Pick<
  Storage,
  'length' | 'key' | 'getItem' | 'removeItem'
>
export type JournalPhase =
  WorkflowSnapshot['phase'] | 'unresolved-ai' | 'malformed'
export interface WorkflowJournalEntry {
  readonly key: string
  readonly baseKey: string
  readonly accountKey: string
  readonly group: string
  readonly context: Record<string, unknown>
  readonly kind: 'snapshot' | 'writer' | 'unresolved-ai' | 'malformed'
  readonly phase: JournalPhase
  readonly operation: string
  readonly updatedAt: string | null
  readonly bytes: number
  readonly raw: string
  readonly deletable: boolean
  readonly protectionReason: string
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
function pendingWrite(value: unknown): value is PendingWrite {
  return (
    record(value) &&
    ['key', 'signature', 'path', 'method'].every((key) =>
      nonempty(value[key]),
    ) &&
    (value.retryable === undefined || typeof value.retryable === 'boolean')
  )
}

function identity(key: string) {
  if (!key.startsWith(prefix)) return null
  const tail = key.slice(prefix.length)
  if (tail[0] !== '[') return null
  // Suffix-like strings and brackets can occur inside a context value.
  let depth = 0,
    quoted = false,
    escaped = false,
    end = -1
  for (let index = 0; index < tail.length; index++) {
    const char = tail[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '[' || char === '{') depth++
    else if (char === ']' || char === '}') {
      if (--depth === 0) {
        end = index + 1
        break
      }
    }
  }
  if (end < 0) return null
  let parts: unknown
  try {
    parts = JSON.parse(tail.slice(0, end))
  } catch {
    return null
  }
  if (
    !Array.isArray(parts) ||
    parts.length !== 3 ||
    !nonempty(parts[0]) ||
    !nonempty(parts[1]) ||
    !record(parts[2])
  )
    return null
  const [accountKey, group, context] = parts as [
    string,
    string,
    Record<string, unknown>,
  ]
  const baseKey = recoveryKey(accountKey, group, context)
  const suffix = tail.slice(end)
  const match = /^:(writer|unresolved-ai):([^:]+)$/.exec(suffix)
  const kind: WorkflowJournalEntry['kind'] =
    suffix === ''
      ? 'snapshot'
      : match
        ? (match[1] as 'writer' | 'unresolved-ai')
        : 'malformed'
  return {
    accountKey,
    group,
    context,
    baseKey,
    kind,
    malformed: kind === 'malformed' || prefix + tail.slice(0, end) !== baseKey,
  }
}

function entryFor(
  key: string,
  raw: string,
  id: NonNullable<ReturnType<typeof identity>>,
): WorkflowJournalEntry {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    /* Keep the exact malformed text available for export. */
  }
  let phase: JournalPhase = 'malformed'
  let operation = '',
    updatedAt: string | null = null
  let reason = '日志格式异常，须保留并核查。'
  if (!id.malformed && record(value) && timestamp(value.updatedAt)) {
    updatedAt = value.updatedAt
    if (id.kind === 'unresolved-ai') {
      if (pendingWrite(value.pending) && record(value.source))
        phase = 'unresolved-ai'
      reason = 'AI 请求结果尚未核实，须保留日志。'
    } else if (
      Number.isSafeInteger(value.version) &&
      Number(value.version) >= 1 &&
      nonempty(value.operation) &&
      record(value.params) &&
      record(value.body) &&
      typeof value.phase === 'string' &&
      ['editing', 'pending', 'succeeded'].includes(value.phase) &&
      (value.pending === undefined || pendingWrite(value.pending)) &&
      (value.phase !== 'pending' || pendingWrite(value.pending))
    ) {
      phase = value.phase as WorkflowSnapshot['phase']
      operation = value.operation
      reason =
        phase === 'pending' ||
        (phase === 'editing' && value.pending !== undefined)
          ? '存在尚未确认的请求，不能删除。'
          : ''
    }
  }
  return {
    ...id,
    key,
    raw,
    phase,
    operation,
    updatedAt,
    bytes: (key.length + raw.length) * 2,
    deletable: reason === '',
    protectionReason: reason,
  }
}

/** Read only this tab's authenticated account; any storage failure rejects the whole scan. */
export function listWorkflowJournals(
  storage?: JournalStorage,
): WorkflowJournalEntry[] {
  const session = readSession()
  const account = session?.mode === 'api' ? session.accountKey : null
  if (!account) return []
  const port = storage ?? globalThis.localStorage
  const keys = new Set<string>()
  for (let index = 0; index < port.length; index++) {
    const key = port.key(index)
    if (key?.startsWith(prefix)) keys.add(key)
  }
  const entries: WorkflowJournalEntry[] = []
  for (const key of keys) {
    const id = identity(key)
    if (!id || id.accountKey !== account) continue
    const raw = port.getItem(key)
    if (raw !== null) entries.push(entryFor(key, raw, id))
  }
  // Determine protection before applying any search filter, including hidden siblings.
  const protectedGroups = new Set(
    entries.filter((entry) => !entry.deletable).map((entry) => entry.baseKey),
  )
  return entries
    .map((entry) =>
      entry.deletable && protectedGroups.has(entry.baseKey)
        ? {
            ...entry,
            deletable: false,
            protectionReason: '同组存在待确认或异常日志，不能删除关联快照。',
          }
        : entry,
    )
    .sort(
      (a, b) =>
        (Date.parse(b.updatedAt ?? '') || 0) -
          (Date.parse(a.updatedAt ?? '') || 0) || a.key.localeCompare(b.key),
    )
}

export function filterWorkflowJournals(
  entries: WorkflowJournalEntry[],
  keyword: string,
) {
  const terms = keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    const text =
      `${entry.group} ${JSON.stringify(entry.context)}`.toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

export function journalPreview(entry: WorkflowJournalEntry): string {
  try {
    return JSON.stringify(JSON.parse(entry.raw), null, 2)
  } catch {
    return entry.raw
  }
}

export function journalExport(entry: WorkflowJournalEntry): string {
  return JSON.stringify({ storageKey: entry.key, raw: entry.raw }, null, 2)
}

/** Confirmation never authorizes a changed entry or a newly protected group. */
export async function deleteWorkflowJournal(
  entry: WorkflowJournalEntry,
  confirm: (entry: WorkflowJournalEntry) => boolean | Promise<boolean>,
  storage?: JournalStorage,
): Promise<boolean> {
  function checkAccount() {
    if (readSession()?.accountKey !== entry.accountKey)
      throw new Error('当前登录账号已变化，请刷新日志列表。')
  }
  function checkEntry(port: JournalStorage) {
    checkAccount()
    const current = listWorkflowJournals(port).find(
      (row) => row.key === entry.key,
    )
    if (
      !current ||
      current.raw !== entry.raw ||
      current.baseKey !== entry.baseKey
    )
      throw new Error('日志已变化或被移除，请刷新后重新核对。')
    if (!current.deletable) throw new Error(current.protectionReason)
    return current
  }
  checkAccount()
  const port = storage ?? globalThis.localStorage
  const current = checkEntry(port)
  if (!(await confirm(current))) return false
  checkAccount()
  return withSubmissionLock(current.baseKey, () => {
    checkEntry(port)
    // A fresh read, rather than parsed equality, also catches a newer revision.
    if (port.getItem(entry.key) !== entry.raw)
      throw new Error('日志已变化，请刷新后重新核对。')
    checkAccount()
    port.removeItem(entry.key)
    return true
  })
}
