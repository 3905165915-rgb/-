import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteWorkflowJournal,
  filterWorkflowJournals,
  journalExport,
  journalPreview,
  listWorkflowJournals,
} from './journal-management'
import { recoveryKey } from './recovery'

function storage() {
  const values = new Map<string, string>()
  return {
    values,
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
  }
}
const pending = {
  key: 'synthetic-id',
  signature: 'synthetic-signature',
  path: '/records/manual',
  method: 'post',
  payload: { raw_text: 'synthetic' },
}
function snapshot(phase = 'editing', extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    operation: 'manual',
    params: {},
    body: { raw_text: 'synthetic draft' },
    phase,
    updatedAt: '2026-10-23T10:00:00.000Z',
    version: 1,
    ...(phase === 'pending' ? { pending } : {}),
    ...extra,
  })
}
function unresolved() {
  return JSON.stringify({
    pending,
    source: { raw_text: 'synthetic' },
    updatedAt: '2026-10-23T11:00:00.000Z',
  })
}
const base = recoveryKey('A', 'records', { task_id: 'T-synthetic' })
let port: ReturnType<typeof storage>
let session: ReturnType<typeof storage>
const lockRequest = vi.fn(
  async (_key: string, _options: unknown, run: () => unknown) => run(),
)
function login(accountKey: string) {
  session.setItem(
    'hulao:session:v2',
    JSON.stringify({ mode: 'api', accountKey, role: 'caregiver' }),
  )
}
function row(key = base) {
  const entry = listWorkflowJournals(port).find((entry) => entry.key === key)
  expect(entry).toBeDefined()
  return entry!
}

beforeEach(() => {
  port = storage()
  session = storage()
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('localStorage', port)
  vi.stubGlobal('navigator', { locks: { request: lockRequest } })
  lockRequest.mockReset()
  lockRequest.mockImplementation(async (_key, _options, run) => run())
  login('A')
})
afterEach(() => vi.unstubAllGlobals())

describe('account-scoped workflow journal inspection', () => {
  it('lists only the current session account and formal v2 keys', () => {
    port.setItem(base, snapshot())
    port.setItem(recoveryKey('AA', 'records', {}), snapshot())
    port.setItem(
      recoveryKey('B', 'records', {}) + ':unresolved-ai:other',
      unresolved(),
    )
    port.setItem(
      'hulao:workflow:v1:' + JSON.stringify(['A', 'records', {}]),
      snapshot(),
    )
    port.setItem('unrelated', 'not a workflow journal')
    const get = vi.spyOn(port, 'getItem')
    expect(listWorkflowJournals(port).map((entry) => entry.key)).toEqual([base])
    expect(get.mock.calls.map(([key]) => key)).toEqual([base])
    login('B')
    expect(listWorkflowJournals(port).map((entry) => entry.accountKey)).toEqual(
      ['B'],
    )
  })

  it('does not touch localStorage without a valid session', () => {
    session.removeItem('hulao:session:v2')
    const get = vi.spyOn(port, 'getItem')
    expect(listWorkflowJournals(port)).toEqual([])
    expect(get).not.toHaveBeenCalled()
    login('A')
    session.setItem(
      'hulao:session:v2',
      JSON.stringify({ mode: 'demo', accountKey: 'A', role: 'admin' }),
    )
    expect(listWorkflowJournals(port)).toEqual([])
    expect(get).not.toHaveBeenCalled()
    session.setItem('hulao:session:v2', 'broken')
    expect(listWorkflowJournals(port)).toEqual([])
  })

  it('parses quoted brackets and suffix-like context text without confusing sibling identities', () => {
    const key = recoveryKey('A', 'records', {
      text: 'quoted "] :writer:id :unresolved-ai:id \\',
      b: [1, 2],
    })
    port.setItem(key + ':writer:uuid', snapshot())
    expect(row(key + ':writer:uuid')).toMatchObject({
      baseKey: key,
      kind: 'writer',
      phase: 'editing',
      deletable: true,
    })
  })

  it('shows phase, time and UTF-16 key-plus-value storage estimates, sorted newest first', () => {
    port.setItem(base, snapshot())
    port.setItem(base + ':writer:one', snapshot('pending'))
    port.setItem(base + ':unresolved-ai:one', unresolved())
    const entries = listWorkflowJournals(port)
    expect(entries[0]).toMatchObject({
      kind: 'unresolved-ai',
      phase: 'unresolved-ai',
      updatedAt: '2026-10-23T11:00:00.000Z',
    })
    expect(row().bytes).toBe((base.length + snapshot().length) * 2)
    expect(row(base + ':writer:one').phase).toBe('pending')
  })

  it('searches group and context while retaining protections from filtered-out siblings', () => {
    port.setItem(base, snapshot())
    port.setItem(base + ':writer:one', snapshot('pending'))
    port.setItem(recoveryKey('A', 'shifts', {}), snapshot())
    expect(
      filterWorkflowJournals(
        listWorkflowJournals(port),
        ' RECORDS T-SYNTHETIC ',
      ),
    ).toHaveLength(2)
    expect(
      filterWorkflowJournals(listWorkflowJournals(port), 'synthetic draft'),
    ).toHaveLength(0)
    expect(
      filterWorkflowJournals(listWorkflowJournals(port), 'no-match'),
    ).toEqual([])
    expect(
      filterWorkflowJournals(listWorkflowJournals(port), 'records').every(
        (entry) => !entry.deletable,
      ),
    ).toBe(true)
  })

  it('previews malformed entries and exports their exact raw text without writing storage', () => {
    const raw = '{ malformed\n  "raw_text": "synthetic"'
    port.setItem(base, raw)
    const entry = row()
    expect(entry).toMatchObject({ phase: 'malformed', deletable: false })
    expect(journalPreview(entry)).toBe(raw)
    expect(JSON.parse(journalExport(entry))).toEqual({ storageKey: base, raw })
    expect(port.removeItem).not.toHaveBeenCalled()
    expect(port.getItem(base)).toBe(raw)
  })

  it('propagates unavailable storage rather than presenting an empty or partially safe list', () => {
    port.setItem(base, snapshot())
    vi.spyOn(port, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    expect(() => listWorkflowJournals(port)).toThrow('storage denied')
  })
})

describe('protected groups', () => {
  it.each([
    ['pending', ':writer:pending', snapshot('pending')],
    ['unresolved AI', ':unresolved-ai:uncertain', unresolved()],
    ['malformed snapshot', ':writer:broken', '{'],
    ['malformed unresolved AI', ':unresolved-ai:broken', '{}'],
    [
      'uncertain editing snapshot',
      ':writer:uncertain',
      snapshot('editing', { pending }),
    ],
    ['unknown suffix', ':unexpected:one', snapshot()],
  ])(
    'protects all related snapshots when a sibling is %s',
    async (_name, suffix, raw) => {
      port.setItem(base, snapshot())
      port.setItem(
        base + ':writer:success',
        snapshot('succeeded', { pending, result: { id: 'synthetic' } }),
      )
      port.setItem(base + suffix, raw)
      expect(
        listWorkflowJournals(port).every((entry) => !entry.deletable),
      ).toBe(true)
      const confirm = vi.fn(() => true)
      await expect(
        deleteWorkflowJournal(row(), confirm, port),
      ).rejects.toThrow()
      expect(confirm).not.toHaveBeenCalled()
      expect(lockRequest).not.toHaveBeenCalled()
      expect(port.removeItem).not.toHaveBeenCalled()
    },
  )

  it.each([
    snapshot('other'),
    snapshot('pending', { pending: null }),
    snapshot('editing', { version: 0 }),
    snapshot('editing', { body: [] }),
    snapshot('editing', { updatedAt: 'invalid' }),
    'null',
    snapshot('succeeded', { pending: { key: 'missing-fields' } }),
    snapshot('editing', { phase: ['editing'] }),
  ])('does not delete malformed snapshots: %s', async (raw) => {
    port.setItem(base, raw)
    expect(row()).toMatchObject({ phase: 'malformed', deletable: false })
    await expect(
      deleteWorkflowJournal(row(), () => true, port),
    ).rejects.toThrow()
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it('does not let another account or context block an unrelated base key', async () => {
    port.setItem(base, snapshot())
    port.setItem(
      recoveryKey('B', 'records', { task_id: 'T-synthetic' }),
      snapshot('pending'),
    )
    port.setItem(
      recoveryKey('A', 'records', { task_id: 'T-other' }),
      snapshot('pending'),
    )
    expect(row().deletable).toBe(true)
    await expect(deleteWorkflowJournal(row(), () => true, port)).resolves.toBe(
      true,
    )
  })

  it('treats noncanonical aliases as malformed and protects their canonical siblings', () => {
    const canonical = recoveryKey('A', 'records', { a: 1, b: 2 })
    port.setItem(canonical, snapshot())
    port.setItem('hulao:workflow:v2:["A","records",{"b":2,"a":1}]', snapshot())
    expect(row(canonical).deletable).toBe(false)
  })
})

describe('confirmed individual deletion under the submission lock', () => {
  it.each(['editing', 'succeeded'])(
    'deletes only the confirmed %s entry under its base lock',
    async (phase) => {
      port.setItem(
        base,
        snapshot(
          phase,
          phase === 'succeeded' ? { pending, result: { id: 'synthetic' } } : {},
        ),
      )
      port.setItem(base + ':writer:retained', snapshot())
      const entry = row()
      const confirm = vi.fn(() => true)
      await expect(deleteWorkflowJournal(entry, confirm, port)).resolves.toBe(
        true,
      )
      expect(confirm).toHaveBeenCalledWith(entry)
      expect(lockRequest).toHaveBeenCalledWith(
        base,
        { mode: 'exclusive' },
        expect.any(Function),
      )
      expect(port.removeItem).toHaveBeenCalledExactlyOnceWith(base)
      expect(port.getItem(base + ':writer:retained')).not.toBeNull()
    },
  )

  it('deletes a writer journal using the shared base lock', async () => {
    const key = base + ':writer:one'
    port.setItem(base, snapshot())
    port.setItem(key, snapshot())
    await expect(
      deleteWorkflowJournal(row(key), () => true, port),
    ).resolves.toBe(true)
    expect(lockRequest.mock.calls[0][0]).toBe(base)
    expect(port.getItem(base)).not.toBeNull()
    expect(port.getItem(key)).toBeNull()
  })

  it('does not acquire a lock or remove anything after cancelled confirmation', async () => {
    port.setItem(base, snapshot())
    await expect(deleteWorkflowJournal(row(), () => false, port)).resolves.toBe(
      false,
    )
    expect(lockRequest).not.toHaveBeenCalled()
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it('requires exact raw equality even when the parsed JSON is unchanged', async () => {
    port.setItem(base, snapshot())
    const entry = row()
    await expect(
      deleteWorkflowJournal(
        entry,
        () => {
          port.setItem(base, JSON.stringify(JSON.parse(entry.raw), null, 2))
          return true
        },
        port,
      ),
    ).rejects.toThrow('变化')
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it.each([
    [':writer:new-pending', snapshot('pending')],
    [':unresolved-ai:new-uncertain', unresolved()],
    [':writer:new-broken', '{'],
  ])(
    'catches a sibling added between confirmation and lock acquisition: %s',
    async (suffix, raw) => {
      port.setItem(base, snapshot())
      const entry = row()
      lockRequest.mockImplementationOnce(async (_key, _options, run) => {
        port.setItem(base + suffix, raw)
        return run()
      })
      await expect(
        deleteWorkflowJournal(entry, async () => true, port),
      ).rejects.toThrow('同组')
      expect(port.removeItem).not.toHaveBeenCalled()
      expect(port.getItem(base)).toBe(entry.raw)
      expect(port.getItem(base + suffix)).toBe(raw)
    },
  )

  it('rejects a target that disappears while waiting for its lock', async () => {
    port.setItem(base, snapshot())
    const entry = row()
    lockRequest.mockImplementationOnce(async (_key, _options, run) => {
      port.values.delete(base)
      return run()
    })
    await expect(
      deleteWorkflowJournal(entry, () => true, port),
    ).rejects.toThrow('移除')
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it('compares the raw target again immediately before removing it', async () => {
    port.setItem(base, snapshot())
    const entry = row()
    let reads = 0
    vi.spyOn(port, 'getItem').mockImplementation((key) => {
      if (key === base && ++reads === 3)
        port.setItem(base, snapshot('editing', { version: 2 }))
      return port.values.get(key) ?? null
    })
    await expect(
      deleteWorkflowJournal(entry, () => true, port),
    ).rejects.toThrow('变化')
    expect(reads).toBe(3)
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it.each(['before confirmation', 'during confirmation', 'waiting for lock'])(
    'rejects account changes %s',
    async (when) => {
      port.setItem(base, snapshot())
      const entry = row()
      if (when === 'before confirmation') login('B')
      if (when === 'waiting for lock')
        lockRequest.mockImplementationOnce(async (_key, _options, run) => {
          login('B')
          return run()
        })
      await expect(
        deleteWorkflowJournal(
          entry,
          () => {
            if (when === 'during confirmation') login('B')
            return true
          },
          port,
        ),
      ).rejects.toThrow('账号')
      expect(port.removeItem).not.toHaveBeenCalled()
    },
  )

  it('fails closed when Web Locks are unsupported', async () => {
    port.setItem(base, snapshot())
    vi.stubGlobal('navigator', {})
    await expect(
      deleteWorkflowJournal(row(), () => true, port),
    ).rejects.toThrow('跨窗口')
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it('leaves storage untouched when locking fails', async () => {
    port.setItem(base, snapshot())
    lockRequest.mockRejectedValueOnce(new Error('lock failed'))
    await expect(
      deleteWorkflowJournal(row(), () => true, port),
    ).rejects.toThrow('lock failed')
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it('rejects a changed target before requesting confirmation', async () => {
    port.setItem(base, snapshot())
    const entry = row()
    port.setItem(base, snapshot('pending'))
    const confirm = vi.fn(() => true)
    await expect(deleteWorkflowJournal(entry, confirm, port)).rejects.toThrow(
      '变化',
    )
    expect(confirm).not.toHaveBeenCalled()
    expect(port.removeItem).not.toHaveBeenCalled()
  })

  it('reports removal failure without claiming success', async () => {
    port.setItem(base, snapshot())
    port.removeItem.mockImplementationOnce(() => {
      throw new Error('storage denied')
    })
    await expect(
      deleteWorkflowJournal(row(), () => true, port),
    ).rejects.toThrow('storage denied')
    expect(port.getItem(base)).toBe(snapshot())
  })
})
