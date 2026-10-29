<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resultAction, incidentActions } from './result-actions'
import { clearSession, readSession } from '../session'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import {
  WorkflowRecovery,
  recoveryKey,
  supportsReplay,
  withoutSecrets,
  withSubmissionLock,
  type PendingWrite,
} from './recovery'
import { toCloudWav } from './audio'
import { useVoiceRecorder } from './voice-recorder'
import { readSpeechResponse, speechErrorMessage } from './speech-response'
import { validateCatalog } from './catalogs'
import {
  manualFallback,
  taskCreationInitial,
  taskCreationPayload,
  taskCreationSchema,
  checkTaskCreationReceipt,
  taskSourceOptions,
  taskSourceIssue,
  updateTaskSource,
} from './task-create'
import {
  legacyTaskCreationSchema,
  legacyTaskCreationPayload,
} from './task-create-legacy'
import {
  isQualityScan,
  qualityScopeOptions,
  shiftFieldOptions,
  submissionIssue,
  updateQualityScope,
  writableShifts,
} from './shift-access'
import WorkflowField from './WorkflowField.vue'
import {
  admissionOptions,
  admissionIssue,
  isAdmissionCreate,
} from './admission'
import WorkflowResult from './WorkflowResult.vue'
import WorkflowMenu from './WorkflowMenu.vue'
import RecordResults from './RecordResults.vue'
import RecordTaskReview from './RecordTaskReview.vue'
import {
  recordTaskOwners,
  reviewedRecordTasks,
  selectedRecordTasks,
  recordSavedMessage,
} from './record-tasks'
import ServiceCareHints from './ServiceCareHints.vue'
import TaskCreationContext from './TaskCreationContext.vue'
import TaskFeedbackComposer from './TaskFeedbackComposer.vue'
import { withTaskFeedback } from './task-feedback'
import PhotoObservation from './PhotoObservation.vue'
import {
  careContextOptions,
  incidentEvidenceIssue,
  updateCareContext,
} from './care-context'
import { submissionFeedback } from './submission-feedback'
import {
  areaId,
  operationTitle,
  recordModeValue,
  workflowAreas,
} from './navigation'
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
  display,
  WorkflowRequestError,
} from './model'
import './workflow.css'
import { qualityFeedback, qualityModelUnavailable } from './quality-check'
const props = withDefaults(
  defineProps<{
    group: string
    title?: string
    context?: Row
    initialAction?: string
    initialMethod?: string
    autoRead?: boolean
    taskCreation?: boolean
    focused?: boolean
  }>(),
  {
    title: '',
    context: () => ({}),
    initialAction: '',
    initialMethod: '',
    autoRead: false,
    taskCreation: false,
    focused: false,
  },
)
const emit = defineEmits<{ changed: [value?: unknown]; select: [Row] }>()
const role = readSession()?.role
const allowed = computed(() =>
  operations.filter(
    (op) =>
      (op.group === props.group ||
        (props.taskCreation && op.path === '/records/manual')) &&
      role &&
      op.roles.includes(role) &&
      (props.taskCreation || op.path !== '/tasks' || op.method !== 'post') &&
      (!props.taskCreation ||
        (['/tasks', '/records/manual'].includes(op.path) &&
          op.method === 'post')),
  ),
)
const activeId = ref('')
const active = computed(
  () =>
    allowed.value.find((op) => op.id === activeId.value) || allowed.value[0],
)
const areas = computed(() => workflowAreas(allowed.value))
const activeArea = computed(() => (active.value ? areaId(active.value) : ''))
const activeAreaInfo = computed(() =>
  areas.value.find((area) => area.id === activeArea.value),
)
const hasMenu = computed(
  () => !props.focused && !props.taskCreation && allowed.value.length > 1,
)
const menuDialog = ref<HTMLDialogElement>()
const businessForm = ref<HTMLFormElement>()
const coverageContext = ref<Row | null>(null)
const coverageItemName = ref('')
const incidentDetail = computed(() =>
  props.group === 'incidents' &&
  active.value?.path === '/incidents/{incident_id}' &&
  result.value
    ? (result.value as Row)
    : null,
)
const incidentButtons = computed(() =>
  props.group === 'incidents' &&
  active.value?.path === '/incidents/{incident_id}' &&
  result.value
    ? incidentActions(result.value as Row, allowed.value)
    : [],
)

async function focusBusinessForm() {
  await nextTick()
  businessForm.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  businessForm.value
    ?.querySelector<HTMLElement>(
      'select:not(:disabled), textarea:not(:disabled), input:not([type=hidden]):not(:disabled)',
    )
    ?.focus({ preventScroll: true })
}

async function goIncidentAction(op: Operation) {
  if (busy.value || phase.value === 'pending') return
  const item = result.value as Row
  const rect = item.rectification as Row | null
  // The detail request may be newer than the initially loaded directories.
  catalogs.value.incidents = [
    ...(catalogs.value.incidents || []).filter((row) => row.id !== item.id),
    item,
  ]
  if (rect?.id)
    catalogs.value.rectifications = [
      ...(catalogs.value.rectifications || []).filter(
        (row) => row.id !== rect.id,
      ),
      rect,
    ]
  remember(item)
  if (rect?.id) selected.value.rectification_id = rect.id
  choose(op, false)
  if (active.value?.id !== op.id) return
  syncVersions()
  persistForm()
  await focusBusinessForm()
}

async function returnToCoverage() {
  const op = allowed.value.find(
    (item) => item.path === '/insights/coverage' && item.method === 'get',
  )
  if (!op || !coverageContext.value) return
  Object.assign(selected.value, coverageContext.value)
  choose(op, false)
  if (active.value?.id === op.id) await run()
}
const recordHistory = ref<unknown>(null)
const historyError = ref('')
const reviewSource = ref<Row | null>(null)
const recordComposer = computed(
  () => props.group === 'records' && activeArea.value === 'new',
)
const recordDetail = computed(
  () =>
    props.group === 'records' &&
    activeArea.value === 'records' &&
    active.value?.path !== '/records',
)
const draftDetail = computed(
  () =>
    props.group === 'records' &&
    activeArea.value === 'drafts' &&
    active.value?.path !== '/records/drafts',
)
const params = ref<Row>({})
const body = ref<Row>({})
const catalogs = ref<Record<string, Row[]>>({})
const taskSourcePreview = computed(() =>
  props.taskCreation && body.value.source_type === 'record'
    ? taskSourceOptions(body.value.elder_id, catalogs.value).find(
        (row) => row.id === body.value.source_id,
      )
    : undefined,
)
const taskSelectionEnabled = computed(
  () =>
    props.group === 'tasks' &&
    !!active.value?.parameters.some(
      (parameter) => parameter.name === 'task_id',
    ),
)
const selectedTaskElder = computed(() => {
  const selectedTask = (catalogs.value.tasks || []).find(
    (row) => row.id === params.value.task_id,
  )
  return String(selected.value.elder_id || selectedTask?.elder_id || '')
})
const fieldOptions = computed(() => {
  if (!active.value) return {}
  const options = isQualityScan(active.value)
    ? qualityScopeOptions(body.value, catalogs.value)
    : shiftFieldOptions(active.value, catalogs.value, readSession())
  Object.assign(
    options,
    admissionOptions(active.value, params.value, body.value, catalogs.value),
  )
  if (taskSelectionEnabled.value) {
    const permitted = new Set(
      (options.task_id || catalogs.value.tasks || []).map((row) => row.id),
    )
    options.task_id = (catalogs.value.tasks || []).filter(
      (row) =>
        permitted.has(row.id) &&
        !!selectedTaskElder.value &&
        row.elder_id === selectedTaskElder.value,
    )
  }
  if (
    active.value.path === '/tasks/{task_id}' &&
    active.value.method === 'patch'
  ) {
    const task = catalogs.value.tasks?.find(
      (row) => row.id === params.value.task_id,
    )
    const shift = catalogs.value.shifts?.find(
      (row) => row.id === task?.shift_id,
    )
    if (Array.isArray(shift?.caregiver_ids)) {
      const members = new Set(shift.caregiver_ids)
      options.assigned_to = (
        options.assigned_to ||
        catalogs.value.staff ||
        []
      ).filter((staff) => members.has(staff.id))
    }
  }
  if (props.taskCreation && active.value?.path === '/tasks')
    options.source_id = taskSourceOptions(body.value.elder_id, catalogs.value)
  if (props.taskCreation && body.value.shift_id) {
    const shift = catalogs.value.shifts?.find(
      (row) => row.id === body.value.shift_id,
    )
    if (Array.isArray(shift?.caregiver_ids)) {
      const members = new Set(shift.caregiver_ids)
      options.assigned_to = (
        options.assigned_to ||
        catalogs.value.staff ||
        []
      ).filter((staff) => members.has(staff.id))
    }
  }
  if (props.group === 'memories') {
    const memory = catalogs.value.memories?.find(
      (row) => row.id === params.value.memory_id,
    )
    Object.assign(
      options,
      careContextOptions(
        body.value.elder_id || memory?.elder_id || selected.value.elder_id,
        catalogs.value,
      ),
    )
  }
  if (props.group === 'incidents') {
    const incident = (catalogs.value.incidents || []).find(
      (row) =>
        row.id === params.value.incident_id ||
        (row.rectification as Row | undefined)?.id ===
          params.value.rectification_id,
    )
    Object.assign(
      options,
      careContextOptions(
        body.value.elder_id || incident?.elder_id || selected.value.elder_id,
        catalogs.value,
      ),
    )
  }
  return options
})
const noWritableShift = computed(
  () =>
    ['caregiver', 'nurse'].includes(role || '') &&
    catalogs.value.shifts &&
    writableShifts(catalogs.value.shifts, readSession()).length === 0,
)
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
const frozen = computed(() => phase.value !== 'editing' && !(quickQualityScan.value && phase.value === 'succeeded'))
const readOnly = computed(() => active.value?.method === 'get')
const quickQualityScan = computed(() =>
  !!active.value && isQualityScan(active.value),
)
const modelUnavailable = ref(false)
const feedback = computed(() =>
  submissionFeedback(active.value?.path || '', active.value?.method || 'get'),
)
const uncertainExtraction = computed(
  () =>
    phase.value === 'pending' &&
    ['/records/extract', '/records/context-extract'].includes(
      active.value?.path || '',
    ),
)
function formKey() {
  return recoveryKey(
    readSession()?.accountKey || '',
    props.taskCreation ? 'task-create' : props.group,
    props.context,
  )
}
function restoreForm(preferredArea?: string) {
  if (
    busy.value ||
    recording.value ||
    recordingLocked.value ||
    transcribing.value
  )
    return
  restoring = true
  try {
    const saved = recovery?.restore()
    reviewSource.value = null
    const savedOperation = allowed.value.find(
      (op) => op.id === saved?.operation,
    )
    // Queries are ephemeral. Keep existing write drafts untouched; an uncertain
    // write must still be restored so switching to a query cannot hide it.
    if (
      saved &&
      savedOperation &&
      savedOperation.method !== 'get' &&
      (!preferredArea ||
        areaId(savedOperation) === preferredArea ||
        saved.phase === 'pending') &&
      (!readOnly.value || saved.phase === 'pending')
    ) {
      activeId.value = saved.operation
      params.value = saved.params
      body.value = saved.body
      if (
        savedOperation.path === '/records/extract' &&
        saved.phase === 'editing'
      ) {
        const unified = allowed.value.find(
          (op) => op.path === '/records/context-extract',
        )
        if (unified) {
          activeId.value = unified.id
          body.value = recordModeValue(saved.body, 'assisted')
        }
      }
      phase.value = saved.phase
      pending.value = saved.pending
      result.value = saved.result ?? null
      savedAt.value = saved.updatedAt
      confirm.value = false
    }
    saveIssue.value = ''
  } catch (failure) {
    if (!readOnly.value) saveIssue.value = (failure as Error).message
  } finally {
    restoring = false
  }
}
function persistForm() {
  if (!serverMode) return true
  if (readOnly.value) return true
  if (restoring || !ready.value || !active.value || !recovery) return false
  try {
    const saved = recovery.save({
      operation: active.value.id,
      params: withoutSecrets(params.value) as Row,
      body: withoutSecrets(body.value) as Row,
      phase: phase.value,
      pending: pending.value,
      result:
        phase.value === 'succeeded' ? withoutSecrets(result.value) : undefined,
    })
    savedAt.value = saved.updatedAt
    saveIssue.value = ''
    return true
  } catch (failure) {
    saveIssue.value = '本机保存未完成：' + (failure as Error).message
    return false
  }
}
function checkOtherWindow(event: StorageEvent) {
  if (!readOnly.value && event.key === recovery?.key && !recovery.isCurrent()) {
    confirm.value = false
    saveIssue.value =
      '其他窗口已修改此表单，请载入最新版本后核对。当前输入仍保留在本窗口。'
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (
    busy.value ||
    recording.value ||
    recordingLocked.value ||
    transcribing.value ||
    !persistForm()
  ) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function canLeave() {
  return (
    !busy.value &&
    !recording.value &&
    !recordingLocked.value &&
    !transcribing.value &&
    persistForm()
  )
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate(canLeave)
defineExpose({ canClose: canLeave })
const bodySchema = computed(() => {
  if (props.taskCreation)
    return active.value?.path === '/records/manual'
      ? legacyTaskCreationSchema()
      : taskCreationSchema()
  if (!active.value?.schema) return null
  const refName = active.value.schema.$ref?.split('/').pop()
  return refName ? schemas[refName] : active.value.schema
})
const recordTaskReview = computed(
  () =>
    !props.taskCreation &&
    ['/records/{draft_id}/confirm', '/records/manual'].includes(
      active.value?.path || '',
    ),
)
const reviewDraft = computed(
  () =>
    reviewSource.value ||
    (catalogs.value.drafts || []).find(
      (row) => row.id === params.value.draft_id,
    ),
)
const reviewElderId = computed(() =>
  active.value?.path === '/records/manual'
    ? body.value.elder_id
    : reviewDraft.value?.elder_id,
)
const reviewShiftId = computed(() =>
  active.value?.path === '/records/manual'
    ? body.value.shift_id
    : reviewDraft.value?.shift_id,
)
const reviewElderName = computed(() =>
  String(
    (catalogs.value.elders || []).find((row) => row.id === reviewElderId.value)
      ?.name || '',
  ),
)
const reviewOwners = computed(() =>
  recordTaskOwners(catalogs.value, readSession(), reviewShiftId.value),
)
const recordTaskCount = computed(
  () => selectedRecordTasks(body.value.task_candidates).length,
)
const visibleParameters = computed(
  () =>
    active.value?.parameters.filter(
      (p) =>
        !(props.focused && p.in === 'path' && hasValue(props.context[p.name])),
    ) || [],
)
const visibleBodySchema = computed(() => {
  if (
    coverageContext.value &&
    active.value?.path === '/insights/coverage/reviews' &&
    bodySchema.value
  ) {
    const schema = structuredClone(bodySchema.value)
    for (const key of [
      'elder_id',
      'service_date',
      'occurrence_key',
      'expected_fingerprint',
    ])
      delete schema.properties?.[key]
    return schema
  }
  if (quickQualityScan.value && bodySchema.value) {
    const schema = structuredClone(bodySchema.value)
    delete schema.properties?.include_ai
    return schema
  }
  if (props.focused && bodySchema.value) {
    const schema = structuredClone(bodySchema.value)
    for (const key of Object.keys(schema.properties || {})) {
      if (/^(expected_.*(?:revision|fingerprint)|source_revision)$/.test(key))
        delete schema.properties?.[key]
    }
    return schema
  }
  if (active.value && isAdmissionCreate(active.value) && bodySchema.value) {
    const schema = structuredClone(bodySchema.value)
    delete schema.properties?.kind
    return schema
  }
  if (props.taskCreation && bodySchema.value) {
    const schema = structuredClone(bodySchema.value)
    delete schema.properties?.elder_id
    if (body.value.source_type !== 'record') {
      delete schema.properties?.source_id
      delete schema.properties?.source_revision
    }
    return schema
  }
  if (
    active.value?.path === '/tasks/{task_id}/complete' &&
    (body.value._care_feedback as Row | undefined)?.enabled === true &&
    bodySchema.value
  ) {
    const schema = structuredClone(bodySchema.value)
    delete schema.properties?.result
    return schema
  }
  if (!recordTaskReview.value || !bodySchema.value) return bodySchema.value
  const schema = structuredClone(bodySchema.value)
  delete schema.properties?.task_candidates
  return schema
})
function setRecordTasks(value: Row[]) {
  setBody({ ...body.value, task_candidates: value })
}
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
  'tasks',
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
function hasValue(value: unknown) {
  return value !== '' && value !== undefined && value !== null
}
const versionIssue = computed(() => {
  const rootField = active.value?.parameters.find((p) => p.in === 'path')?.name
  const root = rootField ? pick(rootField, params.value[rootField]) : undefined
  if (
    root &&
    ((hasValue(body.value.expected_revision) &&
      body.value.expected_revision !== root.revision) ||
      (body.value.expected_fingerprint &&
        root.fingerprint &&
        body.value.expected_fingerprint !== root.fingerprint))
  )
    return '服务器资料已变化，当前表单仍保留原版本。请刷新并核对差异，再采用当前版本。'
  for (const [id, version] of [
    ['elder_id', 'expected_elder_revision'],
    ['bed_id', 'expected_bed_revision'],
    ['task_id', 'expected_task_revision'],
    ['memory_id', 'expected_memory_revision'],
    ['source_record_id', 'source_revision'],
  ]) {
    const row = pick(
      id,
      body.value[id] || params.value[id] || selected.value[id],
    )
    if (
      row &&
      hasValue(body.value[version]) &&
      row.revision !== body.value[version]
    )
      return '所引用资料已更新，请核对当前证据后重新确认。'
  }
  return ''
})
function syncVersions() {
  const form = body.value
  if (
    props.group === 'incidents' &&
    'admission_id' in form &&
    !form.admission_id
  ) {
    const elder = catalogs.value.elders?.find((row) => row.id === form.elder_id)
    if (elder?.current_admission_id)
      form.admission_id = elder.current_admission_id
  }
  const assign = (field: string, value: unknown) => {
    if (field in form && !hasValue(form[field]) && hasValue(value))
      form[field] = value
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
    if (hasValue(row?.revision))
      assign('expected_record_revision', row?.revision)
  }
  const source = pick(
    'record_id',
    form.source_record_id || (props.taskCreation ? form.source_id : ''),
  )
  if (source && 'source_revision' in form) {
    assign('source_revision', source.revision)
    if ('source_field' in form && !form.source_field)
      form.source_field = 'observations'
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
    assign(
      'expected_rectification_revision',
      (incident.rectification as Row)?.revision,
    )
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
  body.value = bodySchema.value
    ? props.taskCreation
      ? taskCreationInitial(bodySchema.value)
      : (initial(bodySchema.value) as Row)
    : {}
  if (isQualityScan(op)) body.value.include_ai = true
  modelUnavailable.value = false
  for (const key of Object.keys(body.value))
    if (selected.value[key]) body.value[key] = selected.value[key]
  syncVersions()
  confirm.value = false
  error.value = ''
  message.value = ''
}
function acceptCurrentVersions() {
  if (
    frozen.value ||
    busy.value ||
    recording.value ||
    recordingLocked.value ||
    transcribing.value
  )
    return
  for (const field of Object.keys(body.value))
    if (/^(expected_.*(?:revision|fingerprint)|source_revision)$/.test(field))
      body.value[field] = ''
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
    if (props.taskCreation) {
      resources.add('tasks')
      resources.add('records')
    }
    if (resources.has('admissions')) resources.add('elders')
    if (resources.has('memories')) resources.add('elders')
    if (resources.has('handover_items')) resources.add('handovers')
    if (resources.has('issues')) resources.add('quality')
    if (['caregiver', 'nurse'].includes(role || '') && resources.has('tasks'))
      resources.add('shifts')
    if (resources.has('rectifications')) resources.add('incidents')
    if (role === 'family') {
      resources.clear()
      resources.add('bindings')
    }
    if (['caregiver', 'nurse'].includes(role || ''))
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
      !['caregiver', 'nurse'].includes(role || '')
    ) {
      const elders = catalogs.value.elders || []
      const admissions = await Promise.all(
        elders.map((row) =>
          listAll(`/elders/${encodeURIComponent(String(row.id))}/admissions`),
        ),
      )
      catalogs.value.admissions = admissions.flat()
    }
    if (
      resources.has('admissions') &&
      ['caregiver', 'nurse'].includes(role || '')
    )
      catalogs.value.admissions = (catalogs.value.elders || []).flatMap(
        (row) =>
          row.current_admission_id
            ? [
                {
                  id: row.current_admission_id,
                  elder_id: row.id,
                  name: '当前入住关系',
                  status: 'active',
                },
              ]
            : [],
      )
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
  if (
    props.group === 'incidents' &&
    ['incident_id', 'rectification_id'].includes(field) &&
    params.value[field] !== value &&
    'evidence' in body.value
  )
    body.value.evidence = []
  params.value[field] = value
  selected.value[field] = value
  if (field === 'elder_id' && active.value && isAdmissionCreate(active.value))
    body.value.bed_id = ''
  if (field === 'task_id') {
    const task = catalogs.value.tasks?.find((row) => row.id === value)
    if (task) selected.value.elder_id = task.elder_id
  }
  if (
    field === 'task_id' &&
    active.value?.path === '/tasks/{task_id}/complete'
  ) {
    body.value.result = ''
    body.value._care_feedback = {}
  }
  if (field === 'record_id') {
    recordHistory.value = null
    historyError.value = ''
  }
  if (field === 'draft_id') {
    reviewSource.value = null
    if (active.value?.path === '/records/{draft_id}/confirm') {
      const draft = pick('draft_id', value)
      body.value.observations = JSON.parse(
        JSON.stringify(draft?.observations || []),
      )
      body.value.task_candidates = JSON.parse(
        JSON.stringify(draft?.task_candidates || []),
      )
    }
  }
  confirm.value = false
  for (const name of Object.keys(body.value))
    if (/^expected_.*(?:revision|fingerprint)$/.test(name))
      body.value[name] = ''
  syncVersions()
}
function chooseTaskElder(elderId: string) {
  if (busy.value || frozen.value) return
  selected.value = { ...selected.value, elder_id: elderId, task_id: '' }
  params.value.task_id = ''
  if (active.value?.path === '/tasks/{task_id}/complete') {
    body.value.result = ''
    body.value._care_feedback = {}
  }
  message.value = ''
}
function setBody(value: unknown) {
  if (frozen.value || busy.value) return
  const previousTaskBody = { ...body.value }
  const previousElder = body.value.elder_id
  const previousTasks = body.value.task_candidates
  body.value =
    active.value && isQualityScan(active.value)
      ? updateQualityScope(body.value, value as Row, catalogs.value)
      : (value as Row)
  if (active.value && isAdmissionCreate(active.value)) {
    if (previousTaskBody.kind !== body.value.kind) {
      params.value.elder_id = ''
      selected.value.elder_id = ''
      body.value.bed_id = ''
      body.value.expected_elder_revision = ''
      body.value.expected_bed_revision = ''
    }
    if (previousTaskBody.bed_id !== body.value.bed_id)
      body.value.expected_bed_revision = ''
  }
  if (
    active.value?.path === '/admissions/{admission_id}/actions' &&
    previousTaskBody.action !== body.value.action &&
    body.value.action !== 'transfer'
  ) {
    body.value.bed_id = ''
    body.value.expected_bed_revision = ''
  }
  // Generic form edits must not drop the separately reviewed task cards.
  if (recordTaskReview.value && !Object.hasOwn(body.value, 'task_candidates'))
    body.value.task_candidates = previousTasks || []
  if (
    active.value?.path === '/records/manual' &&
    previousElder &&
    previousElder !== body.value.elder_id
  )
    body.value.task_candidates = []
  if (props.taskCreation || props.group === 'incidents') {
    body.value = updateCareContext(
      { elder_id: previousElder },
      body.value,
      catalogs.value,
      props.taskCreation,
    )
    if (previousElder && previousElder !== body.value.elder_id)
      message.value = props.taskCreation
        ? '已切换老人，原任务内容已清空，请为当前老人重新填写。'
        : '已切换老人，请重新选择当前老人的事实证据。'
  }
  if (props.taskCreation && active.value?.path === '/tasks')
    body.value = updateTaskSource(previousTaskBody, body.value, catalogs.value)
  confirm.value = false
  syncVersions()
}
async function run() {
  if (
    busy.value ||
    !active.value ||
    (!readOnly.value && saveIssue.value) ||
    (phase.value === 'succeeded' && !quickQualityScan.value)
  )
    return
  const op = active.value
  if (quickQualityScan.value && phase.value === 'succeeded') {
    phase.value = 'editing'
    pending.value = undefined
    if (!persistForm()) return
  }
  error.value = ''
  message.value = ''
  let path: string, payload: unknown, signature: string
  try {
    if (phase.value === 'pending' && pending.value) {
      if (!pending.value.retryable)
        throw new Error(
          '此接口没有可确认的安全重放契约，请先核查服务器结果并联系主管；不要清空或重新创建同一操作。',
        )
      path = pending.value.path
      payload = pending.value.payload
      signature = pending.value.signature
    } else {
      path = materialize(op, params.value)
      const recordBody = recordTaskReview.value
        ? {
            ...body.value,
            task_candidates: reviewedRecordTasks(
              body.value.task_candidates || [],
              reviewOwners.value,
            ),
          }
        : body.value
      if (recordTaskReview.value && !reviewElderName.value)
        throw new Error('请先选择或成功载入本条记录对应的老人，再核对任务。')
      payload = bodySchema.value
        ? props.taskCreation
          ? op.path === '/records/manual'
            ? legacyTaskCreationPayload(bodySchema.value, body.value)
            : taskCreationPayload(bodySchema.value, body.value)
          : requestBody(
              op.path,
              bodySchema.value,
              op.path === '/tasks/{task_id}/complete'
                ? withTaskFeedback(recordBody)
                : recordBody,
            )
        : undefined
      if (props.taskCreation && op.path === '/tasks') {
        const issue = taskSourceIssue(payload as Row, catalogs.value)
        if (issue) throw new Error(issue)
      }
      if (op.path === '/incidents' && op.method === 'post') {
        const issue = incidentEvidenceIssue(payload as Row, catalogs.value)
        if (issue) throw new Error(issue)
      }
      signature = JSON.stringify([
        readSession()?.accountKey,
        op.method,
        path,
        withoutSecrets(payload),
      ])
      if (versionIssue.value) throw new Error(versionIssue.value)
      const admissionProblem = admissionIssue(
        op,
        params.value,
        body.value,
        catalogs.value,
      )
      if (admissionProblem) throw new Error(admissionProblem)
      if (op.method !== 'get' && catalogErrors.value.length)
        throw new Error(
          '所需目录未完整读取，请刷新可选数据并处理异常后再提交。',
        )
    }
    // A request with an uncertain response must be allowed to ask the backend
    // for its idempotent result even if a successful transfer changed ownership.
    const issue =
      phase.value === 'pending'
        ? ''
        : submissionIssue(
            op,
            params.value,
            payload,
            catalogs.value,
            readSession(),
          )
    if (issue) throw new Error(issue)
  } catch (failure) {
    error.value = (failure as Error).message
    return
  }
  if (op.method !== 'get' && !confirm.value && !quickQualityScan.value) {
    confirm.value = true
    return
  }
  busy.value = true
  try {
    if (op.method !== 'get') {
      await withSubmissionLock(formKey(), () => {
        if (!recovery?.isCurrent())
          throw new Error('其他窗口已修改表单，请载入最新版本。')
        if (phase.value !== 'pending') {
          pending.value = {
            signature,
            key: crypto.randomUUID(),
            path,
            method: op.method,
            payload: withoutSecrets(payload),
            retryable:
              supportsReplay(path, op.method) && !('password' in body.value),
          }
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
    if (props.taskCreation && op.path === '/tasks' && op.method === 'post')
      checkTaskCreationReceipt(data, payload as Row)
    if (isQualityScan(op)) qualityFeedback(data)
    result.value = data
    if (op.method !== 'get') {
      phase.value = 'succeeded'
      if (!persistForm()) {
        phase.value = 'pending'
        throw new Error(
          '服务器已返回成功，但本机回执保存失败。请核查服务器结果，不要重新创建同一操作。',
        )
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
    message.value =
      isQualityScan(op) ? qualityFeedback(data) : recordSavedMessage(data) || submissionFeedback(op.path, op.method).success
    if (op.method !== 'get') {
      // The write has already been acknowledged and persisted locally. Directory
      // refresh must never keep the save button stuck in its submitting state.
      void loadCatalogs()
      emit('changed', data)
    }
    if (
      props.group === 'records' &&
      /^\/records\/\{record_id\}(?:\/corrections)?$/.test(op.path)
    )
      await loadRecordHistory(String(params.value.record_id || ''))
  } catch (failure) {
    error.value = (failure as Error).message
    if (
      failure instanceof WorkflowRequestError &&
      ((failure.status >= 400 && failure.status < 500) ||
        (isQualityScan(op) && qualityModelUnavailable(failure.status, failure.code)) ||
        (failure.status === 503 &&
          ['/records/extract', '/records/context-extract'].includes(op.path)))
    ) {
      phase.value = 'editing'
      pending.value = undefined
      confirm.value = false
      persistForm()
      if (isQualityScan(op) && qualityModelUnavailable(failure.status, failure.code)) modelUnavailable.value = true
    }
  } finally {
    busy.value = false
  }
}
function choose(op: Operation, resumeSaved = true) {
  if (
    busy.value ||
    recording.value ||
    recordingLocked.value ||
    transcribing.value ||
    phase.value === 'pending' ||
    op.id === active.value?.id
  )
    return
  const wasReadOnly = readOnly.value
  if (wasReadOnly && op.method !== 'get') {
    try {
      if (recovery?.restore()?.phase === 'pending') {
        restoreForm()
        return
      }
    } catch (failure) {
      saveIssue.value = (failure as Error).message
      return
    }
  }
  if (!wasReadOnly && !persistForm()) return
  const retained =
    op.path === '/records/manual' &&
    ['/records/extract', '/records/context-extract'].includes(
      active.value?.path || '',
    )
      ? manualFallback(body.value)
      : null
  restoring = true
  activeId.value = op.id
  phase.value = 'editing'
  pending.value = undefined
  saveIssue.value = ''
  savedAt.value = ''
  result.value = null
  reviewSource.value = null
  if (
    props.group === 'records' &&
    op.path !== '/records/{record_id}/corrections'
  ) {
    recordHistory.value = null
    historyError.value = ''
  }
  reset()
  if (retained) Object.assign(body.value, retained)
  restoring = false
  if (wasReadOnly && op.method !== 'get' && resumeSaved) restoreForm(areaId(op))
  persistForm()
}
async function selectMenu(op: Operation) {
  choose(op)
  menuDialog.value?.close()
  if (
    props.group === 'records' &&
    active.value?.id === op.id &&
    op.method === 'get'
  )
    await run()
}
function openMenu() {
  menuDialog.value?.showModal()
}
async function goRecordOperation(path: string) {
  const op = allowed.value.find((item) => item.path === path)
  if (op) {
    choose(op, false)
    if (active.value?.id === op.id && op.method === 'get') await run()
  }
}
function switchRecordMode(mode: 'manual' | 'assisted') {
  if (
    busy.value ||
    recording.value ||
    recordingLocked.value ||
    transcribing.value ||
    phase.value === 'pending'
  )
    return
  const target =
    mode === 'manual' ? '/records/manual' : '/records/context-extract'
  const op = allowed.value.find((item) => item.path === target)
  if (!op || op.id === active.value?.id) return
  if (phase.value === 'succeeded') {
    message.value = '本次操作已完成。请先开始新记录，避免重复保存同一内容。'
    return
  }
  if (
    mode === 'assisted' &&
    (body.value.happened_at ||
      (body.value.observations as unknown[])?.length ||
      (body.value.task_candidates as unknown[])?.length) &&
    !window.confirm(
      '切换后保留原文、老人和班次；发生时间、人工观察和待办需重新核对填写。继续切换？',
    )
  )
    return
  const retained = recordModeValue(body.value, mode)
  choose(op, false)
  if (active.value?.id !== op.id) return
  body.value = { ...body.value, ...retained }
  persistForm()
}
async function selectResult(row: Row) {
  if (phase.value === 'pending' || busy.value) return
  const next = resultAction(props.group, row, params.value)
  if (next) {
    const op = allowed.value.find(
      (item) =>
        item.path === next.path && (item.method === 'get') === next.autoRead,
    )
    if (!op) return
    if (props.group === 'coverage') {
      coverageContext.value = {
        elder_id: next.context.elder_id,
        service_date: next.context.service_date,
      }
      coverageItemName.value = rowName(row)
    }
    Object.assign(selected.value, next.context)
    remember(row)
    choose(op, false)
    if (active.value?.id !== op.id) return
    if (next.autoRead) await run()
    else {
      message.value = `正在处理：${rowName(row)}。请选择处理结论并填写说明。`
      persistForm()
    }
    await focusBusinessForm()
    return
  }
  remember(row)
  if (props.group === 'handovers' && row.status === 'draft') {
    const nextPath =
      Number(row.revision || 0) < 1
        ? '/handovers/{handover_id}/refresh'
        : '/handovers/{handover_id}/submit'
    const op = allowed.value.find((item) => item.path === nextPath)
    if (!op) return
    choose(op, false)
    if (active.value?.id !== op.id) return
    params.value.handover_id = row.id
    selected.value.handover_id = row.id
    if (nextPath.endsWith('/submit')) {
      if (Number.isInteger(row.revision))
        body.value.expected_revision = row.revision
      body.value.summary = ''
    }
    syncVersions()
    persistForm()
    message.value = nextPath.endsWith('/refresh')
      ? '先刷新交班事项，核对来源记录和未完成任务；刷新后可填写交班注意事项。'
      : '已打开交班注意事项填写表单。交班事项由来源记录和未完成任务自动带入，请逐项核对。'
    return
  }
  if (props.group !== 'records') return
  const id = String(row.id || '')
  const path = id.startsWith('REC-')
    ? '/records/{record_id}'
    : id.startsWith('AI-')
      ? '/records/drafts/{draft_id}'
      : ''
  const op = allowed.value.find((item) => item.path === path)
  if (!op) return
  choose(op, false)
  if (active.value?.id === op.id) await run()
}
async function loadRecordHistory(recordId: string) {
  if (!recordId) return
  historyError.value = ''
  try {
    recordHistory.value = await request(
      `/records/${encodeURIComponent(recordId)}/history`,
    )
  } catch {
    historyError.value = '更正历史暂未读取成功，可重试；当前记录仍保留。'
  }
}
function freshForm() {
  if (quickQualityScan.value && phase.value === 'succeeded' && !busy.value) {
    phase.value = 'editing'
    pending.value = undefined
    result.value = null
    body.value.include_ai = true
    modelUnavailable.value = false
    message.value = '已保留检查范围，可调整后再次检查。历史报告仍保留。'
    persistForm()
    return
  }
  if (
    busy.value ||
    recording.value ||
    recordingLocked.value ||
    transcribing.value ||
    phase.value === 'pending' ||
    !window.confirm('确认开始新操作？本机编辑内容将清空，服务器历史不会删除。')
  )
    return
  restoring = true
  phase.value = 'editing'
  pending.value = undefined
  result.value = null
  reviewSource.value = null
  recordHistory.value = null
  historyError.value = ''
  if (props.taskCreation) {
    cancelAudio()
    activeId.value = initialOperationId()
    selected.value = { ...props.context }
  }
  reset()
  if (props.taskCreation) {
    selected.value = { ...props.context }
    params.value = {}
  }
  restoring = false
  persistForm()
}
function fallbackAfterUncertainAI() {
  if (
    !uncertainExtraction.value ||
    busy.value ||
    !pending.value ||
    saveIssue.value ||
    !window.confirm(
      'AI请求结果仍待核实，可能留下未确认草稿，但尚未由此入口确认正式记录。保留该请求记录并使用原文进行人工记录？请勿再确认同一AI草稿。',
    )
  )
    return
  const manual = allowed.value.find(
    (op) => op.path === '/records/manual' && op.method === 'post',
  )
  if (!manual) return
  try {
    localStorage.setItem(
      formKey() + ':unresolved-ai:' + pending.value.key,
      JSON.stringify({
        pending: pending.value,
        source: withoutSecrets(body.value),
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    error.value = '未能保留待核实AI请求，请先释放本机存储空间；原文未清空。'
    return
  }
  phase.value = 'editing'
  choose(manual)
  message.value =
    '已保留未核实AI请求并带入原文。请人工填写；不要再确认对应AI草稿，避免重复建立正式记录。'
}
function downloadJournal() {
  try {
    const journal = recovery?.journal()
    if (!journal) {
      error.value = '没有可导出的本窗口恢复日志。'
      return
    }
    exportJSON(withoutSecrets(journal), '本窗口编辑恢复日志.json')
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
async function inspectPending() {
  if (busy.value) return
  error.value = ''
  try {
    const root = pending.value?.path
      .split('?')[0]
      .match(/^\/(tasks|handovers|records)\/([^/]+)/)
    result.value =
      root && !['manual', 'extract', 'context-extract'].includes(root[2])
        ? await request(`/${root[1]}/${root[2]}`)
        : await request(paths[props.group] || '/records')
    message.value =
      '仅读取当前服务器数据，尚未判定本次写入结果；不会自动解除待核实保护。'
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
function useDraft() {
  if (busy.value) return
  const data = result.value as Row
  const op = allowed.value.find((x) => x.path === '/records/{draft_id}/confirm')
  if (!op || !data?.id) return
  selected.value.draft_id = data.id
  choose(op, false)
  if (active.value?.id !== op.id) return
  reviewSource.value = data
  body.value.observations = JSON.parse(JSON.stringify(data.observations || []))
  body.value.task_candidates = JSON.parse(
    JSON.stringify(data.task_candidates || []),
  )
  syncVersions()
}
function useAISummary() {
  if (busy.value) return
  const data = result.value as Row
  const op = allowed.value.find(
    (x) => x.path === '/handovers/{handover_id}/submit',
  )
  if (!op || !data) return
  const ai = data.ai_summary as Row | undefined
  choose(op, false)
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
function download() {
  exportJSON(result.value, '照护证据链.json')
}
const voice = useVoiceRecorder({
  onAudio: transcribeAudio,
  onError: (message) => {
    error.value = message
  },
})
const {
  recording,
  starting,
  finishing,
  seconds,
  locked: recordingLocked,
} = voice
const transcribing = ref(false)
const audioInput = ref<HTMLInputElement | null>(null)
const audioFileName = ref('')
let speechEpoch = 0
let transcription: AbortController | undefined
let disposed = false
async function transcribeAudio(blob: Blob) {
  if (disposed || transcribing.value) return
  const ticket = speechEpoch
  error.value = ''
  transcribing.value = true
  const controller = new AbortController()
  transcription = controller
  const timeout = setTimeout(() => controller.abort(), 90000)
  try {
    const audio = await toCloudWav(blob)
    if (disposed || ticket !== speechEpoch || controller.signal.aborted) return
    const response = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '') +
        '/speech/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + readSession()?.accessToken,
          'Content-Type': 'audio/wav',
        },
        body: audio,
        signal: controller.signal,
      },
    )
    if (response.status === 401) {
      clearSession()
      window.dispatchEvent(new Event('hulao:unauthorized'))
    }
    const data = await readSpeechResponse(response)
    if (disposed || ticket !== speechEpoch) return
    const target = 'text' in body.value ? 'text' : 'raw_text'
    body.value[target] = [body.value[target], data.text]
      .filter(Boolean)
      .join('\n')
    message.value = '云端转写完成，请核对原文；尚未提取或保存正式记录。'
  } catch (failure) {
    if (!disposed && ticket === speechEpoch)
      error.value = speechErrorMessage(failure)
  } finally {
    clearTimeout(timeout)
    if (ticket === speechEpoch) transcribing.value = false
  }
}
async function uploadAudio(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  try {
    if (file) {
      audioFileName.value = file.name
      await transcribeAudio(file)
    }
  } finally {
    input.value = ''
  }
}
function toggleRecording() {
  error.value = ''
  void voice.toggle()
}
function cancelAudio() {
  speechEpoch++
  voice.cancel()
  transcription?.abort()
  transcribing.value = false
  audioFileName.value = ''
}
onBeforeUnmount(() => {
  disposed = true
  cancelAudio()
  persistForm()
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('storage', checkOtherWindow)
})
async function initializeRecovery() {
  if (!serverMode) return
  ready.value = false
  restoring = true
  selected.value = { ...props.context }
  reviewSource.value = null
  recordHistory.value = null
  historyError.value = ''
  phase.value = 'editing'
  pending.value = undefined
  result.value = null
  reset()
  try {
    let writer = sessionStorage.getItem('hulao:workflow-writer')
    if (!writer) {
      writer = crypto.randomUUID()
      sessionStorage.setItem('hulao:workflow-writer', writer)
    }
    recovery = new WorkflowRecovery(formKey(), localStorage, writer)
    restoreForm()
  } catch (failure) {
    if (!readOnly.value) saveIssue.value = (failure as Error).message
  }
  restoring = false
  ready.value = true
  await loadCatalogs()
}
watch(
  () => [
    props.group,
    JSON.stringify(props.context),
    props.initialAction,
    props.initialMethod,
    props.autoRead,
  ],
  async () => {
    cancelAudio()
    activeId.value = initialOperationId()
    result.value = null
    await initializeRecovery()
    if (props.autoRead && active.value?.method === 'get') await run()
  },
)
watch(
  [params, body],
  () => {
    if (!restoring) {
      confirm.value = false
      persistForm()
    }
  },
  { deep: true, flush: 'sync' },
)
function initialOperationId() {
  if (!props.initialAction && props.autoRead) {
    return allowed.value.find((op) => op.method === 'get')?.id || ''
  }
  return (
    allowed.value.find(
      (op) =>
        props.initialAction &&
        (op.path === props.initialAction ||
          (props.autoRead &&
            op.path.split('/').length ===
              props.initialAction.split('/').length &&
            op.path
              .split('/')
              .every(
                (part, i) =>
                  /^\{[^}]+\}$/.test(part) ||
                  part === props.initialAction.split('/')[i],
              ))) &&
        (props.initialMethod
          ? op.method === props.initialMethod
          : props.autoRead
            ? op.method === 'get'
            : op.method !== 'get'),
    )?.id ||
    allowed.value[0]?.id ||
    ''
  )
}
onMounted(async () => {
  if (!serverMode) return
  activeId.value = initialOperationId()
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('storage', checkOtherWindow)
  await initializeRecovery()
  if (
    (props.autoRead || props.group === 'records') &&
    active.value?.method === 'get'
  )
    await run()
})
</script>
<template>
  <section class="workflow-panel">
    <header class="wf-header">
      <h2 v-if="title">{{ title }}</h2>
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
    <p v-if="!serverMode" class="wf-notice">
      此业务需要服务器测试账号和已授权数据。当前为本机演示，不会发送业务请求或模拟提交成功。
    </p>
    <p v-else-if="!allowed.length" class="wf-muted">当前身份没有此业务入口。</p>
    <template v-else-if="active">
      <div v-if="hasMenu" class="wf-mobile-menu-bar">
        <button
          type="button"
          class="wf-secondary"
          aria-haspopup="dialog"
          @click="openMenu"
        >
          ☰ 功能菜单
        </button>
        <span>{{ activeAreaInfo?.title }}</span>
      </div>
      <div class="wf-workspace" :class="{ 'wf-with-menu': hasMenu }">
        <aside v-if="hasMenu" class="wf-desktop-menu">
          <WorkflowMenu
            :areas="areas"
            :active-area="activeArea"
            :active-id="active.id"
            :records="group === 'records'"
            :disabled="
              busy ||
              recording ||
              recordingLocked ||
              transcribing ||
              phase === 'pending'
            "
            @choose="selectMenu"
          />
        </aside>
        <dialog
          v-if="hasMenu"
          ref="menuDialog"
          class="wf-menu-dialog"
          aria-label="功能菜单"
          @click="$event.target === menuDialog && menuDialog?.close()"
        >
          <header class="wf-menu-dialog-header">
            <strong>功能菜单</strong
            ><button
              type="button"
              class="wf-secondary"
              autofocus
              aria-label="关闭功能菜单"
              @click="menuDialog?.close()"
            >
              关闭
            </button>
          </header>
          <WorkflowMenu
            :areas="areas"
            :active-area="activeArea"
            :active-id="active.id"
            :records="group === 'records'"
            :disabled="
              busy ||
              recording ||
              recordingLocked ||
              transcribing ||
              phase === 'pending'
            "
            @choose="selectMenu"
          />
        </dialog>
        <div class="wf-workspace-content">
          <p v-if="activeAreaInfo?.description" class="wf-muted">
            {{ activeAreaInfo.description }}
          </p>
          <div v-if="recordDetail" class="wf-toolbar wf-context-actions">
            <button
              type="button"
              class="wf-secondary"
              :disabled="busy || phase === 'pending'"
              @click="goRecordOperation('/records')"
            >
              返回记录列表
            </button>
            <button
              v-if="active.path !== '/records/{record_id}/corrections'"
              type="button"
              class="wf-secondary"
              :disabled="busy"
              @click="goRecordOperation('/records/{record_id}/corrections')"
            >
              追加更正
            </button>
            <button
              v-else
              type="button"
              class="wf-secondary"
              :disabled="busy || phase === 'pending'"
              @click="goRecordOperation('/records/{record_id}')"
            >
              查看原记录
            </button>
          </div>
          <div v-if="draftDetail" class="wf-toolbar wf-context-actions">
            <button
              type="button"
              class="wf-secondary"
              :disabled="busy || phase === 'pending'"
              @click="goRecordOperation('/records/drafts')"
            >
              返回草稿列表
            </button>
            <button
              v-if="
                active.path === '/records/drafts/{draft_id}' &&
                (result as Row)?.status === 'pending_review'
              "
              type="button"
              class="wf-secondary"
              :disabled="busy"
              @click="goRecordOperation('/records/drafts/{draft_id}/reject')"
            >
              放弃草稿
            </button>
          </div>
          <p v-if="catalogErrors.length" class="wf-error" role="alert">
            部分目录读取失败：{{ catalogErrors.join('；') }}。可刷新重试。
          </p>
          <p v-if="saveIssue && !readOnly" class="wf-error" role="alert">
            {{ saveIssue }}
            <button
              type="button"
              class="wf-secondary"
              :disabled="busy"
              @click="restoreForm()"
            >
              载入最新本机版本
            </button>
            <button
              type="button"
              class="wf-secondary"
              :disabled="busy"
              @click="persistForm"
            >
              重试本机保存
            </button>
            <button
              type="button"
              class="wf-secondary"
              :disabled="busy"
              @click="downloadJournal"
            >
              导出本窗口恢复日志
            </button>
          </p>
          <p v-else-if="savedAt && !readOnly" class="wf-muted" role="status">
            {{
              phase === 'pending'
                ? '结果待核实，已保留原请求'
                : phase === 'succeeded'
                  ? '服务器已确认，本机回执已保存'
                  : '已保存到本机，尚未提交服务器'
            }}
            · {{ new Date(savedAt).toLocaleString() }}
          </p>
          <p v-if="phase === 'pending'" class="wf-notice" role="alert">
            本次写入结果待核实，不能修改内容或重新创建同一操作。
            <button
              type="button"
              class="wf-secondary"
              :disabled="busy"
              @click="inspectPending"
            >
              核查服务器当前数据
            </button>
            {{
              pending?.retryable
                ? '可使用原请求安全核实，始终复用相同请求编号。'
                : '此接口不支持已确认的幂等重放，请联系主管核对。'
            }}
            <button
              v-if="uncertainExtraction"
              type="button"
              class="wf-secondary"
              :disabled="busy || !!saveIssue"
              @click="fallbackAfterUncertainAI"
            >
              保留待核实AI请求并转人工
            </button>
          </p>
          <p
            v-if="versionIssue && phase === 'editing'"
            class="wf-notice"
            role="alert"
          >
            {{ versionIssue }}
            <button
              type="button"
              class="wf-secondary"
              :disabled="busy || loading"
              @click="acceptCurrentVersions"
            >
              采用当前版本并重新核对
            </button>
          </p>
          <form
            v-if="!incidentDetail"
            ref="businessForm"
            class="wf-form"
            @submit.prevent="run"
          >
            <h3>{{ taskCreation ? '任务内容' : operationTitle(active) }}</h3>
            <div
              v-if="
                group === 'coverage' &&
                active.path === '/insights/coverage/reviews' &&
                coverageContext
              "
              class="wf-toolbar"
            >
              <strong>{{ coverageItemName }}</strong>
              <span
                >{{
                  rowName(
                    catalogs.elders?.find(
                      (row) => row.id === coverageContext?.elder_id,
                    ) || {},
                  )
                }}
                · {{ coverageContext.service_date }}</span
              >
              <button
                type="button"
                class="wf-secondary"
                :disabled="busy || phase === 'pending'"
                @click="returnToCoverage"
              >
                {{
                  phase === 'succeeded'
                    ? '查看更新后的核对结果'
                    : '返回核对结果'
                }}
              </button>
            </div>
            <p v-if="isAdmissionCreate(active)" class="wf-muted">
              新入住：先为老人建档，再选择待入住老人和空闲床位。已在院老人无需重复入住；没有历史入住单时才使用补登记。
              {{
                fieldOptions.bed_id?.length === 0 && params.elder_id
                  ? '当前没有符合条件的床位，可在功能菜单中新建床位。'
                  : ''
              }}
            </p>
            <p
              v-if="
                group === 'incidents' &&
                active.path === '/incidents' &&
                active.method === 'post'
              "
              class="wf-notice wf-urgent-guidance"
              role="note"
            >
              紧急情况先联系现场工作人员和主管，并按机构应急流程处置。填写已知事实和已采取措施后立即上报，系统向管理人员发送紧急通知。
            </p>
            <div
              v-if="recordComposer"
              class="wf-record-modes"
              role="group"
              aria-label="记录方式"
            >
              <button
                type="button"
                :class="[
                  'wf-secondary',
                  { selected: active.path !== '/records/manual' },
                ]"
                :aria-pressed="active.path !== '/records/manual'"
                :disabled="
                  busy || frozen || recording || recordingLocked || transcribing
                "
                @click="switchRecordMode('assisted')"
              >
                整理后核对
              </button>
              <button
                type="button"
                :class="[
                  'wf-secondary',
                  { selected: active.path === '/records/manual' },
                ]"
                :aria-pressed="active.path === '/records/manual'"
                :disabled="
                  busy || frozen || recording || recordingLocked || transcribing
                "
                @click="switchRecordMode('manual')"
              >
                直接填写
              </button>
            </div>
            <p v-if="recordComposer" class="wf-muted">
              {{
                active.path === '/records/manual'
                  ? '直接保存人工填写的内容，无需调用模型。'
                  : '结合当前老人、场景与已确认偏好整理内容，核对后才成为正式记录。'
              }}
            </p>
            <details
              v-if="
                active.path === '/records/{draft_id}/confirm' &&
                (reviewSource || pick('draft_id', params.draft_id))
              "
              class="wf-result-details"
            >
              <summary>查看原文与整理依据</summary>
              <WorkflowResult
                :value="reviewSource || pick('draft_id', params.draft_id)"
              />
            </details>
            <p v-if="isQualityScan(active)" class="wf-muted">
              选择交班单后自动采用其交出班次；更换班次会清除不匹配的交班单。历史已关闭班次也可检查。
            </p>
            <p v-if="quickQualityScan" class="wf-notice">一键检查规则与模型提示。若模型不可用，会明确提示并提供仅运行规则检查的入口；本次未生成的结果不会显示为已通过。</p>
            <p
              v-if="taskCreation && active.path === '/records/manual'"
              class="wf-notice"
            >
              这是旧版任务表单的恢复内容，仍按原记录接口处理。完成核实后，开始新操作可使用独立任务创建入口。
            </p>
            <p v-if="taskCreation" class="wf-notice">
              先选择老人，再核对已有任务，避免重复安排。护理员只能安排给本人；分配他人或调整既有任务由主管办理。截止时间按北京时间输入，请明确核对日期与时刻。执行前提不会因填写此表自动满足。
            </p>
            <p
              v-if="
                group === 'handovers' &&
                active.path === '/handovers' &&
                active.method === 'post'
              "
              class="wf-notice"
            >
              创建后，系统会带入交出班次的记录和未完成任务。需要补充交班注意事项时，打开“人工审核并提交交班”，在补充说明中填写并核对后提交。
            </p>
            <p
              v-if="group === 'handovers' && active.path.endsWith('/submit')"
              class="wf-muted"
            >
              下方“交班注意事项”用于补充需要接班人员关注的内容；提交前请核对系统带入的未完成事项和记录。
            </p>
            <p
              v-if="group === 'tasks' && taskSelectionEnabled"
              class="wf-muted"
            >
              先选择老人，再选择该老人的任务。护理员只会看到本人当前可办理的任务。
            </p>
            <p
              v-if="noWritableShift && active.method !== 'get'"
              class="wf-notice"
            >
              当前没有分配给你的开放班次，请联系主管在班次管理中安排。已关闭或其他人的班次不能用于当班提交。
            </p>
            <p
              v-if="/extract|ai-summary|quality/.test(active.path)"
              class="wf-notice"
            >
              整理结果仅供核对，原文证据会保留。未经人工确认，不会生成正式记录、执行任务或发布交班。
            </p>
            <fieldset
              :disabled="
                busy || frozen || recording || recordingLocked || transcribing
              "
              class="wf-inputs"
            >
              <WorkflowField
                v-if="isAdmissionCreate(active) && bodySchema?.properties?.kind"
                :schema="bodySchema.properties.kind"
                field="kind"
                :model-value="body.kind"
                :catalogs="catalogs"
                @update:model-value="setBody({ ...body, kind: $event })"
              />
              <label v-if="taskSelectionEnabled" class="wf-field">
                <span>先选择老人<b> *</b></span>
                <select
                  :value="selectedTaskElder"
                  @change="
                    chooseTaskElder(($event.target as HTMLSelectElement).value)
                  "
                >
                  <option value="">请选择老人</option>
                  <option
                    v-for="elder in catalogs.elders || []"
                    :key="String(elder.id)"
                    :value="String(elder.id)"
                  >
                    {{ elder.name || elder.display_name || '老人'
                    }}{{ elder.bed_label ? ' · ' + elder.bed_label : '' }}
                  </option>
                </select>
              </label>
              <WorkflowField
                v-for="param in visibleParameters"
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
                v-if="taskCreation && bodySchema?.properties?.elder_id"
                :schema="bodySchema.properties.elder_id"
                field="elder_id"
                path="填写办理内容.elder_id"
                :required="true"
                :model-value="body.elder_id"
                :catalogs="catalogs"
                @update:model-value="setBody({ ...body, elder_id: $event })"
              />
              <TaskCreationContext
                v-if="taskCreation"
                :elder-id="String(body.elder_id || '')"
                :tasks="catalogs.tasks || []"
                :available="!!catalogs.tasks"
              />
              <WorkflowField
                v-if="visibleBodySchema && (!taskCreation || !!body.elder_id)"
                :schema="visibleBodySchema"
                field="填写办理内容"
                :model-value="body"
                :catalogs="catalogs"
                :option-overrides="fieldOptions"
                @update:model-value="setBody"
              />
              <section v-if="taskSourcePreview" aria-label="所选来源记录">
                <h4>来源记录当前内容 · 第{{ taskSourcePreview.revision }}版</h4>
                <p class="wf-notice">
                  来源事实不等于本次安排已经执行；请据此人工核对任务内容、期限与执行前提。
                </p>
                <p>当前已核对观察</p>
                <ul v-if="Array.isArray(taskSourcePreview.observations)">
                  <li
                    v-for="(
                      observation, index
                    ) in taskSourcePreview.observations"
                    :key="index"
                  >
                    {{ observation }}
                  </li>
                </ul>
                <details>
                  <summary>原始录入（保留原文）</summary>
                  <blockquote class="wf-source-text">
                    {{ taskSourcePreview.raw_text }}
                  </blockquote>
                </details>
                <p
                  v-if="
                    taskSourcePreview.revision !== Number(body.source_revision)
                  "
                  role="alert"
                >
                  来源已更正，当前表单仍保留原版本，不能直接提交。请重新选择来源并核对差异。
                </p>
              </section>
              <TaskFeedbackComposer
                v-if="active.path === '/tasks/{task_id}/complete'"
                :model-value="body"
                @update:model-value="setBody"
              />
              <RecordTaskReview
                v-if="recordTaskReview"
                :model-value="body.task_candidates || []"
                :elder-name="reviewElderName"
                :owners="reviewOwners"
                @update:model-value="setRecordTasks"
              />
            </fieldset>
            <ServiceCareHints
              v-if="
                recordComposer && active.path === '/records/context-extract'
              "
              :elder-id="String(body.elder_id || '')"
              :scene="String(body.scene || '')"
            />
            <PhotoObservation
              v-if="recordComposer"
              :elder-id="String(body.elder_id || '')"
              :attachment-id="
                typeof props.context?.attachment_id === 'string'
                  ? props.context.attachment_id
                  : undefined
              "
              :analysis-id="
                typeof props.context?.analysis_id === 'string'
                  ? props.context.analysis_id
                  : undefined
              "
            />
            <div
              v-if="
                active.method !== 'get' &&
                ('text' in body || 'raw_text' in body)
              "
              class="wf-toolbar wf-audio-actions"
            >
              <button
                type="button"
                class="wf-secondary"
                :disabled="busy || frozen || transcribing || recordingLocked"
                @click="toggleRecording"
              >
                {{
                  starting
                    ? '正在打开麦克风…'
                    : recording
                      ? `停止录音（${seconds}秒）`
                      : transcribing || finishing
                        ? '云端转写中…'
                        : '开始录音'
                }}</button
              ><button
                type="button"
                class="wf-secondary"
                :disabled="
                  busy || frozen || recording || recordingLocked || transcribing
                "
                @click="audioInput?.click()"
              >
                上传录音
              </button>
              <input
                ref="audioInput"
                class="wf-audio-file-input"
                aria-label="上传录音"
                type="file"
                accept="audio/*"
                :disabled="
                  busy || frozen || recording || recordingLocked || transcribing
                "
                @change="uploadAudio"
              />
              <span
                v-if="audioFileName"
                class="wf-audio-file-name"
                :title="audioFileName"
                >{{ audioFileName }}</span
              >
              <span class="wf-muted">最多60秒，转写后可编辑，不自动保存。</span>
            </div>
            <p v-if="confirm" class="wf-notice">
              {{
                feedback.assisted
                  ? '确认后整理为待核对草稿，不会直接保存正式记录。'
                  : '请核对以上内容，确认后保存到服务器。'
              }}{{
                active.path.includes('/confirm')
                  ? '待办候选将随正式记录生成任务。'
                  : ''
              }}
            </p>
            <p v-if="busy" class="wf-notice" role="status">
              {{ feedback.waiting }}
            </p>
            <p
              v-else-if="loading && phase === 'succeeded'"
              class="wf-muted"
              role="status"
            >
              本次操作已完成，正在后台更新列表。
            </p>
            <div class="wf-toolbar">
              <button
                type="submit"
                class="wf-primary"
                :disabled="
                  busy ||
                  loading ||
                  (!readOnly && !!saveIssue) ||
                  (phase === 'succeeded' && !quickQualityScan) ||
                  (phase === 'pending' && !pending?.retryable) ||
                  recording ||
                  transcribing
                "
              >
                {{
                  busy
                    ? feedback.button
                    : phase === 'pending'
                      ? '使用原请求核实结果'
                      : phase === 'succeeded'
                        ? quickQualityScan ? '再次检查' : '本次操作已完成'
                        : confirm
                          ? recordTaskReview
                            ? recordTaskCount
                              ? `保存记录并创建${recordTaskCount}项任务`
                              : '仅保存记录'
                            : '确认提交'
                          : quickQualityScan
                            ? '开始检查'
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
                :disabled="
                  busy ||
                  phase === 'pending' ||
                  (!readOnly && !!saveIssue) ||
                  recording ||
                  transcribing
                "
                @click="freshForm"
              >
                {{ quickQualityScan && phase === 'succeeded' ? '调整范围，再次检查' : recordComposer ? '开始新记录' : '清空表单，开始新操作' }}
              </button>
            </div>
          </form>
          <p v-if="error" class="wf-error" role="alert">{{ error }}</p>
          <p v-if="message && !incidentDetail" class="wf-success" role="status">
            {{ message }}
          </p>
          <button v-if="quickQualityScan && modelUnavailable && phase === 'editing'" type="button" class="wf-secondary" :disabled="busy || loading" @click="body.include_ai = false; modelUnavailable = false; run()">模型未运行，仅重新检查规则</button>
          <section
            v-if="focused && result !== null && group !== 'incidents'"
            class="wf-results"
            aria-label="本次办理结果"
          >
            <p>
              {{
                active.method === 'get'
                  ? '已读取当前进展，请按上方事项提示继续办理。'
                  : '本次办理已保存，后续事项仍按流程继续。'
              }}
            </p>
          </section>
          <section v-else-if="result !== null" class="wf-results">
            <div
              v-if="incidentButtons.length"
              class="wf-toolbar"
              aria-label="事件后续操作"
            >
              <button
                v-for="op in incidentButtons"
                :key="op.id"
                type="button"
                :disabled="busy"
                @click="goIncidentAction(op)"
              >
                {{ operationTitle(op) }}
              </button>
            </div>
            <h3>
              {{
                group === 'records'
                  ? recordComposer && active.path !== '/records/manual'
                    ? '整理结果与原文依据'
                    : '记录内容与依据'
                  : '办理结果与原文依据'
              }}
            </h3>
            <div class="wf-toolbar">
              <button
                v-if="
                  (result as Row)?.generation_kind &&
                  (result as Row)?.status === 'pending_review'
                "
                class="wf-primary"
                type="button"
                :disabled="busy"
                @click="useDraft"
              >
                核对并保存记录</button
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
            <article v-if="incidentDetail" class="wf-incident-detail">
              <h3>
                {{
                  rowName(
                    catalogs.elders?.find(
                      (row) => row.id === incidentDetail?.elder_id,
                    ) || {},
                  )
                }}
                · {{ display(incidentDetail.status, 'status') }}
              </h3>
              <p>
                发生时间：{{
                  display(incidentDetail.occurred_at, 'occurred_at')
                }}
              </p>
              <h4>现场情况</h4>
              <p class="wf-incident-facts">{{ incidentDetail.description }}</p>
              <h4>已采取措施</h4>
              <p class="wf-incident-facts">
                {{ incidentDetail.immediate_action }}
              </p>
              <p>
                人工分级：{{
                  incidentDetail.severity
                    ? display(incidentDetail.severity, 'severity')
                    : '待管理人员核实分级'
                }}
              </p>
              <details>
                <summary>查看完整事件、证据与整改记录</summary>
                <WorkflowResult :value="result" :catalogs="catalogs" />
              </details>
            </article>
            <RecordResults
              v-else-if="group === 'records'"
              :value="result"
              :catalogs="catalogs"
              @select="selectResult"
            />
            <WorkflowResult
              v-else
              :value="result"
              :catalogs="catalogs"
              @select="selectResult"
            />
          </section>
          <section
            v-if="recordDetail && (recordHistory !== null || historyError)"
            class="wf-record-history"
          >
            <details :open="!!historyError">
              <summary>更正历史</summary>
              <p class="wf-muted">
                原记录及历次更正保留，可在这里核对变更依据。
              </p>
              <p v-if="historyError" class="wf-error" role="alert">
                {{ historyError
                }}<button
                  type="button"
                  class="wf-secondary"
                  :disabled="busy"
                  @click="loadRecordHistory(String(params.record_id || ''))"
                >
                  重试读取历史
                </button>
              </p>
              <WorkflowResult v-else :value="recordHistory" />
            </details>
          </section>
        </div>
      </div>
    </template>
  </section>
</template>
<style scoped>
.wf-incident-detail {
  border: 1px solid #f3a59b;
  border-left: 4px solid #b42318;
  background: #fff8f6;
  border-radius: 8px;
  padding: 18px;
  line-height: 1.7;
}
.wf-incident-detail h3,
.wf-incident-detail h4 {
  color: #7a271a;
  margin: 0 0 8px;
}
.wf-incident-facts {
  white-space: pre-wrap;
  margin: 0 0 18px;
}
.wf-incident-detail summary {
  cursor: pointer;
  padding-block: 10px;
}
.wf-urgent-guidance {
  border-left: 4px solid #b42318;
  padding: 12px 16px;
  background: #fff1ef;
  color: #7a271a;
  line-height: 1.7;
}
.wf-audio-actions {
  position: relative;
}
.wf-audio-actions > * {
  min-width: 0;
  max-width: 100%;
}
@media (max-width: 560px) {
  .wf-audio-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .wf-audio-actions button {
    width: 100%;
    box-sizing: border-box;
  }
}
.wf-audio-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
.wf-audio-file-name {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.wf-source-text {
  margin: 8px 0;
  padding: 12px;
  border-left: 3px solid #14765e;
  background: #f5f7f8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
