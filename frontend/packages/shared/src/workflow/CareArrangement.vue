<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { request, type Row } from './model'
import { object, rows, useWorkspaceAction, workspaceDate } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { localTime } from './workspace-time'
import ElderAssessment from './ElderAssessment.vue'
import { careScenes } from './task-care-context'
const props = defineProps<{ elderId: string; mobile?: boolean }>()
const oneOffPath = computed(() => !props.mobile ? {path:'/tasks',query:{create:'1',elder:props.elderId}} : {path:'/tasks/new',query:{elder:props.elderId}})
interface ServiceLine extends Row { key: string; title: string; instruction: string; times: string[] }
const scope = useWorkspaceScope()
const ctx = ref<Row | null>(null), step = ref(1), error = ref(''), loading = ref(false)
const title = ref('日常照护安排'), goal = ref('先询问本人当次意愿，尊重生活习惯并记录实际结果。')
const today = localTime(new Date()).slice(0, 10)
const starts = ref(today), ends = ref(localTime(new Date(Date.now() + 6 * 86400000)).slice(0, 10))
const shiftId = ref(''), assignedTo = ref(''), preview = ref<Row | null>(null), saved = ref<Row | null>(null)
const lines = ref<ServiceLine[]>([])
const shifts = computed(() => ctx.value ? rows(ctx.value.shifts) : [])
const confirmedMemories=computed(()=>ctx.value ? rows(ctx.value.memories).filter(memory=>memory.status==='confirmed' && memory.effective===true).slice(0,5) : [])
const staff = computed(() => ctx.value ? rows(ctx.value.staff).filter(u => {
  const shift = shifts.value.find(s => s.id === shiftId.value)
  return shift && (shift.caregiver_ids as string[]).includes(String(u.id))
}) : [])
const action = useWorkspaceAction(() => props.elderId, 'arrangement')
const { busy, pending, error: saveError } = action
let epoch = 0
function add() {
  lines.value.push({ key: 'service-' + crypto.randomUUID().slice(0, 8), title: '', scene: 'other',
    instruction: '', times: [localTime(new Date(Date.now() + 30 * 60000)).slice(11, 16)],
    weekdays: [1,2,3,4,5,6,7], every_n_days: 1, window_minutes: 60, condition: null })
}
async function load() {
  const ticket = ++epoch
  if (!scope.valid()) return
  loading.value = true; error.value = ''
  try {
    const value = object(await request('/elders/' + encodeURIComponent(props.elderId) + '/arrangement'))
    if (ticket !== epoch || !scope.valid()) return
    ctx.value = value
    if (!lines.value.length) {
      const previous = value.previous_plan ? object(value.previous_plan) : null
      if (previous) {
        title.value = String(previous.title); goal.value = String(previous.goal)
        lines.value = structuredClone(rows(previous.items)) as ServiceLine[]
      } else add()
    }
    const clock = String((lines.value[0]?.times as string[])?.[0] || '10:00')
    const at = Date.parse(today + 'T' + clock + ':00+08:00')
    if (!shiftId.value) shiftId.value = String(shifts.value.find(s => Date.parse(String(s.start_at)) <= at && at < Date.parse(String(s.end_at)))?.id || '')
    if (!assignedTo.value && staff.value.length === 1) assignedTo.value = String(staff.value[0].id)
  } catch (failure) { if (ticket === epoch) error.value = (failure as Error).message }
  finally { if (ticket === epoch) loading.value = false }
}
function body(): Row {
  return { title: title.value.trim(), goal: goal.value.trim(), starts_on: starts.value, ends_on: ends.value,
    items: lines.value, service_date: today, shift_id: shiftId.value, assigned_to: assignedTo.value }
}
async function inspect() {
  if (busy.value || loading.value || pending.value) return
  loading.value = true; error.value = ''
  const ticket = epoch
  try {
    const value = object(await request('/elders/' + encodeURIComponent(props.elderId) + '/arrangement/preview', 'post', body()))
    if (ticket !== epoch || !scope.valid()) return
    if (typeof value.context_token !== 'string' || !Array.isArray(value.items)) throw new Error('预览回执不完整，请重新预览。')
    preview.value = value; step.value = 3
  } catch (failure) { if (ticket === epoch) error.value = (failure as Error).message }
  finally { if (ticket === epoch) loading.value = false }
}
function validate(value: unknown) {
  const result = object(value)
  if (object(result.plan).elder_id !== props.elderId || !Array.isArray(result.created_tasks)) throw new Error('安排回执与当前老人不一致。')
  return result
}
async function confirm() {
  if (!scope.valid()) return
  const result = pending.value ? await action.retry(validate) : preview.value && await action.submit(
    '/elders/' + encodeURIComponent(props.elderId) + '/arrangement/confirm',
    { ...body(), context_token: preview.value.context_token }, validate)
  if (result && scope.valid()) { saved.value = result; preview.value = null }
}
watch(shiftId, () => { if (!staff.value.some(s => s.id === assignedTo.value)) assignedTo.value = staff.value.length === 1 ? String(staff.value[0].id) : '' })
watch(() => props.elderId, () => {
  ctx.value = null; lines.value = []; shiftId.value = ''; assignedTo.value = ''; step.value = 1
  preview.value = null; saved.value = null; void load()
}, { immediate: true })
onBeforeUnmount(() => epoch++)
</script>
<template>
  <section v-if="scope.management" class="workspace-panel" aria-label="三步照护安排">
    <header><h3>照护安排</h3><span>了解情况 → 安排服务 → 预览确认</span></header>
    <p v-if="error || saveError" role="alert" class="workspace-error">{{ error || saveError }}</p>
    <p v-if="loading" role="status">正在核对资料与排班…</p>
    <template v-if="saved"><h4>安排已保存</h4><p>{{ saved.notice }}</p>
      <p>已建立 {{ (saved.created_tasks as Row[]).length }} 项服务任务。</p>
      <RouterLink :to="{ path: '/elders/' + elderId, query: { section: 'today' } }">查看今日安排</RouterLink>
      <button type="button" @click="saved = null; step = 1; void load()">调整其他安排</button>
    </template>
    <template v-else>
      <p v-if="pending" class="workspace-warning">上次确认结果待核实，请重试原提交。</p>
      <button v-if="pending" type="button" :disabled="busy" @click="confirm">核实上次安排</button>
      <fieldset :disabled="busy || loading || !!pending">
        <template v-if="step === 1 && ctx">
          <h4>第一步：了解 {{ (ctx.elder as Row).name }}</h4>
          <p v-if="ctx.assessment">已带入有效生活能力评估，无需重复填写。</p>
          <p v-if="confirmedMemories.length">已带入有效个性化信息，本人当次意愿优先。</p><ul><li v-for="memory in confirmedMemories" :key="String(memory.id)">{{memory.content}}</li></ul>
          <template v-if="!ctx.assessment"><p>还需补充本次观察，未知项目保持待观察。</p><ElderAssessment :elder-id="elderId" /><button type="button" @click="load">评估完成，重新核对</button></template>
          <RouterLink :to="oneOffPath">只安排一次？直接新建任务</RouterLink>
          <button type="button" :disabled="ctx.needs_assessment === true" @click="step = 2">下一步：安排服务</button>
        </template>
        <template v-if="step === 2">
          <h4>第二步：做什么、什么时候、由谁负责</h4>
          <label>安排名称<input v-model="title" maxlength="200"></label>
          <label>照护目标<textarea v-model="goal" rows="2" /></label>
          <div class="arrangement-grid"><label>开始日期<input v-model="starts" type="date"></label><label>结束日期<input v-model="ends" type="date"></label></div>
          <article v-for="(line, index) in lines" :key="String(line.key)" class="workspace-panel">
            <label>服务内容<input v-model="line.title" maxlength="200"></label>
            <label>服务场景<select v-model="line.scene"><option v-for="(name,key) in careScenes" :key="key" :value="key">{{name}}</option></select></label>
            <label v-for="(time, timeIndex) in line.times" :key="timeIndex">服务时间<input v-model="line.times[timeIndex]" type="time"></label>
            <button v-if="line.times.length > 1" type="button" @click="line.times.splice(1, 1)">移除附加时间</button>
            <button v-if="line.times.length < 6" type="button" @click="line.times.push('15:00')">增加服务时间</button>
            <label>怎样完成<textarea v-model="line.instruction" rows="2" /></label>
            <p v-if="line.condition" class="workspace-warning">执行前提：{{ line.condition }}。已有前提将保留，核实满足后才可执行。</p>
            <button v-if="lines.length > 1" type="button" @click="lines.splice(index, 1)">移除此项</button>
          </article>
          <button type="button" @click="add">增加一项服务</button>
          <label>今日班次<select v-model="shiftId" aria-label="今日班次"><option value="">请选择覆盖服务时间的班次</option><option v-for="shift in shifts" :key="String(shift.id)" :value="shift.id">{{ shift.name }} · {{ workspaceDate(shift.start_at) }}</option></select></label>
          <label>负责人<select v-model="assignedTo" aria-label="负责人"><option value="">请选择负责人</option><option v-for="person in staff" :key="String(person.id)" :value="person.id">{{ person.display_name }}</option></select></label>
          <div class="workspace-actions"><button type="button" @click="step = 1">上一步</button><button type="button" :disabled="!assignedTo || !shiftId" @click="inspect">预览安排</button></div>
        </template>
        <template v-if="step === 3 && preview">
          <h4>第三步：预览后确认</h4>
          <p>本次仅生成今日所选班次的任务。后续日期需继续安排，或由主管另行授权自动排期。</p>
          <article v-for="(item, index) in (preview.items as Row[])" :key="index" class="workspace-panel"><strong>{{ item.title }}</strong><p>服务 {{ workspaceDate(item.scheduled_at) }} · 截止 {{ workspaceDate(item.due_at) }}</p><p>{{ item.completion_criteria }}</p></article>
          <p v-for="(item, index) in (preview.unassigned_items as Row[] || [])" :key="'unassigned-'+index" class="workspace-warning">尚未安排：{{ item.title }} · {{ workspaceDate(item.scheduled_at) }}。{{ item.reason }}</p>
          <p v-if="preview.existing_task_count">已有 {{preview.existing_task_count}} 项任务保留，不重复生成。</p>
          <p v-if="(preview.affected_task_ids as string[]).length" class="workspace-warning">原计划有 {{ (preview.affected_task_ids as string[]).length }} 项任务需重新核对。原任务和执行记录保留，不自动覆盖。</p>
          <div class="workspace-actions"><button type="button" @click="step = 2; preview = null">返回修改</button><button type="button" @click="confirm">确认安排</button></div>
        </template>
      </fieldset>
    </template>
  </section>
</template>
<style scoped>
fieldset { border: 0; padding: 0; min-width: 0; }
.arrangement-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1rem; }
@media(max-width: 600px) { .arrangement-grid { grid-template-columns: 1fr; } }
</style>
