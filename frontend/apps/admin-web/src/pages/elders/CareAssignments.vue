<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listAll, request, type Row } from '../../../../../packages/shared/src/workflow/model'
import { readSession } from '../../../../../packages/shared/src/session'
import { sameCareSession } from '../../../../../packages/shared/src/workflow/task-care-context'
import { date as businessDate } from '../../../../../packages/shared/src/workflow/workspace-time'
import { useElders } from '../../services/data'

const emit = defineEmits<{ changed: [] }>()
const elders = useElders()
const staff = ref<Row[]>([])
const loadingStaff = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const recoveryProblem = ref('')
const elderId = ref(''), caregiverId = ref(''), kind = ref('explicit_assignment')
const startAt = ref(localInput(Date.now())), endAt = ref(localInput(Date.now() + 86400000))
const reason = ref('')
type Assignment = { id: string; elder_id: string; caregiver_id: string; kind: string; start_at: string; end_at: string; revision: number; status: string }
const created = ref<Assignment[]>([])
const revokeReasons = ref<Record<string, string>>({})
const caregiverOptions = computed(() => staff.value.filter(row => ['caregiver', 'nurse'].includes(String(row.role || '')) && row.active === true))
const session = ref(readSession())
const createAttempt = ref<{ key: string; payload: Row } | null>(null)
const revokeAttempts = ref<Record<string, { key: string; reason: string; revision: number }>>({})
let epoch = 0
function permitted() { return ['admin', 'supervisor'].includes(session.value?.role || '') && session.value?.mode === 'api' && sameCareSession(readSession(), session.value) }
function current(ticket: number) { return ticket === epoch && permitted() }
function recoveryKey() { const s = session.value; return 'hulao:assignment-requests:v1:' + JSON.stringify([s?.mode, s?.accountKey, s?.userId, s?.role]) }
function persist() { sessionStorage.setItem(recoveryKey(), JSON.stringify({ create: createAttempt.value, revokes: revokeAttempts.value, created: created.value })) }
function restore() {
  if (!permitted()) return
  try {
    const saved = JSON.parse(sessionStorage.getItem(recoveryKey()) || '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('invalid journal')
    if (Array.isArray(saved.created)) created.value = saved.created.map(parseAssignment)
    if (saved.revokes !== undefined) {
      if (!saved.revokes || typeof saved.revokes !== 'object' || Array.isArray(saved.revokes)) throw new Error('invalid revoke journal')
      for (const [id, attempt] of Object.entries(saved.revokes)) {
        const entry = attempt as Row
        if (!entry || typeof entry.key !== 'string' || !entry.key || typeof entry.reason !== 'string' || !entry.reason.trim() || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1 || !created.value.some(row => row.id === id)) throw new Error('invalid revoke journal')
      }
      revokeAttempts.value = saved.revokes
    }
    if (saved.create !== undefined && saved.create !== null) {
      if (typeof saved.create.key !== 'string' || !saved.create.key || !saved.create.payload || typeof saved.create.payload.reason !== 'string' || !saved.create.payload.reason.trim()) throw new Error('invalid create journal')
      parseAssignment({ ...saved.create.payload, id: 'pending', revision: 1, status: 'active' })
      createAttempt.value = saved.create
      const payload = saved.create.payload
      elderId.value = payload.elder_id; caregiverId.value = payload.caregiver_id; kind.value = payload.kind
      startAt.value = localInput(Date.parse(payload.start_at)); endAt.value = localInput(Date.parse(payload.end_at)); reason.value = payload.reason
    }
    for (const item of created.value) revokeReasons.value[item.id] = revokeAttempts.value[item.id]?.reason || '工作安排结束或调整'
  } catch { recoveryProblem.value = '本机会话恢复数据异常，已暂停创建和撤销；请核对服务器安排后再操作。' }
}
function localInput(time: number) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
}
function elderLabel(id: string) { const elder = elders.data.value?.find(row => row.id === id); return elder ? `${elder.name} · ${elder.bedLabel || '床位待核对'}` : '老人信息待核对' }
function caregiverLabel(id: string) { return String(staff.value.find(row => row.id === id)?.display_name || '护理员信息待核对') }
function timeLabel(time: string) { return new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }
function parseAssignment(value: unknown): Assignment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('分配响应格式异常，请核对服务器状态。')
  const row = value as Row
  if (typeof row.id !== 'string' || typeof row.elder_id !== 'string' || typeof row.caregiver_id !== 'string' ||
    !row.id || !row.elder_id || !row.caregiver_id || !['explicit_assignment', 'temporary_support'].includes(String(row.kind)) || typeof row.start_at !== 'string' || typeof row.end_at !== 'string' ||
    ![row.start_at, row.end_at].every(time => /(Z|[+-]\d{2}:\d{2})$/.test(String(time)) && Number.isFinite(Date.parse(String(time)))) || Date.parse(row.start_at) >= Date.parse(row.end_at) ||
    typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1 || !['active', 'revoked'].includes(String(row.status)))
    throw new Error('分配响应缺少有效编号或版本号，请核对服务器状态。')
  return row as Assignment
}
async function loadStaff() {
  if (!permitted()) return
  const ticket = epoch
  loadingStaff.value = true
  error.value = ''
  try { const rows = await listAll('/staff/directory'); if (current(ticket)) staff.value = rows }
  catch (failure) { if (current(ticket)) error.value = failure instanceof Error ? failure.message : '员工目录读取失败。' }
  finally { if (current(ticket)) loadingStaff.value = false }
}
async function assign() {
  if (busy.value || recoveryProblem.value || !permitted()) return
  const ticket = epoch
  error.value = ''; notice.value = ''
  if (!elderId.value || !caregiverId.value || !reason.value.trim() || !startAt.value || !endAt.value) {
    error.value = '请完整填写老人、护理员、有效期和安排原因。'; return
  }
  let start: Date, end: Date
  try { start = new Date(businessDate(startAt.value)); end = new Date(businessDate(endAt.value)) }
  catch { error.value = '请填写有效的北京时间安排区间。'; return }
  if (!createAttempt.value && (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end <= new Date())) {
    error.value = '有效期必须是未来时间，且结束时间晚于开始时间。'; return
  }
  if (!createAttempt.value) createAttempt.value = { key: crypto.randomUUID(), payload: {
    elder_id: elderId.value, caregiver_id: caregiverId.value, kind: kind.value,
    start_at: start.toISOString(), end_at: end.toISOString(), reason: reason.value.trim(),
  } }
  busy.value = true
  try {
    persist()
    const attempt = createAttempt.value!
    const item = parseAssignment(await request('/elders/work-assignments', 'post', attempt.payload, attempt.key))
    if (!current(ticket)) return
    if (item.elder_id !== attempt.payload.elder_id || item.caregiver_id !== attempt.payload.caregiver_id || item.kind !== attempt.payload.kind || item.status !== 'active' || Date.parse(item.start_at) !== Date.parse(String(attempt.payload.start_at)) || Date.parse(item.end_at) !== Date.parse(String(attempt.payload.end_at))) throw new Error('服务器返回的分配与原请求不一致，请核实。')
    created.value.unshift(item)
    revokeReasons.value[item.id] = '工作安排结束或调整'
    notice.value = `分配已由服务器确认，编号 ${item.id}，版本 ${item.revision}。`
    createAttempt.value = null
    persist()
    reason.value = ''
    emit('changed')
  } catch (failure) { if (current(ticket)) error.value = failure instanceof Error ? failure.message : '分配结果待核实；重试会沿用同一请求编号。' }
  finally { if (current(ticket)) busy.value = false }
}
async function revoke(item: Assignment) {
  const revokeReason = revokeReasons.value[item.id]?.trim()
  if (!revokeReason || item.status !== 'active' || busy.value || recoveryProblem.value || !permitted()) return
  const ticket = epoch
    if (!window.confirm(`确认撤销${elderLabel(item.elder_id)}由${caregiverLabel(item.caregiver_id)}照护的安排？护理员的后续访问范围将由服务器重新核定。`)) return
  let attempt = revokeAttempts.value[item.id]
  if (!attempt) {
    attempt = { key: crypto.randomUUID(), reason: revokeReason, revision: item.revision }
    revokeAttempts.value[item.id] = attempt
  }
  error.value = ''; notice.value = ''; busy.value = true
  try {
    persist()
    const result = parseAssignment(await request(`/elders/work-assignments/${encodeURIComponent(item.id)}/revoke`, 'post',
      { expected_revision: attempt.revision, reason: attempt.reason }, attempt.key))
    if (!current(ticket)) return
    if (result.id !== item.id || result.elder_id !== item.elder_id || result.caregiver_id !== item.caregiver_id || result.kind !== item.kind || result.status !== 'revoked' || result.revision <= attempt.revision) throw new Error('撤销响应与原分配不一致，请核实。')
    created.value = created.value.map(row => row.id === item.id ? result : row)
    delete revokeAttempts.value[item.id]
    persist()
    notice.value = `分配 ${item.id} 已撤销，服务器版本 ${result.revision}。`
    emit('changed')
  } catch (failure) { if (current(ticket)) error.value = failure instanceof Error ? failure.message : '撤销结果待核实；重试会沿用同一请求编号。' }
  finally { if (current(ticket)) busy.value = false }
}
function clear() { epoch++; staff.value = []; created.value = []; createAttempt.value = null; revokeAttempts.value = {}; revokeReasons.value = {}; busy.value = false; loadingStaff.value = false; error.value = ''; notice.value = ''; recoveryProblem.value = ''; elderId.value = ''; caregiverId.value = ''; reason.value = ''; kind.value = 'explicit_assignment'; startAt.value = localInput(Date.now()); endAt.value = localInput(Date.now() + 86400000); session.value = null }
function changed() { if (!sameCareSession(readSession(), session.value)) { clear(); session.value = readSession(); restore(); void loadStaff() } }
onMounted(() => { restore(); void loadStaff(); window.addEventListener('focus', changed); window.addEventListener('storage', changed); window.addEventListener('hulao:unauthorized', clear) })
onBeforeUnmount(() => { clear(); window.removeEventListener('focus', changed); window.removeEventListener('storage', changed); window.removeEventListener('hulao:unauthorized', clear) })
</script>

<template>
  <section class="assignment-panel" aria-labelledby="assignment-title">
    <header><div><h2 id="assignment-title">照护范围安排</h2><p>服务器按有效时间、开放班次和任务责任计算访问范围。</p></div><button type="button" :disabled="loadingStaff" @click="loadStaff">刷新员工目录</button></header>
    <form class="assignment-form" @submit.prevent="assign">
      <label>老人<select v-model="elderId" aria-label="老人" :disabled="busy || !!createAttempt" required><option value="">选择老人</option><option v-for="elder in elders.data.value" :key="elder.id" :value="elder.id">{{ elder.name }} · {{ elder.bedLabel }}</option></select></label>
      <label>执行人员<select v-model="caregiverId" aria-label="执行人员" required :disabled="loadingStaff || busy || !!createAttempt"><option value="">选择在职护理员或照护专员</option><option v-for="person in caregiverOptions" :key="String(person.id)" :value="String(person.id)">{{ person.display_name }}</option></select></label>
      <label>安排类型<select v-model="kind" :disabled="busy || !!createAttempt"><option value="explicit_assignment">明确分配</option><option value="temporary_support">临时支援</option></select></label>
      <label>开始时间<input v-model="startAt" type="datetime-local" :disabled="busy || !!createAttempt" required /></label>
      <label>结束时间<input v-model="endAt" type="datetime-local" :disabled="busy || !!createAttempt" required /></label>
      <label class="reason-field">安排原因<input v-model="reason" :disabled="busy || !!createAttempt" maxlength="500" required /></label>
      <button type="submit" :disabled="busy || !!recoveryProblem || loadingStaff || !caregiverOptions.length">{{ busy ? '正在提交…' : createAttempt ? '使用同一请求编号重试' : '创建照护分配' }}</button>
    </form>
    <p v-if="!loadingStaff && !caregiverOptions.length" role="status">当前员工目录没有可分配的在职护理员或照护专员。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="recoveryProblem" class="error" role="alert">{{ recoveryProblem }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="createAttempt || Object.keys(revokeAttempts).length" class="limitation" role="status">存在结果待核实的请求，原内容已锁定。重试会沿用相同请求编号和版本；刷新后可恢复。</p>
    <p class="limitation">工作清单只返回现有分配编号，不含版本号；本页仅能撤销当前浏览器会话创建且已取得服务器版本的分配。其他历史分配需后端增加分配详情/列表接口后再操作。</p>
    <ul v-if="created.length" class="assignment-list" aria-label="本页创建的照护分配">
      <li v-for="item in created" :key="item.id">
        <div><strong>{{ elderLabel(item.elder_id) }} → {{ caregiverLabel(item.caregiver_id) }}</strong><p>{{ item.kind === 'temporary_support' ? '临时支援' : '明确分配' }} · {{ timeLabel(item.start_at) }} 至 {{ timeLabel(item.end_at) }} · {{ item.status === 'active' ? '有效' : '已撤销' }}</p><details><summary>追溯编号与版本</summary><p>安排：{{ item.id }} · 版本 {{ item.revision }}；老人：{{ item.elder_id }}；护理员：{{ item.caregiver_id }}</p></details></div>
        <div v-if="item.status === 'active'" class="revoke-actions"><input v-model="revokeReasons[item.id]" :disabled="busy || !!revokeAttempts[item.id]" aria-label="撤销原因" maxlength="500" /><button type="button" :disabled="busy || !!recoveryProblem || !revokeReasons[item.id]?.trim()" @click="revoke(item)">撤销</button></div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.assignment-panel { padding: 16px 0; border-bottom: 1px solid var(--hl-border); }
header { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
h2 { margin: 0; font-size: 18px; }
p { color: var(--hl-muted); }
.assignment-form { display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)); gap: 12px; align-items: end; }
label { display: grid; gap: 6px; min-width: 0; }
input, select, button { min-height: 40px; padding: 6px 8px; border: 1px solid var(--hl-border); border-radius: 6px; background: #fff; color: var(--hl-ink); font: inherit; }
button { cursor: pointer; color: var(--hl-primary); }
.reason-field { grid-column: span 2; }
.assignment-list { padding: 0; list-style: none; }
.assignment-list li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--hl-border); }
.assignment-list p { margin: 6px 0; }
.revoke-actions { display: flex; gap: 8px; }
.error { color: var(--hl-danger); }
.limitation { font-size: 14px; }
@media (max-width: 800px) { .assignment-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 540px) { .assignment-form { grid-template-columns: minmax(0, 1fr); } .reason-field { grid-column: auto; } .assignment-list li { align-items: stretch; flex-direction: column; } }
</style>
