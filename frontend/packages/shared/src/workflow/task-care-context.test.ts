import { describe, expect, it, vi } from 'vitest'
import type { FrontendSession } from '../session'
import {
  careScenes,
  contextDisplayLimit,
  createTaskCareContext,
  isCareScene,
  parseReferenceContext,
  parseSceneContext,
  parseTaskContext,
  sameCareSession,
} from './task-care-context'

const at = '2026-10-23T08:00:00Z'
const task = {
  id: 'TASK-test',
  elder_id: 'ELDER-test',
  title: '虚构测试：下午洗浴',
  status: 'pending',
  revision: 2,
  source_record_id: 'REC-test',
  assigned_to: 'USER-test',
  due_at: null,
  condition: '先询问当前意愿',
  source_plan_id: null,
  source_plan_revision: null,
  plan_item_key: null,
  // Ordinary task detail and AI context notes are never adoption checks.
  memory_references: [{ id: 'not-a-current-check' }],
}
const resident = {
  id: task.elder_id,
  name: '虚构老人',
  bed_id: 'BED-test',
  status: 'active',
}
const source = {
  id: 'REC-test',
  elder_id: task.elder_id,
  revision: 3,
  status: 'corrected',
  observations: ['虚构测试：本人表示下午再洗。'],
  raw_text: '虚构测试：原始记录。',
}
const memory = {
  id: 'MEM-test',
  elder_id: task.elder_id,
  revision: 1,
  status: 'confirmed',
  content: '虚构测试：偏好下午洗浴',
  category: 'stable_preference',
  attributed_to: 'elder',
  scenes: ['bathing', 'rest'],
  source: {
    record_id: source.id,
    revision: source.revision,
    field: 'observations',
    quote: source.observations[0],
    snapshot_text: source.observations[0],
    record_status: 'corrected',
    captured_at: at,
  },
  valid_from: at,
  expires_at: null,
  review_due_at: at,
  confirmed_by: 'USER-supervisor',
  confirmed_at: at,
  effective: true,
  source_current: true,
  review_due: true,
  blocked_reasons: [],
}
const reference = {
  id: 'TMR-test',
  memory_id: memory.id,
  memory_revision: memory.revision,
  scene: 'bathing',
  snapshot: structuredClone(memory),
  status: 'active',
  adopted_by: 'USER-test',
  adopted_at: at,
  reason: '虚构测试：安排前核对',
  withdrawn_by: null,
  withdrawn_at: null,
  withdrawal_reason: null,
  needs_review: true,
  current: {
    memory_revision: 2,
    memory_status: 'review_required',
    effective: false,
    source_current: false,
    review_due: true,
    outdated: true,
    reasons: ['memory_revision_changed', 'memory_source_changed'],
  },
}
const referenceResponse = {
  task_id: task.id,
  task_revision: task.revision,
  task_status: task.status,
  historical_only: false,
  needs_review: true,
  as_of: at,
  references: [reference],
}
const sceneResponse = {
  elder_id: task.elder_id,
  scene: 'bathing',
  as_of: at,
  memories: [memory],
}
const staff: FrontendSession = {
  mode: 'api',
  accountKey: 'synthetic-account',
  userId: 'USER-test',
  role: 'caregiver',
  accessToken: 'synthetic-token',
}
const failure = (status: number) =>
  Object.assign(new Error('private server detail must not be rendered'), {
    status,
  })
function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function harness() {
  let session: FrontendSession | null = { ...staff }
  const request = vi.fn(async (path: string): Promise<unknown> => {
    if (path === `/tasks/${task.id}`) return structuredClone(task)
    if (path === `/elders/${task.elder_id}`) return structuredClone(resident)
    if (path === `/records/${source.id}`) return structuredClone(source)
    if (path === `/tasks/${task.id}/memory-references`)
      return structuredClone(referenceResponse)
    if (path.startsWith('/memories/context?'))
      return structuredClone(sceneResponse)
    throw failure(404)
  })
  return {
    context: createTaskCareContext({ request, session: () => session }),
    request,
    setSession: (value: FrontendSession | null) => {
      session = value
    },
  }
}

describe('task-scene contracts', () => {
  it('uses the six backend scenes and excludes inherited properties', () => {
    expect(Object.keys(careScenes)).toEqual([
      'bathing',
      'dining',
      'activity',
      'communication',
      'rest',
      'other',
    ])
    expect(isCareScene('bathing')).toBe(true)
    expect(isCareScene('toString')).toBe(false)
    expect(isCareScene('下午洗浴')).toBe(false)
    expect(contextDisplayLimit).toBe(10)
  })
  it('reads actual snake-case task fields without inferring a scene or accepting embedded adoption checks', () => {
    const result = parseTaskContext(task, task.id)
    expect(result).toMatchObject({
      elder_id: task.elder_id,
      title: task.title,
      source_record_id: source.id,
      revision: 2,
    })
    expect(result).not.toHaveProperty('scene')
    expect(result).not.toHaveProperty('memory_references')
    expect(() => parseTaskContext(task, 'OTHER')).toThrow()
    expect(() => parseTaskContext({ ...task, elder_id: '' }, task.id)).toThrow()
  })
  it('preserves confirmed source evidence, attribution and review reminders without making reminders invalid', () => {
    expect(
      parseSceneContext(sceneResponse, task.elder_id, 'bathing').memories[0],
    ).toMatchObject({
      content: memory.content,
      source: memory.source,
      attributed_to: 'elder',
      confirmed_by: memory.confirmed_by,
      confirmed_at: at,
      review_due: true,
    })
  })
  it.each([
    { elder_id: 'OTHER' },
    { scene: 'rest' },
    { memories: null },
    { memories: [{ ...memory, elder_id: 'OTHER' }] },
    { memories: [{ ...memory, scenes: ['dining'] }] },
    { memories: [{ ...memory, effective: false }] },
    { memories: [{ ...memory, source_current: false }] },
    { memories: [{ ...memory, blocked_reasons: ['expired'] }] },
    { memories: [{ ...memory, status: 'candidate' }] },
    { memories: [{ ...memory, category: 'observation' }] },
    { memories: [{ ...memory, confirmed_by: null }] },
    { memories: [{ ...memory, source: { ...memory.source, quote: '' } }] },
  ])('rejects wrong scope or unavailable/unsupported memory: %j', (patch) => {
    expect(() =>
      parseSceneContext(
        { ...sceneResponse, ...patch },
        task.elder_id,
        'bathing',
      ),
    ).toThrow()
  })
  it('keeps the adopted snapshot distinct from changed current memory', () => {
    const result = parseReferenceContext(
      referenceResponse,
      parseTaskContext(task, task.id),
    )
    expect(result.references[0]).toMatchObject({
      snapshot: { revision: 1, content: memory.content, source: memory.source },
      current: { memory_revision: 2, effective: false, outdated: true },
      needs_review: true,
    })
    expect(result.references[0].snapshot).not.toHaveProperty('effective')
  })
  it('retains withdrawn and terminal history without creating new execution requirements', () => {
    const terminal = { ...task, status: 'completed' }
    const result = parseReferenceContext(
      {
        ...referenceResponse,
        task_status: 'completed',
        historical_only: true,
        needs_review: false,
        references: [
          {
            ...reference,
            status: 'withdrawn',
            needs_review: false,
            withdrawn_by: 'USER-test',
            withdrawn_at: at,
            withdrawal_reason: '虚构测试：偏好变化',
          },
        ],
      },
      parseTaskContext(terminal, terminal.id),
    )
    expect(result.historical_only).toBe(true)
    expect(result.needs_review).toBe(false)
    expect(result.references[0]).toMatchObject({
      status: 'withdrawn',
      needs_review: false,
      current: { outdated: true },
    })
  })
  it.each([
    { task_id: 'OTHER' },
    { task_revision: 3 },
    {
      references: [
        { ...reference, snapshot: { ...memory, elder_id: 'OTHER' } },
      ],
    },
    { references: [{ ...reference, memory_revision: 2 }] },
    { references: [{ ...reference, scene: 'dining' }] },
  ])('rejects mismatched or mixed-version adopted references: %j', (patch) => {
    expect(() =>
      parseReferenceContext(
        { ...referenceResponse, ...patch },
        parseTaskContext(task, task.id),
      ),
    ).toThrow()
  })
})

describe('bounded read-only task care context', () => {
  it('reads one task and only its related resident, source and dedicated adoption check; no scene is guessed', async () => {
    const { context, request } = harness()
    await context.load(task.id, 'api')
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      `/tasks/${task.id}`,
      `/elders/${task.elder_id}`,
      `/records/${source.id}`,
      `/tasks/${task.id}/memory-references`,
    ])
    expect(context.state.value.task.status).toBe('ready')
    expect(context.state.value.resident.data).toEqual(resident)
    expect(context.state.value.source.data).toEqual(source)
    expect(context.state.value.references.data?.references[0].id).toBe(
      reference.id,
    )
    expect(context.state.value.scene).toBe('')
    expect(context.state.value.memories.status).toBe('idle')
    expect(request.mock.calls.every((call) => call.length === 1)).toBe(true)
  })
  it('queries only an explicitly selected scene and never adds adoption relationships', async () => {
    const { context, request } = harness()
    await context.load(task.id, 'api')
    await context.selectScene('bathing')
    expect(request).toHaveBeenLastCalledWith(
      `/memories/context?elder_id=${task.elder_id}&scene=bathing`,
    )
    expect(context.state.value.memories.status).toBe('ready')
    expect(context.state.value.references.data?.references).toHaveLength(1)
    await context.selectScene('')
    await context.selectScene('from-title')
    expect(request).toHaveBeenCalledTimes(5)
    expect(context.state.value.memories.data).toBeUndefined()
  })
  it('encodes task IDs without broad list lookups or query injection', async () => {
    const { context, request } = harness()
    await context.load('task/with?query=x&y', 'api')
    expect(request).toHaveBeenCalledExactlyOnceWith(
      '/tasks/task%2Fwith%3Fquery%3Dx%26y',
    )
  })
  it('does no API work in demo, including scene interaction or switching from an API session', async () => {
    const { context, request } = harness()
    await context.load(task.id, 'api')
    request.mockClear()
    await context.load(task.id, 'demo')
    await context.selectScene('bathing')
    expect(request).not.toHaveBeenCalled()
    expect(context.state.value.task.status).toBe('demo')
    expect(context.state.value.task.data).toBeUndefined()
    expect(context.state.value.references.data).toBeUndefined()
  })
  it.each([
    null,
    { ...staff, role: 'family' },
    { ...staff, role: null },
    { ...staff, mode: 'demo' },
    { ...staff, accessToken: '' },
  ] as (FrontendSession | null)[])(
    'does not query for disallowed session %j',
    async (session) => {
      const { context, request, setSession } = harness()
      setSession(session)
      await context.load(task.id, 'api')
      expect(request).not.toHaveBeenCalled()
      expect(context.state.value.task.status).toBe('denied')
    },
  )
  it('distinguishes task loading, missing and failed reads without rendering private errors', async () => {
    const { context, request } = harness()
    const pending = deferred()
    request.mockReturnValueOnce(pending.promise)
    const loading = context.load(task.id, 'api')
    expect(context.state.value.task.status).toBe('loading')
    pending.reject(failure(404))
    await loading
    expect(context.state.value.task.status).toBe('empty')
    request.mockRejectedValueOnce(failure(500))
    await context.load(task.id, 'api')
    expect(context.state.value.task.status).toBe('error')
    expect(JSON.stringify(context.state.value)).not.toContain(
      'private server detail',
    )
  })
  it('distinguishes empty memories, failed reads and retry loading while clearing the old scene content', async () => {
    const { context, request } = harness()
    await context.load(task.id, 'api')
    request.mockResolvedValueOnce({ ...sceneResponse, memories: [] })
    await context.selectScene('bathing')
    expect(context.state.value.memories.status).toBe('empty')
    request.mockRejectedValueOnce(failure(500))
    await context.selectScene('bathing')
    expect(context.state.value.memories.status).toBe('error')
    const pending = deferred()
    request.mockReturnValueOnce(pending.promise)
    const read = context.selectScene('bathing')
    expect(context.state.value.memories).toMatchObject({ status: 'loading' })
    expect(context.state.value.memories.data).toBeUndefined()
    pending.resolve(sceneResponse)
    await read
    expect(context.state.value.memories.status).toBe('ready')
  })
  it('never labels unverified reference reads as an empty adopted list', async () => {
    const { context, request } = harness()
    request.mockImplementation(async (path) =>
      path.endsWith('/memory-references')
        ? Promise.reject(failure(500))
        : path.startsWith('/tasks/')
          ? task
          : path.startsWith('/elders/')
            ? resident
            : source,
    )
    await context.load(task.id, 'api')
    expect(context.state.value.task.status).toBe('ready')
    expect(context.state.value.references.status).toBe('error')
    expect(context.state.value.references.data).toBeUndefined()
  })
  it('does not read a record endpoint when the task has no source', async () => {
    const { context, request } = harness()
    request.mockResolvedValueOnce({ ...task, source_record_id: null })
    await context.load(task.id, 'api')
    expect(context.state.value.source.status).toBe('empty')
    expect(
      request.mock.calls.some(([path]) => path.startsWith('/records/')),
    ).toBe(false)
  })
  it('rejects a cross-resident source instead of showing its evidence', async () => {
    const { context, request } = harness()
    request
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(resident)
      .mockResolvedValueOnce({
        ...source,
        elder_id: 'OTHER',
        raw_text: 'private other resident',
      })
    await context.load(task.id, 'api')
    expect(context.state.value.source.status).toBe('error')
    expect(JSON.stringify(context.state.value)).not.toContain(
      'private other resident',
    )
  })
  it.each([401, 403])(
    'clears every loaded section on a %s from a related resource and stops the request chain',
    async (status) => {
      const { context, request } = harness()
      request.mockResolvedValueOnce(task).mockRejectedValueOnce(failure(status))
      await context.load(task.id, 'api')
      expect(request).toHaveBeenCalledTimes(2)
      expect(context.state.value.task.status).toBe('denied')
      expect(context.state.value.task.data).toBeUndefined()
      expect(context.state.value.source.data).toBeUndefined()
      expect(context.state.value.references.data).toBeUndefined()
    },
  )
  it('ignores an old task read after navigation and makes no related requests for it', async () => {
    const { context, request } = harness()
    const old = deferred()
    request.mockReturnValueOnce(old.promise)
    const first = context.load('TASK-old', 'api')
    await context.load(task.id, 'api')
    old.resolve({ ...task, id: 'TASK-old', elder_id: 'ELDER-old' })
    await first
    expect(context.state.value.task.data?.id).toBe(task.id)
    expect(
      request.mock.calls.some(([path]) => path.includes('ELDER-old')),
    ).toBe(false)
  })
  it('ignores late scene results after another scene selection and after clearing the selector', async () => {
    const { context, request } = harness()
    await context.load(task.id, 'api')
    const old = deferred()
    request.mockReturnValueOnce(old.promise)
    const first = context.selectScene('bathing')
    request.mockResolvedValueOnce({ ...sceneResponse, scene: 'rest' })
    await context.selectScene('rest')
    old.resolve(sceneResponse)
    await first
    expect(context.state.value.scene).toBe('rest')
    expect(context.state.value.memories.data?.scene).toBe('rest')
    const late = deferred()
    request.mockReturnValueOnce(late.promise)
    const read = context.selectScene('bathing')
    await context.selectScene('')
    late.resolve(sceneResponse)
    await read
    expect(context.state.value.memories.status).toBe('idle')
    expect(context.state.value.memories.data).toBeUndefined()
  })
  it('honors access revocation even from a superseded scene request', async () => {
    const { context, request } = harness()
    await context.load(task.id, 'api')
    const old = deferred()
    request.mockReturnValueOnce(old.promise)
    const first = context.selectScene('bathing')
    request.mockResolvedValueOnce({ ...sceneResponse, scene: 'rest' })
    await context.selectScene('rest')
    old.reject(failure(403))
    await first
    expect(context.state.value.task.status).toBe('denied')
    expect(context.state.value.memories.data).toBeUndefined()
  })
  it('discards late results on account, token or role changes and on unmount', async () => {
    for (const change of [
      { ...staff, accountKey: 'other-account' },
      { ...staff, accessToken: 'other-token' },
      { ...staff, role: 'family' as const },
      null,
    ]) {
      const { context, request, setSession } = harness()
      const pending = deferred()
      request.mockReturnValueOnce(pending.promise)
      const read = context.load(task.id, 'api')
      setSession(change)
      pending.resolve(task)
      await read
      expect(context.state.value.task.status).toBe('denied')
      expect(context.state.value.task.data).toBeUndefined()
      expect(request).toHaveBeenCalledTimes(1)
    }
    const { context, request } = harness()
    await context.load(task.id, 'api')
    const pending = deferred()
    request.mockReturnValueOnce(pending.promise)
    const read = context.selectScene('bathing')
    context.clear()
    pending.resolve(sceneResponse)
    await read
    expect(context.state.value.task.status).toBe('idle')
    expect(context.state.value.memories.data).toBeUndefined()
  })
  it('matches the entire session identity, never just a shared login name', () => {
    expect(sameCareSession(staff, { ...staff })).toBe(true)
    expect(sameCareSession(staff, { ...staff, userId: 'OTHER' })).toBe(false)
    expect(sameCareSession(staff, { ...staff, mode: 'demo' })).toBe(false)
    expect(sameCareSession(null, null)).toBe(false)
  })
})


it('uses only an explicit plan scene, never a scene guessed from the task title', async () => {
  expect(parseTaskContext({...task, source_plan_snapshot:{item:{scene:'activity'}}},task.id).service_scene).toBe('activity')
  expect(parseTaskContext({...task, title:'活动安排'},task.id).service_scene).toBeUndefined()
  expect(parseTaskContext({...task, source_plan_snapshot:{item:{scene:'invalid'}}},task.id).service_scene).toBeUndefined()
})
