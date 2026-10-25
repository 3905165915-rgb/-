import { shallowRef } from 'vue'
import type { AppMode, FrontendSession } from '../session'

export const careScenes = {
  bathing: '洗浴',
  dining: '饮食',
  activity: '活动',
  communication: '沟通',
  rest: '休息',
  other: '其他',
} as const
export type CareScene = keyof typeof careScenes
export const contextDisplayLimit = 10

type Row = Record<string, unknown>
export interface TaskContext {
  id: string
  elder_id: string
  title: string
  status: string
  revision: number
  assigned_to: string | null
  due_at: string | null
  condition: string | null
  completion_criteria: string | null
  source_record_id: string | null
  source_revision: number | null
  source_plan_id: string | null
  source_plan_revision: number | null
  plan_item_key: string | null
}
export interface MemorySource {
  record_id: string
  revision: number
  field: 'raw_text' | 'observations'
  quote: string
  snapshot_text: string
  record_status: string
  captured_at: string
}
export interface MemorySnapshot {
  id: string
  elder_id: string
  revision: number
  content: string
  category: string
  attributed_to: string
  scenes: CareScene[]
  source: MemorySource
  valid_from: string
  expires_at: string | null
  review_due_at: string | null
  confirmed_by: string
  confirmed_at: string
}
export interface ApplicableMemory extends MemorySnapshot {
  review_due: boolean
}
export interface AdoptedReference {
  id: string
  memory_id: string
  memory_revision: number
  scene: CareScene
  snapshot: MemorySnapshot
  status: 'active' | 'withdrawn'
  adopted_by: string
  adopted_at: string
  reason: string
  withdrawal_reason: string | null
  withdrawn_by: string | null
  withdrawn_at: string | null
  needs_review: boolean
  current: {
    memory_revision: number | null
    memory_status: string | null
    effective: boolean
    source_current: boolean
    review_due: boolean
    outdated: boolean
    reasons: string[]
  }
}
export interface ReferenceContext {
  task_id: string
  task_revision: number
  task_status: string
  historical_only: boolean
  needs_review: boolean
  as_of: string
  references: AdoptedReference[]
}
export interface SceneContext {
  elder_id: string
  scene: CareScene
  as_of: string
  memories: ApplicableMemory[]
}
export interface ResidentContext {
  id: string
  name: string
  bed_id: string | null
  status: string
}
export interface RecordContext {
  id: string
  elder_id: string
  revision: number
  status: string
  observations: string[]
  raw_text: string
}
type ReadStatus =
  'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'denied' | 'demo'
interface ReadState<T> {
  status: ReadStatus
  data?: T
  message: string
}
const slot = <T>(status: ReadStatus = 'idle', message = ''): ReadState<T> => ({
  status,
  message,
})
function initialState() {
  return {
    task: slot<TaskContext>(),
    resident: slot<ResidentContext>(),
    source: slot<RecordContext>(),
    references: slot<ReferenceContext>(),
    memories: slot<SceneContext>(),
    scene: '' as CareScene | '',
  }
}

function ensure(condition: unknown): asserts condition {
  if (!condition) throw new Error('任务依据响应不匹配')
}
function object(value: unknown): Row {
  ensure(value && typeof value === 'object' && !Array.isArray(value))
  return value as Row
}
function text(value: unknown): string {
  ensure(typeof value === 'string' && value.trim())
  return value
}
function nullableText(value: unknown): string | null {
  return value == null ? null : text(value)
}
function revision(value: unknown): number {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1)
  return value
}
function nullableRevision(value: unknown): number | null {
  return value === null ? null : revision(value)
}
function bool(value: unknown): boolean {
  ensure(typeof value === 'boolean')
  return value
}
function strings(value: unknown): string[] {
  ensure(Array.isArray(value))
  return value.map(text)
}
export function isCareScene(value: unknown): value is CareScene {
  return typeof value === 'string' && Object.hasOwn(careScenes, value)
}
function scene(value: unknown): CareScene {
  ensure(isCareScene(value))
  return value
}
export function parseTaskContext(value: unknown, taskId: string): TaskContext {
  const row = object(value)
  ensure(row.id === taskId)
  return {
    id: taskId,
    elder_id: text(row.elder_id),
    title: text(row.title),
    status: text(row.status),
    revision: revision(row.revision),
    assigned_to: nullableText(row.assigned_to),
    due_at: nullableText(row.due_at),
    condition: nullableText(row.condition),
    completion_criteria: nullableText(row.completion_criteria),
    source_record_id: nullableText(row.source_record_id),
    source_revision: row.source_revision == null ? null : revision(row.source_revision),
    source_plan_id: nullableText(row.source_plan_id),
    source_plan_revision:
      row.source_plan_revision == null
        ? null
        : revision(row.source_plan_revision),
    plan_item_key: nullableText(row.plan_item_key),
  }
}
function parseSnapshot(value: unknown, elderId: string): MemorySnapshot {
  const row = object(value)
  const source = object(row.source)
  const scenes = strings(row.scenes).map(scene)
  ensure(
    row.elder_id === elderId && row.status === 'confirmed' && scenes.length > 0,
  )
  ensure(
    ['stable_preference', 'temporary_wish', 'communication'].includes(
      text(row.category),
    ),
  )
  ensure(
    ['elder', 'family', 'staff', 'unknown'].includes(text(row.attributed_to)),
  )
  ensure(source.field === 'raw_text' || source.field === 'observations')
  return {
    id: text(row.id),
    elder_id: elderId,
    revision: revision(row.revision),
    content: text(row.content),
    category: text(row.category),
    attributed_to: text(row.attributed_to),
    scenes,
    source: {
      record_id: text(source.record_id),
      revision: revision(source.revision),
      field: source.field,
      quote: text(source.quote),
      snapshot_text: text(source.snapshot_text),
      record_status: text(source.record_status),
      captured_at: text(source.captured_at),
    },
    valid_from: text(row.valid_from),
    expires_at: nullableText(row.expires_at),
    review_due_at: nullableText(row.review_due_at),
    confirmed_by: text(row.confirmed_by),
    confirmed_at: text(row.confirmed_at),
  }
}
export function parseSceneContext(
  value: unknown,
  elderId: string,
  selected: CareScene,
): SceneContext {
  const row = object(value)
  ensure(
    row.elder_id === elderId &&
      row.scene === selected &&
      Array.isArray(row.memories),
  )
  const memories = row.memories.map((value) => {
    const item = object(value)
    const memory = parseSnapshot(item, elderId)
    ensure(
      item.effective === true &&
        item.source_current === true &&
        memory.scenes.includes(selected),
    )
    ensure(strings(item.blocked_reasons).length === 0)
    return { ...memory, review_due: bool(item.review_due) }
  })
  return {
    elder_id: elderId,
    scene: selected,
    as_of: text(row.as_of),
    memories,
  }
}
export function parseReferenceContext(
  value: unknown,
  task: TaskContext,
): ReferenceContext {
  const row = object(value)
  ensure(row.task_id === task.id && Array.isArray(row.references))
  // The detail and reference reads are separate snapshots; never merge different revisions.
  ensure(revision(row.task_revision) === task.revision)
  const references = row.references.map((value) => {
    const item = object(value)
    const current = object(item.current)
    const snapshot = parseSnapshot(item.snapshot, task.elder_id)
    const selected = scene(item.scene)
    ensure(
      item.memory_id === snapshot.id &&
        item.memory_revision === snapshot.revision,
    )
    ensure(
      snapshot.scenes.includes(selected) &&
        ['active', 'withdrawn'].includes(text(item.status)),
    )
    return {
      id: text(item.id),
      memory_id: snapshot.id,
      memory_revision: snapshot.revision,
      scene: selected,
      snapshot,
      status: item.status as 'active' | 'withdrawn',
      adopted_by: text(item.adopted_by),
      adopted_at: text(item.adopted_at),
      reason: text(item.reason),
      withdrawal_reason: nullableText(item.withdrawal_reason),
      withdrawn_by: nullableText(item.withdrawn_by),
      withdrawn_at: nullableText(item.withdrawn_at),
      needs_review: bool(item.needs_review),
      current: {
        memory_revision: nullableRevision(current.memory_revision),
        memory_status: nullableText(current.memory_status),
        effective: bool(current.effective),
        source_current: bool(current.source_current),
        review_due: bool(current.review_due),
        outdated: bool(current.outdated),
        reasons: strings(current.reasons),
      },
    }
  })
  return {
    task_id: task.id,
    task_revision: task.revision,
    task_status: text(row.task_status),
    historical_only: bool(row.historical_only),
    needs_review: bool(row.needs_review),
    as_of: text(row.as_of),
    references,
  }
}

export function sameCareSession(
  a: FrontendSession | null,
  b: FrontendSession | null,
): boolean {
  return (
    !!a &&
    !!b &&
    a.mode === b.mode &&
    a.accountKey === b.accountKey &&
    a.role === b.role &&
    a.userId === b.userId &&
    a.accessToken === b.accessToken
  )
}
function staffSession(value: FrontendSession | null): value is FrontendSession {
  return (
    !!value &&
    value.mode === 'api' &&
    !!value.accessToken &&
    !!value.accountKey &&
    ['admin', 'supervisor', 'caregiver'].includes(value.role || '')
  )
}
function httpStatus(error: unknown) {
  return error && typeof error === 'object' && 'status' in error
    ? error.status
    : undefined
}

export function createTaskCareContext(deps: {
  request: (path: string) => Promise<unknown>
  session: () => FrontendSession | null
}) {
  const state = shallowRef(initialState())
  let generation = 0
  let sceneGeneration = 0
  let owner: FrontendSession | null = null

  function clear(status: ReadStatus = 'idle') {
    generation++
    sceneGeneration++
    owner = null
    state.value = { ...initialState(), task: slot(status) }
  }
  function current(ticket: number) {
    if (ticket !== generation) return false
    if (
      !staffSession(deps.session()) ||
      !sameCareSession(owner, deps.session())
    ) {
      clear('denied')
      return false
    }
    return true
  }
  function denied(error: unknown) {
    if ([401, 403].includes(Number(httpStatus(error)))) {
      clear('denied')
      return true
    }
    return false
  }
  async function load(taskId: string, mode: AppMode) {
    clear(mode === 'demo' ? 'demo' : 'idle')
    if (mode === 'demo') return
    if (!staffSession(deps.session())) {
      clear('denied')
      return
    }
    if (!taskId.trim()) {
      state.value = { ...state.value, task: slot('empty') }
      return
    }
    owner = { ...deps.session()! }
    const ticket = generation
    state.value = { ...state.value, task: slot('loading') }
    let task: TaskContext
    try {
      const data = await deps.request(`/tasks/${encodeURIComponent(taskId)}`)
      if (!current(ticket)) return
      task = parseTaskContext(data, taskId)
      state.value = {
        ...state.value,
        task: { status: 'ready', data: task, message: '' },
      }
    } catch (error) {
      if (!current(ticket) || denied(error)) return
      state.value = {
        ...state.value,
        task: slot(
          httpStatus(error) === 404 ? 'empty' : 'error',
          '任务详情未载入，请重试。',
        ),
      }
      return
    }
    async function read<K extends 'resident' | 'source' | 'references'>(
      key: K,
      path: string,
      parse: (
        value: unknown,
      ) => NonNullable<ReturnType<typeof initialState>[K]['data']>,
    ) {
      if (!current(ticket)) return
      state.value = { ...state.value, [key]: slot('loading') }
      try {
        const value = await deps.request(path)
        if (!current(ticket)) return
        const data = parse(value)
        state.value = {
          ...state.value,
          [key]: { status: 'ready', data, message: '' },
        }
      } catch (error) {
        if (!current(ticket) || denied(error)) return
        state.value = {
          ...state.value,
          [key]: slot('error', '资料未载入或与当前任务不匹配，请刷新后核对。'),
        }
      }
    }
    await read(
      'resident',
      `/elders/${encodeURIComponent(task.elder_id)}`,
      (value) => {
        const row = object(value)
        ensure(row.id === task.elder_id)
        return {
          id: task.elder_id,
          name: text(row.name),
          bed_id: nullableText(row.bed_id),
          status: text(row.status),
        }
      },
    )
    if (task.source_record_id) {
      await read(
        'source',
        `/records/${encodeURIComponent(task.source_record_id)}`,
        (value) => {
          const row = object(value)
          ensure(
            row.id === task.source_record_id && row.elder_id === task.elder_id,
          )
          ensure(typeof row.raw_text === 'string')
          return {
            id: task.source_record_id!,
            elder_id: task.elder_id,
            revision: revision(row.revision),
            status: text(row.status),
            observations: strings(row.observations),
            raw_text: row.raw_text,
          }
        },
      )
    } else if (current(ticket)) {
      state.value = { ...state.value, source: slot('empty') }
    }
    await read(
      'references',
      `/tasks/${encodeURIComponent(task.id)}/memory-references`,
      (value) => parseReferenceContext(value, task),
    )
  }
  async function selectScene(selected: string) {
    const ticket = generation
    const sceneTicket = ++sceneGeneration
    state.value = {
      ...state.value,
      scene: isCareScene(selected) ? selected : '',
      memories: slot(),
    }
    if (!isCareScene(selected) || !state.value.task.data || !current(ticket))
      return
    const elderId = state.value.task.data.elder_id
    state.value = { ...state.value, memories: slot('loading') }
    try {
      const value = await deps.request(
        `/memories/context?elder_id=${encodeURIComponent(elderId)}&scene=${encodeURIComponent(selected)}`,
      )
      if (!current(ticket)) return
      // Even a superseded request can revoke access to the whole panel.
      const data = parseSceneContext(value, elderId, selected)
      if (sceneTicket !== sceneGeneration) return
      state.value = {
        ...state.value,
        memories: {
          status: data.memories.length ? 'ready' : 'empty',
          data,
          message: '',
        },
      }
    } catch (error) {
      if (!current(ticket) || denied(error) || sceneTicket !== sceneGeneration)
        return
      state.value = {
        ...state.value,
        memories: slot('error', '场景记忆未载入或响应不匹配，请重试。'),
      }
    }
  }
  return { state, load, selectScene, clear }
}
