<script setup lang="ts">
import { computed, ref, shallowRef, triggerRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { formatBusinessTime, readSession } from '@hulao/shared'
import WorkflowPanel from '@hulao/shared/workflow'
import type { DemoPlan } from '../../../../../packages/shared/src/demo'
import { loadDemoState, updateDemoState } from '../../../../../packages/shared/src/demo-store'
import { confirmDemoPlan, DemoPlanStateChanged, type DemoPlanConfirmation, type DemoPlanReceipt } from '../../../../../packages/shared/src/demo-plan-actions'
import { listAll, request, display, type Row } from '../../../../../packages/shared/src/workflow/model'
import { validateCatalog } from '../../../../../packages/shared/src/workflow/catalogs'
import { WorkflowRecovery, recoveryKey, withSubmissionLock } from '../../../../../packages/shared/src/workflow/recovery'
import { businessDate, newPlanItem, newPlanExecution, planStepLabels, preparePlan, restorePlanExecution, runPlanExecution, selectPlanElder, usableAssessments, type PlanDraft, type PlanExecution, type PlanOccurrence } from '../../../../../packages/shared/src/workflow/plan-flow'
import { mode, queryKey, useElders } from '../../services/data'

const route = useRoute()
const router = useRouter()
const elders = useElders()
const demo = useQuery({ queryKey: computed(() => queryKey('plan-demo')), queryFn: loadDemoState, enabled: mode === 'demo' })
const elderId = ref('')
const elder = computed(() => elders.data.value?.find(row => row.id === elderId.value))
const management = computed(() => ['admin', 'supervisor'].includes(readSession()?.role || ''))
const step = ref(0)
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const storageError = ref('')
const listError = ref('')
const showAssessment = ref(false)
const assessmentSummary = ref('')
const assessmentKey = crypto.randomUUID()
const confirmed = ref(false)
const assessments = ref<Row[]>([])
const plans = ref<Row[]>([])
const shifts = ref<Row[]>([])
const staff = ref<Row[]>([])
const assessmentId = ref('')
const sourcePlanId = ref('')
const demoItems = ref<DemoPlan['items']>([])
const preview = ref<PlanOccurrence[]>([])
const apiPreview = shallowRef<ReturnType<typeof preparePlan>>()
const apiExecution = shallowRef<PlanExecution>()
const demoSubmission = shallowRef<DemoPlanConfirmation>()
const demoReceipt = shallowRef<DemoPlanReceipt>()
const demoPreviewBasis = shallowRef<{ epoch: string; revision: number }>()
const demoConflict = ref(false)
let journal: WorkflowRecovery | undefined
let loadSequence = 0
const today = businessDate()
function emptyDraft(): PlanDraft {
  return { title: '', goal: '', startsOn: today, endsOn: today, serviceDate: today, shiftId: '', assignedTo: '', reason: '', items: [newPlanItem('item_' + crypto.randomUUID().replaceAll('-', ''))] }
}
const draft = ref<PlanDraft>(emptyDraft())
const frozen = computed(() => !!apiExecution.value || !!demoSubmission.value)
const complete = computed(() => !!demoReceipt.value || !!apiExecution.value?.steps.every(row => row.receipt !== undefined))
const effectiveAssessments = computed(() => usableAssessments(assessments.value, elderId.value))
const demoAssessments = computed(() => demo.data.value?.assessments.filter(row => row.elderId === elderId.value && row.status === 'valid') || [])
const demoPlans = computed(() => demo.data.value?.plans.filter(row => row.elderId === elderId.value && row.status === 'active') || [])
const planMemories = computed(() => demo.data.value?.memories.filter(memory => memory.elderId === elderId.value && memory.status === 'confirmed' && (memory.kind !== 'temporary' || (memory.expiresAt && Date.parse(memory.expiresAt) > Date.now()))) || [])
const assessmentReady = computed(() => mode === 'demo' ? demoAssessments.value.some(row => row.id === assessmentId.value) : effectiveAssessments.value.some(row => row.id === assessmentId.value))
const owners = computed(() => {
  const shift = shifts.value.find(row => row.id === draft.value.shiftId)
  return staff.value.filter(row => row.active !== false && Array.isArray(shift?.caregiver_ids) && shift.caregiver_ids.includes(row.id))
})
const demoOwners = computed(() => [...new Set((demo.data.value?.tasks || []).map(row => row.assignee).filter(Boolean))])
const demoShifts = computed(() => [...new Set((demo.data.value?.tasks || []).map(row => row.shiftName || row.shift).filter(Boolean))])
const previewOwner = computed(() => staff.value.find(row => row.id === (apiExecution.value?.generate.assigned_to || draft.value.assignedTo))?.display_name || '已核对责任人')
const previewShift = computed(() => shifts.value.find(row => row.id === (apiExecution.value?.generate.shift_id || draft.value.shiftId))?.name || '已核对班次')
const previewDemoItems = computed(() => demoSubmission.value?.items || demoItems.value)
const context = computed(() => route.query.elder ?? route.query.elder_id)
const time = (value: unknown) => formatBusinessTime(String(value), true)
const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : '操作未完成，请保留本页内容后重试。'

watch([() => elders.data.value, context], ([rows]) => {
  if (busy.value || !rows) return
  if (!frozen.value) elderId.value = selectPlanElder(context.value, rows)
}, { immediate: true })
watch(elderId, () => {
  step.value = 0
  error.value = storageError.value = listError.value = ''
  confirmed.value = showAssessment.value = false
  assessmentId.value = sourcePlanId.value = ''
  draft.value = emptyDraft()
  demoItems.value = []
  preview.value = []
  apiPreview.value = undefined
  apiExecution.value = undefined
  demoSubmission.value = undefined
  demoReceipt.value = undefined
  demoPreviewBasis.value = undefined
  demoConflict.value = false
  journal = undefined
  if (!elderId.value) return
  try {
    const actor = readSession()
    if (!actor?.accountKey) throw new Error('请先登录。')
    journal = new WorkflowRecovery(recoveryKey(actor.accountKey, `care-plan-guide:${mode}`, { elder_id: elderId.value }), localStorage, crypto.randomUUID())
    const saved = journal.restore()
    if (saved) {
      if (saved.body.editing && saved.body.kind === mode) {
        draft.value = saved.body.draft as PlanDraft
        demoItems.value = saved.body.demoItems as DemoPlan['items'] || []
        assessmentId.value = String(saved.body.assessmentId || '')
        sourcePlanId.value = String(saved.body.sourcePlanId || '')
        assessmentSummary.value = String(saved.body.assessmentSummary || '')
        step.value = Number(saved.body.step) === 1 ? 1 : 0
      } else if (saved.body.kind === 'api' && mode === 'api') {
        apiExecution.value = restorePlanExecution(saved.body.execution, actor.accountKey, elderId.value)
        preview.value = saved.body.preview as PlanOccurrence[]
      } else if (saved.body.kind === 'demo' && mode === 'demo') {
        if (!saved.body.needsReview) {
          const input = saved.body.input as DemoPlanConfirmation
          if (!input || input.elderId !== elderId.value || !input.operationKey || !Array.isArray(input.items)) throw new Error('计划恢复日志不完整，请保留日志核实。')
          demoSubmission.value = input
          demoReceipt.value = saved.body.receipt as DemoPlanReceipt | undefined
        }
      } else throw new Error('计划恢复日志模式不匹配，请保留日志核实。')
      if (frozen.value) step.value = 2
    }
  } catch (failure) { storageError.value = failureMessage(failure) }
  void reload()
}, { immediate: true })
watch(() => draft.value.shiftId, () => {
  if (!owners.value.some(row => row.id === draft.value.assignedTo)) draft.value.assignedTo = owners.value.length === 1 ? String(owners.value[0].id) : ''
})
watch([demoAssessments, effectiveAssessments], () => {
  if (frozen.value) return
  const available = mode === 'demo' ? demoAssessments.value : effectiveAssessments.value
  if (!available.some(row => row.id === assessmentId.value)) assessmentId.value = available.length === 1 ? String(available[0].id) : ''
}, { immediate: true })
watch(demoPlans, rows => {
  if (mode === 'demo' && !frozen.value && rows.length === 1 && !demoItems.value.length) copyDemoPlan(rows[0].id)
}, { immediate: true })

async function reload() {
  const sequence = ++loadSequence
  const selected = elderId.value
  if (!selected) return
  loading.value = true
  listError.value = ''
  if (mode === 'demo') {
    const result = await demo.refetch()
    if (result.error) listError.value = failureMessage(result.error)
    loading.value = false
    return
  }
  assessments.value = []; plans.value = []; shifts.value = []; staff.value = []
  const catalogs = [
    { name: '评估', path: `/assessments?elder_id=${encodeURIComponent(selected)}`, target: assessments, resource: 'assessments', allowed: management.value },
    { name: '计划', path: `/care-plans?elder_id=${encodeURIComponent(selected)}`, target: plans, resource: 'plans', allowed: true },
    { name: '班次', path: '/shifts', target: shifts, resource: 'shifts', allowed: management.value },
    { name: '责任人', path: '/staff', target: staff, resource: 'staff', allowed: management.value },
  ].filter(row => row.allowed)
  const results = await Promise.allSettled(catalogs.map(async catalog => validateCatalog(catalog.resource, await listAll(catalog.path))))
  if (sequence !== loadSequence || selected !== elderId.value) return
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') catalogs[index].target.value = result.value
    else listError.value += `${catalogs[index].name}读取失败：${failureMessage(result.reason)} `
  })
  loading.value = false
}
function copyDemoPlan(id: string) {
  if (frozen.value) return
  sourcePlanId.value = id
  const plan = demoPlans.value.find(row => row.id === id)
  if (!plan) return
  demoItems.value = plan.items.map(item => ({ ...item }))
  if (demoAssessments.value.some(row => row.id === plan.assessmentId)) assessmentId.value = plan.assessmentId
}
function addDemoItem() {
  demoItems.value.push({ title: '', executionAt: `${today}T15:00:00+08:00`, deadlineAt: `${today}T16:00:00+08:00`, assignee: '', shiftName: '' }); saveDraft()
}
function addApiItem() {
  draft.value.items.push(newPlanItem('item_' + crypto.randomUUID().replaceAll('-', ''))); saveDraft()
}
function localClock(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.valueOf()) ? new Date(date.valueOf() + 8 * 3600000).toISOString().slice(0, 16) : ''
}
function changeDemoTime(index: number, field: 'executionAt' | 'deadlineAt', event: Event) {
  const value = (event.target as HTMLInputElement).value
  demoItems.value[index][field] = value ? `${value}:00+08:00` : ''
}
function next() {
  error.value = ''
  try {
    if (!elder.value || elder.value.status !== '入住') throw new Error('请先选择当前入住老人。')
    if (!management.value) throw new Error('照护计划须由主管或管理员人工确认。')
    if (!assessmentReady.value) throw new Error('缺少有效且已确认评估，请先在本页办理评估。')
    if (listError.value || loading.value) throw new Error('请先重新载入完整资料。')
    if (step.value === 0) {
      if (mode === 'api' && !draft.value.title) draft.value.title = `${elder.value.name}照护计划`
      step.value = 1
      return
    }
    if (mode === 'api') {
      apiPreview.value = preparePlan(elderId.value, effectiveAssessments.value.find(row => row.id === assessmentId.value), draft.value, shifts.value, staff.value)
      preview.value = apiPreview.value.occurrences
    } else {
      // Validation also runs inside the atomic confirmation. Build a preview
      // without mutating the store or assigning successful state.
      if (!demoItems.value.length || demoItems.value.some(item => !item.title.trim() || !item.assignee.trim() || !item.shiftName.trim() || !Number.isFinite(Date.parse(item.executionAt)) || !Number.isFinite(Date.parse(item.deadlineAt)) || Date.parse(item.deadlineAt) <= Date.parse(item.executionAt)))
        throw new Error('请补全事项、有效时间、责任人与班次，截止时间须晚于执行时间。')
      const state = demo.data.value
      if (!state) throw new Error('演示资料未载入。')
      if (demoItems.value.some(item => state.tasks.some(task => task.elderId === elderId.value && task.status !== 'cancelled' && task.title.trim() === item.title.trim() && Date.parse(task.executionAt || task.dueAt) === Date.parse(item.executionAt))))
        throw new Error('已有相同事项与执行时间的任务，请调整安排，避免重复派发。')
      demoPreviewBasis.value = { epoch: state.epoch, revision: state.revision }
    }
    confirmed.value = false
    step.value = 2
  } catch (failure) { error.value = failureMessage(failure) }
}
function saveDraft() {
  if (!journal || frozen.value || busy.value) return
  try { journal.save({ operation: 'care-plan-guide', params: { elder_id: elderId.value }, body: { kind: mode, editing: true, draft: draft.value, demoItems: demoItems.value, assessmentId: assessmentId.value, sourcePlanId: sourcePlanId.value, assessmentSummary: assessmentSummary.value, step: step.value }, phase: 'editing' }); storageError.value = '' }
  catch (failure) { storageError.value = failureMessage(failure) }
}
async function saveAssessment() {
  if (mode !== 'demo' || !management.value || busy.value || !assessmentSummary.value.trim() || !demo.data.value) return
  busy.value = true; error.value = ''
  const actor = readSession(), epoch = demo.data.value.epoch, selected = elderId.value, summary = assessmentSummary.value.trim()
  try {
    await updateDemoState(epoch, state => {
      const current = readSession()
      if (current?.mode !== 'demo' || current.accountKey !== actor?.accountKey || !['admin', 'supervisor'].includes(current.role || '')) throw new Error('身份已变化，请重新办理评估')
      if (!state.elders.some(row => row.id === selected)) throw new Error('老人已变化，请重新核对')
      const id = `assessment-${assessmentKey}`
      const existing = state.assessments.find(row => row.id === id)
      if (existing && (existing.elderId !== selected || existing.summary !== `人工演示评估：${summary}`)) throw new Error('评估请求内容已变化，请核实原请求')
      if (!existing) state.assessments.push({ id, elderId: selected, status: 'valid', assessedAt: new Date().toISOString(), summary: `人工演示评估：${summary}` })
      assessmentId.value = id
    })
    await reload(); showAssessment.value = false
  } catch (failure) { error.value = failureMessage(failure) }
  finally { busy.value = false; saveDraft() }
}
function persist() {
  if (!journal) throw new Error('恢复日志未就绪，请保留页面并重新载入。')
  const tx = apiExecution.value
  const input = demoSubmission.value
  const key = tx?.steps.find(row => row.receipt === undefined)?.key || tx?.steps[0].key || input?.operationKey || ''
  journal.save({ operation: 'care-plan-guide', params: { elder_id: elderId.value },
    body: tx ? { kind: 'api', execution: tx, preview: preview.value } : { kind: 'demo', input, receipt: demoReceipt.value },
    phase: demoReceipt.value || tx?.steps.every(row => row.receipt !== undefined) ? 'succeeded' : 'pending',
    pending: { signature: key, key, path: '/care-plans', method: 'post', payload: tx || input },
  })
  triggerRef(apiExecution)
}
async function execute() {
  if (busy.value || complete.value) return
  error.value = ''
  try {
    if (storageError.value) throw new Error(storageError.value)
    if (!management.value || !confirmed.value) throw new Error('请由主管或管理员逐项核对并勾选人工确认。')
    const actor = readSession()
    if (!journal || !actor || actor.mode !== mode) throw new Error('登录身份或恢复日志已变化，请重新载入。')
    busy.value = true
    await withSubmissionLock(journal.key, async () => {
      if (!journal?.isCurrent()) throw new Error('其他窗口已办理此计划，请重新载入核对。')
      if (mode === 'api') {
        if (!apiExecution.value) {
          if (!apiPreview.value) throw new Error('请重新预览照护安排。')
          apiExecution.value = newPlanExecution(actor.accountKey, apiPreview.value, () => crypto.randomUUID())
        }
        await runPlanExecution(apiExecution.value, async (path, payload, key) => {
          const current = readSession()
          if (current?.accountKey !== actor.accountKey || current.mode !== actor.mode || current.accessToken !== actor.accessToken || !['admin', 'supervisor'].includes(current.role || ''))
            throw new Error('登录身份已变化，已停止后续步骤，请重新登录核实。')
          return request(path, 'post', payload, key)
        }, persist)
        triggerRef(apiExecution)
      } else {
        if (!demoSubmission.value) {
          const basis = demoPreviewBasis.value
          if (!basis) throw new Error('请重新预览演示安排。')
          demoSubmission.value = { epoch: basis.epoch, expectedRevision: basis.revision, operationKey: crypto.randomUUID(), elderId: elderId.value, assessmentId: assessmentId.value, items: demoItems.value.map(item => ({ ...item })), humanConfirmed: true }
        }
        persist()
        demoReceipt.value = await confirmDemoPlan(demoSubmission.value)
        persist()
      }
    })
    await reload()
  } catch (failure) {
    error.value = failureMessage(failure)
    if (failure instanceof DemoPlanStateChanged) demoConflict.value = true
  }
  finally { busy.value = false; triggerRef(apiExecution) }
}
async function reviewDemoAgain() {
  if (!demoConflict.value || !journal || busy.value) return
  try {
    // This action is offered only for a definite pre-write epoch/revision
    // conflict, never for an uncertain request or a partially completed API flow.
    journal.save({ operation: 'care-plan-guide', params: { elder_id: elderId.value }, body: { kind: 'demo', needsReview: true }, phase: 'editing' })
    demoSubmission.value = demoReceipt.value = undefined
    demoConflict.value = confirmed.value = false
    step.value = 0
    error.value = ''
    await reload()
  } catch (failure) { error.value = failureMessage(failure) }
}
function chooseElder(event: Event) {
  if (busy.value || frozen.value) return
  saveDraft()
  const value = (event.target as HTMLSelectElement).value
  void router.replace({ query: { ...route.query, elder: value || undefined, elder_id: undefined } })
  elderId.value = value
}
onBeforeRouteLeave(() => { if (busy.value) return false; saveDraft(); return !storageError.value || window.confirm('计划输入未保存，仍然离开？') })
onBeforeRouteUpdate(() => { if (busy.value) return false; saveDraft(); return !storageError.value || window.confirm('计划输入未保存，仍然切换？') })
</script>
<template>
  <section class="care-plan-page" @input="saveDraft" @change="saveDraft">
    <div class="page-title-row"><div><h1>照护计划</h1><p class="muted">查看老人情况，核对安排，人工确认后生成待执行任务。</p></div></div>
    <ol class="plan-steps" aria-label="照护计划办理步骤"><li v-for="(title, index) in ['查看老人情况', '核对事项、时间与责任人', '预览并人工确认']" :key="title" :aria-current="step === index ? 'step' : undefined" :class="{ current: step === index }"><span>{{ index + 1 }}</span>{{ title }}</li></ol>
    <label class="plan-field">照护老人<select :value="elderId" :disabled="busy || frozen" @change="chooseElder"><option value="">请选择老人</option><option v-for="row in elders.data.value || []" :key="row.id" :value="row.id">{{ row.name }} · {{ row.bedLabel }}</option></select></label>
    <p v-if="elders.isPending.value">正在读取老人档案…</p>
    <p v-if="context && !elder" role="alert">未找到传入的老人，请重新选择照护对象。</p>
    <p v-if="elders.error.value" role="alert">老人档案读取失败。<button type="button" @click="elders.refetch()">重新读取</button></p>
    <p v-if="!management" role="status">请由主管或管理员办理计划审批与任务生成。</p>
    <p v-if="error || storageError" class="plan-error" role="alert">{{ storageError || error }}</p>
    <p v-if="listError" class="plan-error" role="alert">{{ listError }}<button type="button" :disabled="busy || loading" @click="reload">重新载入资料</button></p>
    <p v-if="loading" role="status">正在读取评估与计划…</p>

    <template v-if="elder">
      <section class="plan-card" aria-label="老人照护背景">
        <h2>{{ elder.name }} <small>{{ elder.bedLabel }} · {{ elder.status }}</small></h2>
        <p v-if="elder.notes">{{ elder.notes }}</p>
        <dl class="plan-facts"><div><dt>年龄</dt><dd>{{ elder.age === undefined ? '未提供' : elder.age + '岁' }}</dd></div><div><dt>风险</dt><dd>{{ elder.risk || '待核实' }}</dd></div></dl>
        <details v-if="elder.preferences"><summary>生活习惯与近期变化</summary><p v-for="(item, index) in [...elder.preferences.habits, ...elder.preferences.activities, ...elder.preferences.communication, ...elder.preferences.recentChanges, ...elder.preferences.attention]" :key="index">{{ item }}</p></details>
      </section>

      <section v-if="step === 0" class="plan-card" aria-labelledby="plan-assessment-title">
        <h2 id="plan-assessment-title">查看评估与既有安排</h2>
        <label class="plan-field">采用评估<select v-model="assessmentId" :disabled="loading || frozen"><option value="">请选择有效评估</option><template v-if="mode === 'demo'"><option v-for="row in demoAssessments" :key="row.id" :value="row.id">{{ time(row.assessedAt) }} · {{ row.summary }}</option></template><template v-else><option v-for="row in effectiveAssessments" :key="String(row.id)" :value="String(row.id)">{{ time(row.assessed_at) }} · {{ row.care_level_label || '已确认评估' }} · {{ row.total_score ?? '评分未提供' }}</option></template></select></label>
        <p v-if="!assessmentReady && !loading">当前老人缺少可用的已确认评估，请先办理评估。</p>
        <button v-if="management" type="button" @click="showAssessment = !showAssessment">{{ showAssessment ? '收起评估办理' : '在本页办理／核对评估' }}</button>
        <section v-if="showAssessment" class="assessment-entry"><h3>为{{ elder.name }}办理评估</h3><template v-if="mode === 'demo'"><label class="plan-field">人工评估摘要<textarea v-model="assessmentSummary" :disabled="busy" /></label><p>仅用于演示流程。请记录已知情况，未知评估题目须由专业人员核对。</p><button type="button" :disabled="busy || !assessmentSummary.trim()" @click="saveAssessment">保存演示评估并继续</button></template><WorkflowPanel v-else :key="elderId" group="assessments" :context="{ elder_id: elderId }" initial-action="/assessments" @changed="reload" /></section>
        <template v-if="mode === 'demo'"><label v-if="demoPlans.length" class="plan-field">参考已有计划<select :value="sourcePlanId" @change="copyDemoPlan(($event.target as HTMLSelectElement).value)"><option value="">请选择参考计划</option><option v-for="(row, index) in demoPlans" :key="row.id" :value="row.id">计划{{ index + 1 }} · {{ row.items.length }}项 · {{ time(row.confirmedAt) }}</option></select></label><p v-if="sourcePlanId">确认时将保存本次核对的计划和待执行任务。</p></template>
        <template v-else><p v-if="!plans.length && !loading">暂无既有照护计划。</p><details v-for="row in plans" :key="String(row.id)"><summary>{{ row.title || '既有计划' }} · {{ display(row.status) }}</summary><p>{{ row.goal }}</p><p>{{ row.starts_on }} 至 {{ row.ends_on }}</p></details></template>
        <button class="plan-primary" type="button" :disabled="!assessmentReady || loading || !!listError || !management || !!storageError" @click="next">下一步：核对照护安排</button>
      </section>

      <section v-if="step === 1" class="plan-card" aria-labelledby="plan-items-title">
        <h2 id="plan-items-title">核对事项、时间与责任人</h2><section v-if="mode === 'demo'" aria-label="已确认照护依据"><h3>已确认习惯与本次意愿</h3><p v-for="memory in planMemories" :key="memory.id">{{ memory.content }}<span v-if="memory.kind === 'temporary'">（临时意愿）</span></p><p v-if="!planMemories.length">暂无适用的已确认信息，安排前请询问本人。</p></section>
        <template v-if="mode === 'demo'">
          <article v-for="(item, index) in demoItems" :key="index" class="plan-item"><h3>照护事项{{ index + 1 }}</h3><label class="plan-field">事项<input v-model="item.title" maxlength="300" /></label><div class="plan-grid"><label class="plan-field">执行时间（北京时间）<input type="datetime-local" :value="localClock(item.executionAt)" @input="changeDemoTime(index, 'executionAt', $event)" /></label><label class="plan-field">截止时间（北京时间）<input type="datetime-local" :value="localClock(item.deadlineAt)" @input="changeDemoTime(index, 'deadlineAt', $event)" /></label><label class="plan-field">责任人<select v-model="item.assignee"><option value="">请选择责任人</option><option v-for="name in demoOwners" :key="name">{{ name }}</option></select></label><label class="plan-field">班次<select v-model="item.shiftName"><option value="">请选择班次</option><option v-for="name in demoShifts" :key="name">{{ name }}</option></select></label></div><button type="button" @click="demoItems.splice(index, 1); saveDraft()">移除此项</button></article>
          <button type="button" @click="addDemoItem">增加照护事项</button>
        </template>
        <template v-else>
          <label class="plan-field">计划名称<input v-model="draft.title" maxlength="200" /></label><label class="plan-field">照护目标<textarea v-model="draft.goal" maxlength="2000" /></label>
          <div class="plan-grid"><label class="plan-field">生效日期<input v-model="draft.startsOn" type="date" /></label><label class="plan-field">结束日期<input v-model="draft.endsOn" type="date" /></label></div>
          <article v-for="(item, index) in draft.items" :key="item.key" class="plan-item"><h3>照护事项{{ index + 1 }}</h3><label class="plan-field">事项<input v-model="item.title" maxlength="300" /></label><label class="plan-field">服务要求<textarea v-model="item.instruction" maxlength="1500" /></label><div class="plan-grid"><label class="plan-field">服务场景<select v-model="item.scene"><option v-for="scene in ['bathing', 'dining', 'activity', 'communication', 'rest', 'other']" :key="scene" :value="scene">{{ display(scene) }}</option></select></label><label class="plan-field">执行窗口（分钟）<input v-model.number="item.window_minutes" type="number" min="1" max="240" /></label></div><div v-for="(_, timeIndex) in item.times" :key="timeIndex" class="plan-time"><label class="plan-field">每日执行时间（北京时间）<input v-model="item.times[timeIndex]" type="time" /></label><button v-if="item.times.length > 1" type="button" @click="item.times.splice(timeIndex, 1); saveDraft()">移除时段</button></div><button v-if="item.times.length < 6" type="button" @click="item.times.push(''); saveDraft()">增加时段</button><fieldset class="plan-weekdays"><legend>每周执行日</legend><label v-for="(day, dayIndex) in ['一', '二', '三', '四', '五', '六', '日']" :key="day"><input v-model="item.weekdays" type="checkbox" :value="dayIndex + 1" />周{{ day }}</label></fieldset><label class="plan-field">间隔天数<input v-model.number="item.every_n_days" type="number" min="1" max="30" /></label><label class="plan-field">执行前提（选填）<input v-model="item.condition" maxlength="1000" /></label><button type="button" @click="draft.items.splice(index, 1); saveDraft()">移除此项</button></article>
          <button v-if="draft.items.length < 20" type="button" @click="addApiItem">增加照护事项</button>
          <h3>本次任务生成范围</h3><p class="muted">本次为所选服务日生成任务，所有事项统一安排给一个班次内的责任人。其他日期需另行安排。</p><div class="plan-grid"><label class="plan-field">服务日期<input v-model="draft.serviceDate" type="date" /></label><label class="plan-field">执行班次<select v-model="draft.shiftId"><option value="">请选择开放班次</option><option v-for="row in shifts.filter(row => row.status === 'open')" :key="String(row.id)" :value="String(row.id)">{{ row.name }} · {{ time(row.start_at) }} 至 {{ time(row.end_at) }}</option></select></label><label class="plan-field">责任人<select v-model="draft.assignedTo"><option value="">请选择班次成员</option><option v-for="row in owners" :key="String(row.id)" :value="String(row.id)">{{ row.display_name }}</option></select></label></div><label class="plan-field">人工审批说明<textarea v-model="draft.reason" maxlength="2000" /></label>
        </template>
        <div class="plan-actions"><button type="button" @click="step = 0">上一步</button><button class="plan-primary" type="button" @click="next">预览安排</button></div>
      </section>

      <section v-if="step === 2" class="plan-card" aria-labelledby="plan-preview-title">
        <h2 id="plan-preview-title">预览并人工确认</h2>
        <p v-if="mode === 'api'" class="muted">以下为本地排程预览，实际生成结果以服务器回执为准。当前沿用创建、审批、生成三个接口；一体化编排 API 尚未提供，此流程尚未与后端联调。</p>
        <p v-else class="muted">演示安排保存在本机。确认后生成待执行任务，实际服务完成后仍须登记结果。</p>
        <ul class="plan-preview"><template v-if="mode === 'demo'"><li v-for="(item, index) in previewDemoItems" :key="index"><h3>{{ item.title }}</h3><p>{{ time(item.executionAt) }} 执行 · {{ time(item.deadlineAt) }} 截止</p><p>{{ item.assignee }} · {{ item.shiftName }}</p></li></template><template v-else><li v-for="item in preview" :key="item.key"><h3>{{ item.title }}</h3><p>{{ item.instruction }}</p><p>{{ time(item.time) }} 执行 · {{ time(item.deadline) }} 截止</p><p>{{ previewOwner }} · {{ previewShift }}</p><p v-if="item.condition">执行前提：{{ item.condition }}</p></li></template></ul>
        <ol v-if="apiExecution" class="plan-progress" aria-label="服务器办理进度"><li v-for="row in apiExecution.steps" :key="row.kind">{{ planStepLabels[row.kind] }}：{{ row.receipt !== undefined ? '已收到服务器回执' : row.pending ? '结果待核实，重试原请求' : '尚未办理' }}</li></ol>
        <p v-if="complete" role="status" class="plan-success">{{ mode === 'demo' ? `计划已人工确认，${demoReceipt?.taskIds.length || 0}项待执行任务已保存。` : '三个接口均已返回回执，请到任务列表核对实际生成结果。' }}</p>
        <template v-if="!complete"><p v-if="frozen">已保留原请求与已完成步骤；重试只续办未完成步骤。请勿另建同一计划。</p><label class="plan-confirm"><input v-model="confirmed" type="checkbox" :disabled="busy" />我已核对当前老人、评估依据、照护事项、执行时间及责任人，同意确认本次计划并生成待执行任务。</label></template>
        <details v-if="apiExecution?.steps[2].receipt"><summary>查看任务生成原始回执</summary><pre>{{ JSON.stringify(apiExecution.steps[2].receipt, null, 2) }}</pre></details>
        <div class="plan-actions"><button v-if="!frozen" type="button" @click="step = 1; confirmed = false">返回修改</button><button v-if="demoConflict" type="button" :disabled="busy" @click="reviewDemoAgain">重新载入并核对演示资料</button><button v-if="!complete && !demoConflict" class="plan-primary" type="button" :disabled="busy || !confirmed || !management || !!storageError" @click="execute">{{ busy ? '正在办理，请勿重复提交…' : frozen ? '仅重试未完成步骤' : '人工确认并生成任务' }}</button><button v-if="complete" class="plan-primary" type="button" @click="router.push({ path: '/tasks', query: { elder: elderId } })">查看该老人任务</button></div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.care-plan-page { max-width: 1080px; }
.plan-steps { display: flex; list-style: none; gap: 16px; padding: 0; margin: 24px 0; }
.plan-steps li { flex: 1; display: flex; align-items: center; gap: 8px; color: var(--text-secondary, #64748b); border-bottom: 3px solid #e2e8f0; padding-bottom: 12px; }
.plan-steps li.current { color: var(--primary, #1d6f66); border-color: var(--primary, #1d6f66); font-weight: 600; }
.plan-steps li span { border: 1px solid currentColor; border-radius: 50%; width: 26px; height: 26px; display: inline-grid; place-items: center; flex-shrink: 0; }
.plan-card { background: var(--surface, #fff); border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 20px 0; }
h2 { margin: 0 0 16px; font-size: 20px; } h2 small { font-size: 14px; font-weight: 400; } h3 { font-size: 16px; }
.plan-field { display: flex; flex-direction: column; gap: 7px; margin: 14px 0; min-width: 0; }
input:not([type=checkbox]), select, textarea { box-sizing: border-box; width: 100%; min-height: 42px; padding: 9px 12px; border: 1px solid #b8c6ca; border-radius: 7px; color: inherit; background: #fff; font: inherit; }
textarea { min-height: 86px; resize: vertical; }
.plan-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; }
.plan-item { border-top: 1px solid #dce5e8; padding: 16px 0; margin-top: 14px; }
button { min-height: 40px; padding: 8px 14px; border: 1px solid #b8c6ca; border-radius: 7px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
.plan-primary { background: var(--primary, #1d6f66); color: #fff; border-color: transparent; }
.plan-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.plan-card > .plan-primary { margin-top: 22px; }
.plan-facts { display: flex; flex-wrap: wrap; gap: 40px; } .plan-facts dd { margin: 6px 0; } .plan-facts dt, .muted { color: #536575; }
.plan-error { color: #a12727; } .plan-success { color: #17624e; font-weight: 600; }
.plan-preview { list-style: none; padding: 0; } .plan-preview li { border-bottom: 1px solid #e2e8f0; padding: 4px 0 14px; }
.plan-confirm { display: flex; align-items: flex-start; gap: 10px; line-height: 1.7; margin-top: 24px; } .plan-confirm input { margin-top: 7px; }
.plan-weekdays { border: 0; padding: 8px 0; display: flex; flex-wrap: wrap; gap: 14px; } .plan-weekdays label { display: flex; gap: 4px; align-items: center; }
.plan-time { display: flex; align-items: center; gap: 12px; } .plan-time label { flex: 1; }
.assessment-entry { margin-top: 20px; } details { margin: 14px 0; } summary { cursor: pointer; } pre { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 680px) { .plan-steps { gap: 8px; font-size: 13px; } .plan-steps li { align-items: flex-start; } .plan-grid { grid-template-columns: 1fr; } .plan-card { padding: 16px; } }
</style>
