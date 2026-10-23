import type { Row } from './model'

export interface PendingWrite {
  signature: string
  key: string
  path: string
  method: string
  payload: unknown
  retryable?: boolean
}
export interface WorkflowSnapshot {
  version: number
  operation: string
  params: Row
  body: Row
  phase: 'editing' | 'pending' | 'succeeded'
  pending?: PendingWrite
  result?: unknown
  updatedAt: string
}
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>

export function recoveryKey(account: string, group: string, context: Row) {
  const ordered = Object.fromEntries(Object.entries(context).sort(([a], [b]) => a.localeCompare(b)))
  return 'hulao:workflow:v2:' + JSON.stringify([account, group, ordered])
}

function read(storage: StoragePort, key: string): WorkflowSnapshot | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  const value = JSON.parse(raw) as WorkflowSnapshot
  if (!Number.isSafeInteger(value.version) || value.version < 1 ||
      typeof value.operation !== 'string' || !value.params || !value.body ||
      !['editing', 'pending', 'succeeded'].includes(value.phase) ||
      (value.phase === 'pending' && (!value.pending?.key || !value.pending.signature)))
    throw new Error('本机恢复日志损坏，请保留页面内容并联系管理员，不能直接重新提交。')
  return value
}

// Each writer retains a private journal even when another tab wins the shared
// revision. A failed compare never overwrites the other tab's saved form.
export class WorkflowRecovery {
  version = 0
  readonly journalKey: string
  constructor(readonly key: string, private storage: StoragePort, writer: string) {
    this.journalKey = key + ':writer:' + writer
  }
  restore() {
    const snapshot = read(this.storage, this.key)
    this.version = snapshot?.version ?? 0
    return snapshot
  }
  journal() { return read(this.storage, this.journalKey) }
  save(input: Omit<WorkflowSnapshot, 'version' | 'updatedAt'>) {
    const snapshot = { ...input, version: this.version + 1, updatedAt: new Date().toISOString() }
    this.storage.setItem(this.journalKey, JSON.stringify(snapshot))
    const current = read(this.storage, this.key)
    if ((current?.version ?? 0) !== this.version)
      throw new Error('其他窗口已修改此表单，当前输入已保留在独立恢复日志中。请载入最新版本后核对，不能覆盖或提交旧版本。')
    this.storage.setItem(this.key, JSON.stringify(snapshot))
    this.version = snapshot.version
    return snapshot
  }
  isCurrent() {
    return (read(this.storage, this.key)?.version ?? 0) === this.version
  }
}

export async function withSubmissionLock<T>(key: string, run: () => T | Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks)
    throw new Error('当前浏览器不支持跨窗口提交保护，请在受支持的安全浏览器中办理；输入仍可保留在本机。')
  return navigator.locks.request(key, { mode: 'exclusive' }, run)
}

// This allowlist follows backend routes that actually consume Idempotency-Key.
// Merely sending the header does not make other mutations replay-safe.
export function supportsReplay(path: string, method: string) {
  if (method === 'patch') return /^\/(elders|beds)\/[^/]+$/.test(path)
  if (method !== 'post') return false
  return /^(?:\/records\/manual|\/records\/[^/]+\/corrections|\/shifts|\/elders(?:\/[^/]+\/admissions)?|\/beds|\/admissions\/[^/]+\/actions|\/memories(?:\/from-draft|\/[^/]+\/(?:revisions|review))?|\/change-reviews\/(?:scan|[^/]+\/(?:assign|submit|review))|\/tasks\/[^/]+\/(?:transition|complete|memory-references(?:\/[^/]+\/withdraw)?|condition\/(?:configure|claim|check))|\/assessments(?:\/[^/]+\/review)?|\/care-plans(?:\/[^/]+\/(?:review|generate|reissue))?|\/family\/(?:bindings(?:\/[^/]+\/revoke)?|summaries(?:\/[^/]+\/review)?|me\/feedback|feedback\/[^/]+\/reply)|\/incidents(?:\/[^/]+\/(?:triage|reopen))?|\/rectifications\/[^/]+\/(?:assign|submit|review))$/.test(path.split('?')[0])
}

export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      /password|token|secret/i.test(key) ? '' : withoutSecrets(child)]))
  return value
}
