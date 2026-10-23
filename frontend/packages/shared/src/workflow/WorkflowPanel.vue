<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearSession, readSession } from '../session'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { WorkflowRecovery, recoveryKey, supportsReplay, withoutSecrets, withSubmissionLock, type PendingWrite } from './recovery'
import { toCloudWav } from './audio'
import { validateCatalog } from './catalogs'
import { manualFallback, taskCreationInitial, taskCreationPayload, taskCreationSchema } from './task-create'
import { shiftFieldOptions, submissionIssue, writableShifts } from './shift-access'
import WorkflowField from './WorkflowField.vue'
import WorkflowResult from './WorkflowResult.vue'
import {
  operations,
  schemas,
  labels,
  type Operation,
  type Row,
  type Schema,
  initial,
  requestBody,
  materialize,
  request,
  listAll,
  resourceFor,
  rowName,
  WorkflowRequestError,
} from './model'
import './workflow.css'
const props = withDefaults(
  defineProps<{
    group: string
    title?: string
    context?: Row
    initialAction?: string
    autoRead?: boolean
    taskCreation?: boolean
  }>(),
  { title: '', context: () => ({}), initialAction: '', autoRead: false, taskCreation: false },
)
const emit = defineEmits<{ changed: []; select: [Row] }>()
const role = readSession()?.role
const allowed = computed(() =>
  operations.filter(
    (op) => op.group === props.group && role && op.roles.includes(role) &&
      (!props.taskCreation || (op.path === '/records/manual' && op.method === 'post')),
  ),
)
const activeId = ref('')
const active = computed(
  () =>
    allowed.value.find((op) => op.id === activeId.value) || allowed.value[0],
)
const params = ref<Row>({})
const body = ref<Row>({})
const catalogs = ref<Record<string, Row[]>>({})
const fieldOptions = computed(() => active.value
  ? shiftFieldOptions(active.value, catalogs.value, readSession()) : {})
const noWritableShift = computed(() => role === 'caregiver' && catalogs.value.shifts &&
  writableShifts(catalogs.value.shifts, readSession()).length === 0)
const selected = ref<Row>({ ...props.context })
const result = ref<unknown>(null)
const error = ref('')
const message = ref('')
const catalogErrors = ref<string[]>([])
const busy = ref(false)
const loading = ref(false)
const confirm = ref(false)
const phase = ref<'editing' | 'pending' | 'succeeded'>('editing')
const pending = ref<PendingWrite>()
const saveIssue = ref('')
const savedAt = ref('')
const ready = ref(false)
const serverMode = readSession()?.mode === 'api'
let restoring = false
let recovery: WorkflowRecovery | undefined
const frozen = computed(() => phase.value !== 'editing')
const uncertainExtraction = computed(() => phase.value === 'pending' && ['/records/extract', '/records/context-extract'].includes(active.value?.path || ''))
function formKey() {
  return recoveryKey(readSession()?.accountKey || '', props.taskCreation ? 'task-create' : props.group, props.context)
}
function restoreForm() {
  if (busy.value || recording.value || transcribing.value) return
  restoring = true
  try {
    const saved = recovery?.restore()
    if (saved && allowed.value.some(op => op.id === saved.operation)) {
      activeId.value = saved.operation
      params.value = saved.params
      body.value = saved.body
      phase.value = saved.phase
      pending.value = saved.pending
      result.value = saved.result ?? null
      savedAt.value = saved.updatedAt
      confirm.value = false
    }
    saveIssue.value = ''
  } catch (failure) {
    saveIssue.value = (failure as Error).message
  } finally {
    restoring = false
  }
}
function persistForm() {
  if (!serverMode) return true
  if (restoring || !ready.value || !active.value || !recovery) return false
  try {
    const saved = recovery.save({ operation: active.value.id,
      params: withoutSecrets(params.value) as Row, body: withoutSecrets(body.value) as Row,
      phase: phase.value, pending: pending.value, result: phase.value === 'succeeded' ? withoutSecrets(result.value) : undefined })
    savedAt.value = saved.updatedAt
    saveIssue.value = ''
    return true
  } catch (failure) {
    saveIssue.value = '本机保存未完成：' + (failure as Error).message
    return false
  }
}
function checkOtherWindow(event: StorageEvent) {
  if (event.key === recovery?.key && !recovery.isCurrent()) {
    confirm.value = false
    saveIssue.value = '其他窗口已修改此表单，请载入最新版本后核对。当前输入仍保留在本窗口。'
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (busy.value || recording.value || transcribing.value || !persistForm()) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function canLeave() {
  return !busy.value && !recording.value && !transcribing.value && persistForm()
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate(canLeave)
defineExpose({ canClose: canLeave })
const bodySchema = computed(() => {
  if (props.taskCreation) return taskCreationSchema()
  if (!active.value?.schema) return null
  const refName = active.value.schema.$ref?.split('/').pop()
  return refName ? schemas[refName] : active.value.schema
})
const paths: Record<string, string> = {
  elders: '/elders',
  beds: '/beds',
  staff:
    role === 'admin' || role === 'supervisor' ? '/staff/directory' : '/staff',
  shifts: '/shifts',
  records: '/records',
  drafts: '/records/drafts',
  tasks: '/tasks',
  memories: '/memories',
  handovers: '/handovers',
  assessments: '/assessments',
  plans: '/care-plans',
  changes: '/change-reviews',
  quality: '/quality/checks',
  incidents: '/incidents',
  family_accounts: '/family/accounts',
  bindings:
    role === 'family' ? '/family/me/bindings' : '/family/cases?kind=binding',
  summaries: '/family/cases?kind=summary',
  feedback: '/family/cases?kind=feedback',
}
const paginated = new Set([
  'staff',
  'records',
  'drafts',
  'shifts',
  'memories',
  'handovers',
  'assessments',
  'plans',
  'changes',
  'quality',
  'incidents',
  'bindings',
  'summaries',
  'feedback',
  'family_accounts',
])
const contextKeys: Record<string, string> = {
  ELDER: 'elder_id',
  BED: 'bed_id',
  USER: 'staff_id',
  SHIFT: 'shift_id',
  REC: 'record_id',
  AI: 'draft_id',
  TASK: 'task_id',
  HO: 'handover_id',
  HI: 'item_id',
  MEM: 'memory_id',
  TMR: 'reference_id',
  CR: 'case_id',
  QC: 'report_id',
  QI: 'issue_id',
  ASM: 'assessment_id',
  PLAN: 'plan_id',
  FAMILY: 'family_id',
  BINDING: 'binding_id',
  SUMMARY: 'summary_id',
  FEEDBACK: 'feedback_id',
  INCIDENT: 'incident_id',
  RECTIFY: 'rectification_id',
  ADM: 'admission_id',
}
function identify(row: Row) {
  const id = String(row.id || '')
  const prefix = id.split('-')[0]
  const key = contextKeys[prefix]
  const bag: Row = {}
  if (key) bag[key] = id
  if (prefix === 'REC') bag.source_record_id = id
  if (prefix === 'FAMILY') bag.account_id = id
  if (row.occurrence_key) bag.occurrence_key = row.occurrence_key
  if (row.fingerprint) bag.expected_fingerprint = row.fingerprint
  for (const name of [
    'elder_id',
    'shift_id',
    'task_id',
    'memory_id',
    'handover_id',
    'admission_id',
    'current_admission_id',
  ]) {
    if (row[name])
      bag[name === 'current_admission_id' ? 'admission_id' : name] = row[name]
  }
  return bag
}
function remember(row: Row) {
  if (phase.value === 'pending') return
  selected.value = { ...selected.value, ...identify(row) }
  for (const [field, value] of Object.entries(identify(row))) {
    if (field in params.value) params.value[field] = value
    if (field in body.value) body.value[field] = value
  }
  syncVersions()
  emit('select', row)
  message.value = `已选择：${rowName(row)}，可继续办理后续。`
}
function pick(field: string, value: unknown) {
  const resource = resourceFor[field]
  return catalogs.value[resource || '']?.find((row) => row.id === value)
}
function hasValue(value: unknown) { return value !== '' && value !== undefined && value !== null }
const versionIssue = computed(() => {
  const rootField = active.value?.parameters.find(p => p.in === 'path')?.name
  const root = rootField ? pick(rootField, params.value[rootField]) : undefined
  if (root && ((hasValue(body.value.expected_revision) && body.value.expected_revision !== root.revision) ||
    (body.value.expected_fingerprint && root.fingerprint && body.value.expected_fingerprint !== root.fingerprint)))
    return '服务器资料已变化，当前表单仍保留原版本。请刷新并核对差异，再采用当前版本。'
  for (const [id, version] of [['task_id', 'expected_task_revision'], ['memory_id', 'expected_memory_revision'], ['source_record_id', 'source_revision']]) {
    const row = pick(id, body.value[id] || params.value[id] || selected.value[id])
    if (row && hasValue(body.value[version]) && row.revision !== body.value[version]) return '所引用资料已更新，请核对当前证据后重新确认。'
  }
  return ''
})
function syncVersions() {
  const form = body.value
  const assign = (field: string, value: unknown) => {
    if (field in form && !hasValue(form[field]) && hasValue(value)) form[field] = value
  }
  const rootParam = active.value?.parameters.find((x) => x.in === 'path')?.name
  const root = rootParam ? pick(rootParam, params.value[rootParam]) : undefined
  if ('expected_revision' in form && hasValue(root?.revision))
    assign('expected_revision', root?.revision)
  if ('expected_fingerprint' in form && root?.fingerprint)
    assign('expected_fingerprint', root.fingerprint)
  if (
    'expected_fingerprint' in form &&
    !rootParam &&
    selected.value.expected_fingerprint
  )
    assign('expected_fingerprint', selected.value.expected_fingerprint)
  for (const [idField, revisionField] of [
    ['elder_id', 'expected_elder_revision'],
    ['bed_id', 'expected_bed_revision'],
    ['assessment_id', 'expected_assessment_revision'],
    ['memory_id', 'expected_memory_revision'],
    ['task_id', 'expected_task_revision'],
    ['previous_task_id', 'expected_task_revision'],
  ]) {
    const row = pick(
      idField,
      form[idField] || params.value[idField] || selected.value[idField],
    )
    if (hasValue(row?.revision) && revisionField in form)
      assign(revisionField, row?.revision)
  }
  if (
    'expected_task_revision' in form &&
    rootParam === 'task_id' &&
    hasValue(root?.revision)
  )
    assign('expected_task_revision', root?.revision)
  if ('expected_record_revision' in form) {
    const row = pick('record_id', selected.value.record_id)
    if (hasValue(row?.revision)) assign('expected_record_revision', row?.revision)
  }
  const source = pick('record_id', form.source_record_id)
  if (source && 'source_revision' in form) {
    assign('source_revision', source.revision)
    if (!form.source_field) form.source_field = 'observations'
    if (!form.source_quote)
      form.source_quote = (source.observations as string[])?.[0] || ''
  }
  const occurrence = catalogs.value.occurrences?.find(
    (row) => row.occurrence_key === form.occurrence_key,
  )
  if (occurrence?.fingerprint && 'expected_fingerprint' in form)
    assign('expected_fingerprint', occurrence.fingerprint)
  const incident =
    pick(
      'incident_id',
      form.incident_id ||
        params.value.incident_id ||
        selected.value.incident_id,
    ) ||
    (rootParam === 'rectification_id'
      ? catalogs.value.incidents?.find(
          (row) =>
            (row.rectification as Row)?.id === params.value.rectification_id,
        )
      : undefined)
  if ('expected_incident_revision' in form && incident)
    assign('expected_incident_revision', incident.revision)
  if ('expected_rectification_revision' in form && incident)
    assign('expected_rectification_revision', (incident.rectification as Row)?.revision)
}
function reset() {
  const op = active.value
  if (!op) return
  params.value = Object.fromEntries(
    op.parameters.map((p) => [
      p.name,
      selected.value[p.name] || initial(p.schema, p.name),
    ]),
  )
  body.value = bodySchema.value ? (props.taskCreation ? taskCreationInitial(bodySchema.value) : initial(bodySchema.value) as Row) : {}
  for (const key of Object.keys(body.value))
    if (selected.value[key]) body.value[key] = selected.value[key]
  syncVersions()
  confirm.value = false
  error.value = ''
  message.value = ''
}
function acceptCurrentVersions() {
  if (frozen.value || busy.value || recording.value || transcribing.value) return
  for (const field of Object.keys(body.value))
    if (/^(expected_.*(?:revision|fingerprint)|source_revision)$/.test(field)) body.value[field] = ''
  syncVersions()
  confirm.value = false
  message.value = '已载入当前版本，请重新核对内容和原文证据后再提交。'
  persistForm()
}
function collectResources(
  schema: Schema | null,
  output: Set<string>,
  seen = new Set<string>(),
) {
  if (!schema) return
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return
    seen.add(schema.$ref)
    collectResources(schemas[schema.$ref.split('/').pop()!], output, seen)
  }
  for (const [key, sub] of Object.entries(schema.properties || {})) {
    if (resourceFor[key]) output.add(resourceFor[key])
    collectResources(sub, output, seen)
  }
  for (const sub of schema.anyOf || []) collectResources(sub, output, seen)
  if (schema.items) collectResources(schema.items, output, seen)
}
async function loadCatalogs() {
  if (!serverMode) return
  loading.value = true
  catalogErrors.value = []
  try {
    const resources = new Set<string>()
    for (const op of allowed.value) {
      for (const p of op.parameters)
        if (resourceFor[p.name]) resources.add(resourceFor[p.name])
      collectResources(op.schema, resources)
    }
    const groupResource: Record<string, string> = {
      elders: 'elders',
      admission: 'beds',
      records: 'records',
      tasks: 'tasks',
      handovers: 'handovers',
      quality: 'quality',
      memories: 'memories',
      changes: 'changes',
      assessments: 'assessments',
      plans: 'plans',
      staff: 'staff',
      incidents: 'incidents',
    }
    if (groupResource[props.group]) resources.add(groupResource[props.group])
    if (resources.has('admissions')) resources.add('elders')
    if (resources.has('memories')) resources.add('elders')
    if (resources.has('handover_items')) resources.add('handovers')
    if (resources.has('issues')) resources.add('quality')
    if (role === 'caregiver' && resources.has('tasks')) resources.add('shifts')
    if (resources.has('rectifications')) resources.add('incidents')
    if (role === 'family') {
      resources.clear()
      resources.add('bindings')
    }
    if (role === 'caregiver')
      for (const resource of [
        'beds',
        'family_accounts',
        'bindings',
        'summaries',
        'feedback',
        'quality',
      ])
        resources.delete(resource)
    await Promise.all(
      [...resources]
        .filter((name) => paths[name] && name !== 'memories')
        .map(async (name) => {
          try {
            const data = paginated.has(name)
              ? await listAll(paths[name])
              : await request(paths[name])
            if (!Array.isArray(data)) throw new Error('目录格式异常')
            catalogs.value[name] = validateCatalog(name, data)
          } catch (failure) {
            delete catalogs.value[name]
            catalogErrors.value.push(`${name}：${(failure as Error).message}`)
          }
        }),
    )
    catalogs.value.handover_items = (catalogs.value.handovers || []).flatMap(
      (row) => (row.items || []) as Row[],
    )
    catalogs.value.issues = (catalogs.value.quality || []).flatMap(
      (row) => (row.issues || []) as Row[],
    )
    catalogs.value.rectifications = (catalogs.value.incidents || []).flatMap(
      (row) =>
        (row.rectification
          ? [row.rectification]
          : row.rectifications || []) as Row[],
    )
    catalogs.value.references = (catalogs.value.tasks || []).flatMap(
      (row) => (row.memory_references || []) as Row[],
    )
    if (resources.has('memories')) {
      const memories = await Promise.all(
        (catalogs.value.elders || []).map((row) =>
          listAll(`/memories?elder_id=${encodeURIComponent(String(row.id))}`),
        ),
      )
      catalogs.value.memories = validateCatalog('memories', memories.flat())
    }
    if (
      resources.has('admissions') &&
      role !== 'family' &&
      role !== 'caregiver'
    ) {
      const elders = catalogs.value.elders || []
      const admissions = await Promise.all(
        elders.map((row) =>
          listAll(`/elders/${encodeURIComponent(String(row.id))}/admissions`),
        ),
      )
      catalogs.value.admissions = admissions.flat()
    }
    if (props.group === 'assessments') {
      const templates = (await request('/assessments/templates')) as Row[]
      const template = templates[0]
      if (template) {
        const scoreFields: Record<string, Schema> = Object.fromEntries(
          (template.items as Row[]).map((item) => {
            labels[String(item.key)] = String(item.label)
            return [
              String(item.key),
              {
                type: 'integer',
                enum: (item.options as Row[]).map((option) =>
                  Number(option.score),
                ),
              },
            ]
          }),
        )
        const assess = schemas.AssessmentCreate
        if (assess.properties)
          assess.properties.scores = {
            type: 'object',
            properties: scoreFields,
            required: Object.keys(scoreFields),
          }
      }
    }
    syncVersions()
  } catch (failure) {
    catalogErrors.value.push((failure as Error).message)
  } finally {
    loading.value = false
  }
}
function setParam(field: string, value: unknown) {
  if (frozen.value || busy.value) return
  params.value[field] = value
  selected.value[field] = value
  for (const name of Object.keys(body.value))
    if (/^expected_.*(?:revision|fingerprint)$/.test(name)) body.value[name] = ''
  syncVersions()
}
function setBody(value: unknown) {
  if (frozen.value || busy.value) return
  body.value = value as Row
  syncVersions()
}
async function run() {
  if (busy.value || !active.value || saveIssue.value || phase.value === 'succeeded') return
  const op = active.value
  error.value = ''
  message.value = ''
  let path: string, payload: unknown, signature: string
  try {
    if (phase.value === 'pending' && pending.value) {
      if (!pending.value.retryable) throw new Error('此接口没有可确认的安全重放契约，请先核查服务器结果并联系主管；不要清空或重新创建同一操作。')
      path = pending.value.path
      payload = pending.value.payload
      signature = pending.value.signature
    } else {
      path = materialize(op, params.value)
      payload = bodySchema.value ? (props.taskCreation ? taskCreationPayload(bodySchema.value, body.value) : requestBody(op.path, bodySchema.value, body.value)) : undefined
      signature = JSON.stringify([readSession()?.accountKey, op.method, path, withoutSecrets(payload)])
      if (versionIssue.value) throw new Error(versionIssue.value)
      if (op.method !== 'get' && catalogErrors.value.length) throw new Error('所需目录未完整读取，请刷新可选数据并处理异常后再提交。')
    }
    // A request with an uncertain response must be allowed to ask the backend
    // for its idempotent result even if a successful transfer changed ownership.
    const issue = phase.value === 'pending' ? '' : submissionIssue(op, params.value, payload, catalogs.value, readSession())
    if (issue) throw new Error(issue)
  } catch (failure) {
    error.value = (failure as Error).message
    return
  }
  if (op.method !== 'get' && !confirm.value) {
    confirm.value = true
    return
  }
  busy.value = true
  try {
    if (op.method !== 'get') {
      await withSubmissionLock(formKey(), () => {
        if (!recovery?.isCurrent()) throw new Error('其他窗口已修改表单，请载入最新版本。')
        if (phase.value !== 'pending') {
          pending.value = { signature, key: crypto.randomUUID(), path, method: op.method,
            payload: withoutSecrets(payload), retryable: supportsReplay(path, op.method) && !('password' in body.value) }
          phase.value = 'pending'
        }
        if (!persistForm()) throw new Error(saveIssue.value)
      })
    }
    let data: unknown
    if (op.path === '/insights/changes' && op.method === 'get') {
      const first = (await request(
        path + (path.includes('?') ? '&' : '?') + 'limit=200',
      )) as Row
      const events = [...(first.events as Row[])]
      while (events.length < Number(first.total_events)) {
        const page = (await request(
          path +
            (path.includes('?') ? '&' : '?') +
            `limit=200&offset=${events.length}`,
        )) as Row
        if (!(page.events as Row[]).length) break
        events.push(...(page.events as Row[]))
      }
      data = { ...first, events, has_more: false }
      catalogs.value.events = events
    } else
      data =
        op.method === 'get' && op.paginated
          ? await listAll(path)
          : await request(
              path,
              op.method,
              payload,
              op.method === 'get' ? undefined : pending.value?.key,
            )
    result.value = data
    if (op.method !== 'get') {
      phase.value = 'succeeded'
      if (!persistForm()) {
        phase.value = 'pending'
        throw new Error('服务器已返回成功，但本机回执保存失败。请核查服务器结果，不要重新创建同一操作。')
      }
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Row
      if (obj.id) remember(obj)
      if (obj.record) remember(obj.record as Row)
      if (obj.task_id) selected.value.task_id = obj.task_id
      if (
        Array.isArray(obj.items) &&
        op.path.startsWith('/insights/coverage')
      ) {
        catalogs.value.occurrences = (obj.items as Row[]).map((row) => ({
          ...row,
          id: row.occurrence_key,
        }))
      }
    }
    confirm.value = false
    if (op.method !== 'get') {
      await loadCatalogs()
      emit('changed')
    }
    message.value =
      op.method === 'get' ? '已读取服务器当前数据。' : '服务器已确认操作成功。'
  } catch (failure) {
    error.value = (failure as Error).message
    if (failure instanceof WorkflowRequestError && ((failure.status >= 400 && failure.status < 500) ||
      (failure.status === 503 && ['/records/extract', '/records/context-extract'].includes(op.path)))) {
      phase.value = 'editing'
      pending.value = undefined
      confirm.value = false
      persistForm()
    }
  } finally {
    busy.value = false
  }
}
function choose(op: Operation) {
  if (busy.value || recording.value || transcribing.value || phase.value === 'pending' || op.id === active.value?.id) return
  const retained = op.path === '/records/manual' && ['/records/extract', '/records/context-extract'].includes(active.value?.path || '') ? manualFallback(body.value) : null
  restoring = true
  activeId.value = op.id
  phase.value = 'editing'
  pending.value = undefined
  reset()
  if (retained) Object.assign(body.value, retained)
  restoring = false
  persistForm()
}
function freshForm() {
  if (busy.value || recording.value || transcribing.value || phase.value === 'pending' || !window.confirm('确认开始新操作？本机编辑内容将清空，服务器历史不会删除。')) return
  restoring = true
  phase.value = 'editing'
  pending.value = undefined
  reset()
  restoring = false
  persistForm()
}
function fallbackAfterUncertainAI() {
  if (!uncertainExtraction.value || busy.value || !pending.value || saveIssue.value ||
    !window.confirm('AI请求结果仍待核实，可能留下未确认草稿，但尚未由此入口确认正式记录。保留该请求记录并使用原文进行人工记录？请勿再确认同一AI草稿。')) return
  const manual = allowed.value.find(op => op.path === '/records/manual' && op.method === 'post')
  if (!manual) return
  try {
    localStorage.setItem(formKey() + ':unresolved-ai:' + pending.value.key, JSON.stringify({
      pending: pending.value, source: withoutSecrets(body.value), updatedAt: new Date().toISOString(),
    }))
  } catch {
    error.value = '未能保留待核实AI请求，请先释放本机存储空间；原文未清空。'
    return
  }
  phase.value = 'editing'
  choose(manual)
  message.value = '已保留未核实AI请求并带入原文。请人工填写；不要再确认对应AI草稿，避免重复建立正式记录。'
}
function downloadJournal() {
  try {
    const journal = recovery?.journal()
    if (!journal) { error.value = '没有可导出的本窗口恢复日志。'; return }
    exportJSON(withoutSecrets(journal), '本窗口编辑恢复日志.json')
  } catch (failure) { error.value = (failure as Error).message }
}
async function inspectPending() {
  if (busy.value) return
  error.value = ''
  try {
    const root = pending.value?.path.split('?')[0].match(/^\/(tasks|handovers|records)\/([^/]+)/)
    result.value = root && !['manual', 'extract', 'context-extract'].includes(root[2])
      ? await request(`/${root[1]}/${root[2]}`) : await request(paths[props.group] || '/records')
    message.value = '仅读取当前服务器数据，尚未判定本次写入结果；不会自动解除待核实保护。'
  } catch (failure) { error.value = (failure as Error).message }
}
function useDraft() {
  if (busy.value) return
  const data = result.value as Row
  const op = allowed.value.find((x) => x.path === '/records/{draft_id}/confirm')
  if (!op || !data?.id) return
  selected.value.draft_id = data.id
  choose(op)
  body.value.observations = JSON.parse(JSON.stringify(data.observations || []))
  body.value.task_candidates = JSON.parse(
    JSON.stringify(data.task_candidates || []),
  )
}
function useAISummary() {
  if (busy.value) return
  const data = result.value as Row
  const op = allowed.value.find(
    (x) => x.path === '/handovers/{handover_id}/submit',
  )
  if (!op || !data) return
  const ai = data.ai_summary as Row | undefined
  choose(op)
  if (typeof ai?.text === 'string') body.value.summary = ai.text
  else if (typeof ai?.summary === 'string') body.value.summary = ai.summary
  body.value.approve_ai_summary = false
}
function exportJSON(value: unknown, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
  )
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
function download() { exportJSON(result.value, '照护证据链.json') }
let recorder: MediaRecorder | undefined
let stream: MediaStream | undefined
let recordingDeadline: ReturnType<typeof setTimeout> | undefined
const recording = ref(false)
const transcribing = ref(false)
let transcription: AbortController | undefined
let disposed = false
async function transcribeAudio(blob: Blob) {
  error.value = ''
  transcribing.value = true
  transcription = new AbortController()
  const timeout = setTimeout(() => transcription?.abort(), 90000)
  try {
    const audio = await toCloudWav(blob)
    const response = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1') +
        '/speech/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + readSession()?.accessToken,
          'Content-Type': 'audio/wav',
        },
        body: audio,
        signal: transcription.signal,
      },
    )
    const data = await response.json()
    if (disposed) return
    if (!response.ok) {
      if (response.status === 401) {
        clearSession()
        window.dispatchEvent(new Event('hulao:unauthorized'))
      }
      throw new Error(
        '语音识别失败，可重试或手工录入：' + JSON.stringify(data.detail),
      )
    }
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('转写响应缺少有效原文，请保留录音并手工录入。')
    const target = 'text' in body.value ? 'text' : 'raw_text'
    body.value[target] = [body.value[target], data.text]
      .filter(Boolean)
      .join('\n')
    message.value = '云端转写完成，请核对原文；尚未提取或保存正式记录。'
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    clearTimeout(timeout)
    transcribing.value = false
  }
}
async function uploadAudio(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) await transcribeAudio(file)
  ;(event.target as HTMLInputElement).value = ''
}
async function toggleRecording() {
  error.value = ''
  if (recording.value) {
    recorder?.stop()
    recording.value = false
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      clearTimeout(recordingDeadline)
      recording.value = false
      stream?.getTracks().forEach((track) => track.stop())
      await transcribeAudio(
        new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }),
      )
    }
    recorder.start()
    recording.value = true
    recordingDeadline = setTimeout(() => {
      if (recorder?.state === 'recording') recorder.stop()
    }, 60000)
  } catch (failure) {
    stream?.getTracks().forEach((track) => track.stop())
    error.value =
      '无法使用麦克风，可继续文字录入：' + (failure as Error).message
  }
}
onBeforeUnmount(() => {
  disposed = true
  transcription?.abort()
  persistForm()
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('storage', checkOtherWindow)
  clearTimeout(recordingDeadline)
  if (recorder?.state === 'recording') {
    recorder.onstop = null
    recorder.stop()
  }
  stream?.getTracks().forEach((track) => track.stop())
})
async function initializeRecovery() {
  if (!serverMode) return
  ready.value = false
  restoring = true
  selected.value = { ...props.context }
  phase.value = 'editing'
  pending.value = undefined
  result.value = null
  reset()
  try {
    let writer = sessionStorage.getItem('hulao:workflow-writer')
    if (!writer) { writer = crypto.randomUUID(); sessionStorage.setItem('hulao:workflow-writer', writer) }
    recovery = new WorkflowRecovery(formKey(), localStorage, writer)
    restoreForm()
  } catch (failure) { saveIssue.value = (failure as Error).message }
  restoring = false
  ready.value = true
  await loadCatalogs()
}
watch(
  () => [props.group, JSON.stringify(props.context)],
  async () => {
    activeId.value = ''
    result.value = null
    await initializeRecovery()
  },
)
watch([params, body], () => {
  if (!restoring) { confirm.value = false; persistForm() }
}, { deep: true, flush: 'sync' })
onMounted(async () => {
  if (!serverMode) return
  activeId.value =
    allowed.value.find(
      (op) =>
        props.initialAction &&
        op.path === props.initialAction &&
        (props.autoRead ? op.method === 'get' : op.method !== 'get'),
    )?.id ||
    allowed.value[0]?.id ||
    ''
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('storage', checkOtherWindow)
  await initializeRecovery()
  if (props.autoRead && active.value?.method === 'get') await run()
})
</script>
<template>
  <section class="workflow-panel">
    <header class="wf-header">
      <h2>{{ title || '业务办理' }}</h2>
      <button
        v-if="serverMode"
        type="button"
        class="wf-secondary"
        :disabled="loading || busy"
        @click="loadCatalogs"
      >
        {{ loading ? '正在读取目录…' : '刷新可选数据' }}
      </button>
    </header>
    <p v-if="!serverMode" class="wf-notice">此业务需要服务器测试账号和已授权数据。当前为本机演示，不会发送业务请求或模拟提交成功。</p>
    <p v-else-if="!allowed.length" class="wf-muted">当前身份没有此业务入口。</p>
    <template v-else-if="active">
      <nav v-if="allowed.length > 1" class="wf-actions" aria-label="业务操作">
        <button
          v-for="op in allowed"
          :key="op.id"
          type="button"
          :class="['wf-action', { selected: active.id === op.id }]"
          :disabled="busy || recording || transcribing || phase === 'pending'"
          @click="choose(op)"
        >
          {{ op.title }}
        </button>
      </nav>
      <p v-if="catalogErrors.length" class="wf-error" role="alert">
        部分目录读取失败：{{ catalogErrors.join('；') }}。可刷新重试。
      </p>
      <p v-if="saveIssue" class="wf-error" role="alert">
        {{ saveIssue }}
        <button type="button" class="wf-secondary" :disabled="busy" @click="restoreForm">载入最新本机版本</button>
        <button type="button" class="wf-secondary" :disabled="busy" @click="persistForm">重试本机保存</button>
        <button type="button" class="wf-secondary" :disabled="busy" @click="downloadJournal">导出本窗口恢复日志</button>
      </p>
      <p v-else-if="savedAt" class="wf-muted" role="status">
        {{ phase === 'pending' ? '结果待核实，已保留原请求' : phase === 'succeeded' ? '服务器已确认，本机回执已保存' : '已保存到本机，尚未提交服务器' }} · {{ new Date(savedAt).toLocaleString() }}
      </p>
      <p v-if="phase === 'pending'" class="wf-notice" role="alert">
        本次写入结果待核实，不能修改内容或重新创建同一操作。
        <button type="button" class="wf-secondary" :disabled="busy" @click="inspectPending">核查服务器当前数据</button>
        {{ pending?.retryable ? '可使用原请求安全核实，始终复用相同请求编号。' : '此接口不支持已确认的幂等重放，请联系主管核对。' }}
        <button v-if="uncertainExtraction" type="button" class="wf-secondary" :disabled="busy || !!saveIssue" @click="fallbackAfterUncertainAI">保留待核实AI请求并转人工</button>
      </p>
      <p v-if="versionIssue && phase === 'editing'" class="wf-notice" role="alert">
        {{ versionIssue }}
        <button type="button" class="wf-secondary" :disabled="busy || loading" @click="acceptCurrentVersions">采用当前版本并重新核对</button>
      </p>
      <form class="wf-form" @submit.prevent="run">
        <h3>{{ taskCreation ? '任务内容' : active.title }}</h3>
        <p v-if="taskCreation" class="wf-notice">将创建一条人工来源记录和一个待办。请手工确定负责人、截止时间及完成标准；完成标准随来源记录保存，不会修改老人偏好。</p>
        <p v-if="noWritableShift && active.method !== 'get'" class="wf-notice">
          当前没有分配给你的开放班次，请联系主管在班次管理中安排。已关闭或其他人的班次不能用于当班提交。
        </p>
        <p
          v-if="/extract|ai-summary|quality/.test(active.path)"
          class="wf-notice"
        >
          AI生成内容仅供核对，原文证据会保留。生成摘要、候选或质检提示，不会自动确认记录、执行任务或发布交班。
        </p>
        <fieldset
          :disabled="busy || frozen || recording || transcribing"
          class="wf-inputs"
        >
          <WorkflowField
            v-for="param in active.parameters"
            :key="param.name"
            :schema="param.schema"
            :field="param.name"
            :required="param.required"
            :model-value="params[param.name]"
            :catalogs="catalogs"
            :option-overrides="fieldOptions"
            @update:model-value="setParam(param.name, $event)"
          />
          <WorkflowField
            v-if="bodySchema"
            :schema="bodySchema"
            field="填写办理内容"
            :model-value="body"
            :catalogs="catalogs"
            :option-overrides="fieldOptions"
            @update:model-value="setBody"
          />
        </fieldset>
        <div
          v-if="
            active.method !== 'get' && ('text' in body || 'raw_text' in body)
          "
          class="wf-toolbar"
        >
          <button
            type="button"
            class="wf-secondary"
            :disabled="busy || frozen || transcribing"
            @click="toggleRecording"
          >
            {{
              recording
                ? '结束录音并转写'
                : transcribing
                  ? '云端转写中…'
                  : '语音录入'
            }}</button
          ><label class="wf-secondary"
            >上传录音<input
              aria-label="上传录音"
              type="file"
              accept="audio/*"
              :disabled="busy || frozen || recording || transcribing"
              @change="uploadAudio" /></label
          ><span class="wf-muted">最多60秒，转写后可编辑，不自动保存。</span>
        </div>
        <p v-if="confirm" class="wf-notice">
          请核对以上内容和当前版本，确认后写入服务器。{{
            active.path.includes('/confirm')
              ? '待办候选将随正式记录生成任务。'
              : ''
          }}
        </p>
        <div class="wf-toolbar">
          <button
            type="submit"
            class="wf-primary"
            :disabled="busy || loading || !!saveIssue || phase === 'succeeded' || (phase === 'pending' && !pending?.retryable) || recording || transcribing"
          >
            {{
              busy
                ? '正在提交，请勿重复操作…'
                : phase === 'pending'
                  ? '使用原请求核实结果'
                : phase === 'succeeded'
                  ? '本次操作已完成'
                : confirm
                  ? '确认提交'
                  : active.method === 'get'
                    ? '读取当前数据'
                    : '核对并继续'
            }}</button
          ><button
            v-if="confirm"
            type="button"
            class="wf-secondary"
            :disabled="busy"
            @click="confirm = false"
          >
            返回修改</button
          ><button
            type="button"
            class="wf-secondary"
            :disabled="busy || phase === 'pending' || !!saveIssue || recording || transcribing"
            @click="freshForm"
          >
            清空表单，开始新操作
          </button>
        </div>
      </form>
      <p v-if="error" class="wf-error" role="alert">{{ error }}</p>
      <p v-if="message" class="wf-success" role="status">{{ message }}</p>
      <section v-if="result !== null" class="wf-results">
        <h3>服务器结果与原文证据</h3>
        <div class="wf-toolbar">
          <button
            v-if="(result as Row)?.generation_kind"
            class="wf-primary"
            type="button"
            :disabled="busy"
            @click="useDraft"
          >
            人工核对此AI草稿</button
          ><button
            v-if="(result as Row)?.ai_summary"
            class="wf-primary"
            type="button"
            :disabled="busy"
            @click="useAISummary"
          >
            核对摘要并准备交班</button
          ><button
            v-if="active.path.endsWith('/export')"
            class="wf-secondary"
            type="button"
            @click="download"
          >
            下载证据链
          </button>
        </div>
        <WorkflowResult :value="result" @select="remember" />
      </section>
    </template>
  </section>
</template>
