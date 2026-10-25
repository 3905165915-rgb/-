import { describe, expect, it, vi } from 'vitest'
import type { FrontendSession } from '../session'
import type { Row } from './model'
import {
  activityFilterError,
  activityReferencePath,
  activityTimestamp,
  createElderActivity,
  demoElderActivity,
  elderActivityItems,
  filterElderActivity,
  type ActivityType,
} from './elder-activity'

const elderId = 'synthetic-elder'
const at = '2026-10-25T09:00:00+08:00'
const row = { id: 'synthetic-record', elder_id: elderId, raw_text: '虚构测试记录', happened_at: at, status: 'confirmed' }
const staff: FrontendSession = {
  mode: 'api', accountKey: 'synthetic-account', userId: 'synthetic-staff',
  accessToken: 'synthetic-token', role: 'caregiver',
}
const failure = (status: number) => Object.assign(new Error('private-error-detail'), { status })
function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness() {
  let session: FrontendSession | null = { ...staff }
  const list = vi.fn(async (path: string): Promise<unknown> => path.startsWith('/records?') ? [row] : [])
  const request = vi.fn(async (): Promise<unknown> => row)
  const demoTasks = vi.fn(async () => [{
    id: 'synthetic-task', elderId, title: '虚构任务', shift: '', assignee: '',
    dueAt: '今天 15:00', status: 'pending' as const, itemId: 'synthetic-item',
  }])
  const activity = createElderActivity({ list, request, demoTasks, session: () => session })
  return { activity, list, request, demoTasks, setSession(value: FrontendSession | null) { session = value } }
}
const items = (activity: ReturnType<typeof createElderActivity>) =>
  Object.values(activity.state.value.slots).flatMap((slot) => slot.items)

describe('exact elder activity projection', () => {
  it.each(['record', 'task', 'incident', 'memory'] as ActivityType[])(
    'only includes exact elder_id relations for %s, without text or ID-prefix guesses', (type) => {
      expect(elderActivityItems(type, [row,
        { ...row, id: 'other', elder_id: elderId + '-other' },
        { ...row, id: 'missing', elder_id: undefined, elderId },
        { ...row, id: 'missing-id', elder_id: undefined, content: elderId },
      ], elderId).map((item) => item.reference.id)).toEqual([row.id])
    },
  )
  it('projects only exact handover items, never the shared summary or another elder item', () => {
    const handover = { id: 'synthetic-handover', created_at: at, summary: 'other-elder-private-summary', items: [
      { id: 'one', elder_id: elderId, handover_id: 'synthetic-handover', detail: '虚构交班', kind: 'record', source_id: row.id },
      { id: 'two', elder_id: 'other', detail: 'other-elder-private-detail' },
      { id: 'three', detail: elderId },
      { id: 'four', elder_id: elderId, handover_id: 'wrong-parent' },
    ] }
    const result = elderActivityItems('handover', [handover], elderId)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ text: '虚构交班', times: [{ label: '交班创建', value: at }],
      reference: { type: 'handover', id: 'one', parentId: handover.id }, source: { type: 'record', id: row.id } })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('keeps same IDs of different types distinct and deduplicates repeated list rows', () => {
    const records = elderActivityItems('record', [row, row], elderId)
    const tasks = elderActivityItems('task', [row], elderId)
    expect(records).toHaveLength(1)
    expect(records[0].key).not.toBe(tasks[0].key)
  })
  it('does not treat task deadlines or memory validity as activity timestamps', () => {
    expect(elderActivityItems('task', [{ ...row, happened_at: undefined, due_at: at }], elderId)[0].timestamp).toBeNull()
    expect(elderActivityItems('memory', [{ ...row, happened_at: undefined, valid_from: at }], elderId)[0].timestamp).toBeNull()
  })
  it('retains explicit timestamp labels and uses a valid fallback when another time is invalid', () => {
    const item = elderActivityItems('record', [{ ...row, happened_at: '今天', created_at: at }], elderId)[0]
    expect(item.times).toMatchObject([{ label: '发生', timestamp: null }, { label: '录入', timestamp: Date.parse(at) }])
    expect(item.timestamp).toBe(Date.parse(at))
  })
  it('keeps candidate memories as candidates without inventing confirmed hints or effective status', () => {
    const item = elderActivityItems('memory', [{ id: 'synthetic-memory', elder_id: elderId, status: 'candidate', content: '虚构候选', created_at: at }], elderId)[0]
    expect(item).toMatchObject({ status: 'candidate', text: '虚构候选' })
    expect(item).not.toHaveProperty('effective')
    expect(item).not.toHaveProperty('confirmed_at')
  })
  it.each([null, {}, [null], ['bad']])('rejects malformed lists rather than declaring them empty: %j', (value) => {
    expect(() => elderActivityItems('record', value, elderId)).toThrow()
  })
  it('rejects handovers with missing items rather than declaring an empty activity list', () => {
    expect(() => elderActivityItems('handover', [{ id: 'synthetic-handover' }], elderId)).toThrow()
  })
})

describe('activity dates and source URLs', () => {
  it.each(['今天 12:30', '2026-10-25', '2026-10-25T10:00:00', '2026-02-30T10:00:00Z',
    '2026-10-25T24:00:00Z', '2026-10-25T12:60:00Z', '2026-10-25T12:00:60Z', '', null])(
    'does not silently coerce invalid or ambiguous timestamps: %j', (value) => {
      expect(activityTimestamp(value)).toBeNull()
    },
  )
  it('accepts UTC, offset and server microsecond instants', () => {
    expect(activityTimestamp('2026-10-25T01:00:00.123456+00:00')).toBe(Date.parse('2026-10-25T09:00:00.123+08:00'))
    expect(activityTimestamp('2026-10-25T01:00:00Z')).toBe(Date.parse(at))
  })
  it('includes the entire end date in Shanghai time, excluding the following midnight', () => {
    const rows = ['2026-10-24T15:59:59.999Z', '2026-10-24T16:00:00Z',
      '2026-10-25T15:59:59.999Z', '2026-10-25T16:00:00Z']
      .map((happened_at, index) => ({ ...row, id: String(index), happened_at }))
    const result = filterElderActivity(elderActivityItems('record', rows, elderId), elderId,
      { type: '', start: '2026-10-25', end: '2026-10-25' })
    expect(result.map((item) => item.reference.id)).toEqual(['2', '1'])
  })
  it('keeps untimed items only without date filters and always enforces elder and type filters', () => {
    const records = elderActivityItems('record', [row, { ...row, id: 'untimed', happened_at: '今天' }], elderId)
    const tasks = elderActivityItems('task', [{ ...row, id: 'task' }], elderId)
    const other = { ...records[0], elderId: 'other' }
    expect(filterElderActivity([...records, ...tasks, other], elderId, { type: 'record', start: '', end: '' })).toHaveLength(2)
    expect(filterElderActivity(records, elderId, { type: '', start: '', end: '2026-10-25' })).toHaveLength(1)
  })
  it('reports reversed and invalid date ranges instead of silently returning a misleading result', () => {
    expect(activityFilterError({ type: '', start: '2026-10-26', end: '2026-10-25' })).not.toBe('')
    expect(activityFilterError({ type: '', start: '2026-02-30', end: '' })).not.toBe('')
    expect(filterElderActivity(elderActivityItems('record', [row], elderId), elderId,
      { type: '', start: '2026-10-26', end: '2026-10-25' })).toEqual([])
  })
  it.each(['record', 'task', 'memory', 'incident'] as ActivityType[])('encodes %s reference IDs in existing API paths', (type) => {
    const base = { record: 'records', task: 'tasks', memory: 'memories', incident: 'incidents', handover: 'handovers' }
    expect(activityReferencePath({ type, id: 'id/with?query=#&' })).toBe('/' + base[type] + '/id%2Fwith%3Fquery%3D%23%26')
  })
  it('links handover details to the parent and replay to the exact task source', () => {
    const item = elderActivityItems('handover', [{ id: 'parent/?', created_at: at, items: [
      { id: 'child/?', elder_id: elderId, kind: 'task', source_id: 'task/?' },
    ] }], elderId)[0]
    expect(activityReferencePath(item.reference)).toBe('/handovers/parent%2F%3F')
    expect(item.replayUrl).toBe('/timeline/task%2F%3F')
    expect(item.source).toEqual({ type: 'task', id: 'task/?' })
  })
  it('links a memory source from source.record_id and never treats a draft as a confirmed record', () => {
    const memory = elderActivityItems('memory', [{ ...row, source: { record_id: 'record/?' }, source_draft_id: 'draft' }], elderId)[0]
    expect(memory.source).toEqual({ type: 'record', id: 'record/?' })
    const record = elderActivityItems('record', [row], elderId)[0]
    expect(record.replayUrl).toBe('/timeline/' + row.id)
    expect(record.detailUrl).toBeUndefined()
  })
  it('preserves distinct incident evidence record links, excluding explicit conflicting elder evidence', () => {
    const incident = elderActivityItems('incident', [{ ...row, evidence: [
      { record_id: 'one' }, { record_id: 'two', elder_id: elderId },
      { record_id: 'one' }, { record_id: 'other', elder_id: 'other' }, { source_id: 'not-a-record' },
    ] }], elderId)[0]
    expect(incident.sources).toEqual([{ type: 'record', id: 'one' }, { type: 'record', id: 'two' }])
  })
})

describe('read-only activity loading and switching', () => {
  it('requests only existing accessible lists, with encoded elder filters where supported', async () => {
    const { activity, list, request } = harness()
    await activity.load('elder/?&', 'api')
    expect(list.mock.calls.map(([path]) => path)).toEqual([
      '/records?elder_id=elder%2F%3F%26', '/tasks?elder_id=elder%2F%3F%26', '/handovers',
      '/incidents?elder_id=elder%2F%3F%26', '/memories?elder_id=elder%2F%3F%26',
    ])
    expect(activity.state.value.status).toBe('ready')
    expect(request).not.toHaveBeenCalled()
  })
  it('keeps loaded rows while other sources are pending and exposes partial errors safely', async () => {
    const { activity, list } = harness()
    const pending = deferred()
    list.mockImplementation(async (path) => {
      if (path.startsWith('/records?')) return [row]
      if (path.startsWith('/tasks?')) return pending.promise
      if (path === '/handovers') throw failure(403)
      return []
    })
    const loading = activity.load(elderId, 'api')
    await Promise.resolve()
    expect(activity.state.value.status).toBe('pending')
    expect(items(activity)).toHaveLength(1)
    pending.reject(failure(500))
    await loading
    expect(activity.state.value.status).toBe('partial')
    expect(activity.state.value.slots.handover?.status).toBe('denied')
    expect(JSON.stringify(activity.state.value)).not.toContain('private-error-detail')
  })
  it('distinguishes all-list failure, successful empty lists, and retry with stale rows cleared', async () => {
    const { activity, list } = harness()
    await activity.load(elderId, 'api')
    list.mockRejectedValue(failure(500))
    const retry = activity.load(elderId, 'api')
    expect(activity.state.value.status).toBe('pending')
    expect(items(activity)).toEqual([])
    await retry
    expect(activity.state.value.status).toBe('error')
    list.mockResolvedValue([])
    await activity.load(elderId, 'api')
    expect(activity.state.value.status).toBe('ready')
    expect(items(activity)).toEqual([])
  })
  it('clears all loaded data on unauthorized response and ignores remaining pending lists', async () => {
    const { activity, list } = harness()
    const late = deferred()
    list.mockImplementation(async (path) => path.startsWith('/tasks?') ? late.promise :
      path.startsWith('/memories?') ? Promise.reject(failure(401)) : [row])
    const loading = activity.load(elderId, 'api')
    await Promise.resolve()
    await Promise.resolve()
    late.resolve([row])
    await loading
    expect(activity.state.value.status).toBe('denied')
    expect(items(activity)).toEqual([])
  })
  it.each([null, { ...staff, role: 'family' as const }, { ...staff, accessToken: '' }, { ...staff, mode: 'demo' as const }])(
    'does no list work for an invalid internal session: %j', async (session) => {
      const { activity, list, setSession } = harness()
      setSession(session)
      await activity.load(elderId, 'api')
      expect(list).not.toHaveBeenCalled()
      expect(activity.state.value.status).toBe('denied')
    },
  )
  it('ignores an earlier elder request, including its late errors', async () => {
    const { activity, list } = harness()
    const old = deferred()
    list.mockReturnValueOnce(old.promise)
    const first = activity.load('other', 'api')
    await activity.load(elderId, 'api')
    old.reject(failure(401))
    await first
    expect(activity.state.value.elderId).toBe(elderId)
    expect(activity.state.value.status).toBe('ready')
    expect(items(activity).every((item) => item.elderId === elderId)).toBe(true)
  })
  it.each([{ ...staff, accountKey: 'other' }, { ...staff, accessToken: 'other' },
    { ...staff, userId: 'other' }, { ...staff, role: 'family' as const }, null])(
    'discards late results after session identity changes: %j', async (session) => {
      const { activity, list, setSession } = harness()
      const late = deferred()
      list.mockReturnValueOnce(late.promise)
      const first = activity.load(elderId, 'api')
      await Promise.resolve()
      setSession(session)
      late.resolve([row])
      await first
      expect(activity.state.value.status).toBe('denied')
      expect(items(activity)).toEqual([])
    },
  )
  it('keeps a new account load after an old account responds late', async () => {
    const { activity, list, setSession } = harness()
    const late = deferred()
    list.mockReturnValueOnce(late.promise)
    const first = activity.load(elderId, 'api')
    setSession({ ...staff, accountKey: 'new-account' })
    list.mockResolvedValue([])
    await activity.load(elderId, 'api')
    late.resolve([row])
    await first
    expect(activity.state.value.status).toBe('ready')
    expect(items(activity)).toEqual([])
  })
  it('clears in-flight list and detail results on unmount or explicit revocation', async () => {
    const { activity, request } = harness()
    await activity.load(elderId, 'api')
    const late = deferred()
    request.mockReturnValueOnce(late.promise)
    const reading = activity.openDetail({ type: 'record', id: row.id })
    activity.clear()
    late.resolve(row)
    await reading
    expect(activity.state.value.status).toBe('idle')
    expect(activity.detail.value.status).toBe('idle')
  })
  it('uses existing demo task relations without server requests or fabricated activity timestamps', async () => {
    const { activity, list, request, setSession, demoTasks } = harness()
    setSession({ ...staff, mode: 'demo', accessToken: undefined })
    await activity.load(elderId, 'demo')
    expect(items(activity)[0]).toMatchObject({ type: 'task', timestamp: null, times: [], replayUrl: '/timeline/synthetic-item' })
    await activity.openDetail({ type: 'record', id: row.id })
    expect(list).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(demoElderActivity(await demoTasks(), 'other')).toEqual([])
  })
})

describe('exact source/detail reads', () => {
  it('loads a single encoded source detail and exposes only the current elder row', async () => {
    const { activity, request } = harness()
    await activity.load(elderId, 'api')
    request.mockResolvedValueOnce({ ...row, id: 'source/?' })
    await activity.openDetail({ type: 'record', id: 'source/?' })
    expect(request).toHaveBeenCalledExactlyOnceWith('/records/source%2F%3F')
    expect(activity.detail.value).toMatchObject({ status: 'ready', item: { text: row.raw_text } })
  })
  it.each([{ ...row, elder_id: 'other' }, { ...row, id: 'other' }])('rejects wrong elder or ID detail: %j', async (response) => {
    const { activity, request } = harness()
    await activity.load(elderId, 'api')
    request.mockResolvedValueOnce(response)
    await activity.openDetail({ type: 'record', id: row.id })
    expect(activity.detail.value).toEqual({ status: 'error' })
  })
  it('projects only the requested handover item and never leaks parent or sibling text', async () => {
    const { activity, request } = harness()
    await activity.load(elderId, 'api')
    const response: Row = { id: 'parent', summary: 'private-parent', items: [
      { id: 'item', elder_id: elderId, detail: '虚构本老人交班', received_at: at },
      { id: 'sibling', elder_id: elderId, detail: 'private-sibling' },
      { id: 'other', elder_id: 'other', detail: 'private-other-elder' },
    ] }
    request.mockResolvedValueOnce(response)
    await activity.openDetail({ type: 'handover', id: 'item', parentId: 'parent' })
    expect(activity.detail.value.status).toBe('ready')
    expect(JSON.stringify(activity.detail.value)).not.toContain('private')
  })
  it('ignores late source details after changing source, elder, or account and supports retry', async () => {
    const { activity, request, setSession } = harness()
    await activity.load(elderId, 'api')
    const late = deferred()
    request.mockReturnValueOnce(late.promise)
    const first = activity.openDetail({ type: 'record', id: 'old' })
    await activity.openDetail({ type: 'record', id: row.id })
    late.resolve({ ...row, id: 'old' })
    await first
    expect(activity.detail.value.item?.reference.id).toBe(row.id)
    request.mockRejectedValueOnce(failure(500))
    await activity.openDetail({ type: 'record', id: row.id })
    expect(activity.detail.value.status).toBe('error')
    await activity.openDetail({ type: 'record', id: row.id })
    expect(activity.detail.value.status).toBe('ready')
    const changed = deferred()
    request.mockReturnValueOnce(changed.promise)
    const reading = activity.openDetail({ type: 'record', id: row.id })
    setSession({ ...staff, accountKey: 'other' })
    changed.resolve(row)
    await reading
    expect(activity.detail.value.status).toBe('idle')
    expect(activity.state.value.status).toBe('denied')
  })
})
