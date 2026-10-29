<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listAll, request, type Row } from './model'
import { object, rows, useWorkspaceAction, workspaceDate } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { localTime } from './workspace-time'
const route = useRoute(), router = useRouter(), scope = useWorkspaceScope()
const elders = ref<Row[]>([]), elderId = ref(''), day = ref(localTime(new Date()).slice(0,10))
const loading = ref(false), error = ref(''), directoryError = ref(''), snapshot = ref<Row|null>(null)
const review = ref<Row|null>(null), note = ref(''), decision = ref('needs_followup')
const action = useWorkspaceAction(elderId, 'coverage-review', '/insights/coverage/reviews')
const locked = computed(() => loading.value || action.busy.value || !!action.pending.value)
const items = computed(() => snapshot.value ? rows(snapshot.value.items) : [])
const links = computed(() => snapshot.value ? rows(snapshot.value.record_task_links) : [])
const statuses:Record<string,string> = { covered:'已有任务完成结果', partial:'登记信息待补齐', missing_record:'未见完整结果', not_applicable:'人工核对不适用' }
let epoch = 0
async function loadDirectory() {
  directoryError.value = ''
  try { const result = await listAll('/elders'); if (scope.valid()) elders.value = result }
  catch(failure) { if (scope.valid()) directoryError.value = (failure as Error).message }
}
function validate(value: unknown) {
  const result = object(value)
  if (result.elder_id !== elderId.value || result.service_date !== day.value || !Array.isArray(result.items) || !Array.isArray(result.record_task_links))
    throw new Error('核对结果与当前老人或日期不匹配，请重新读取。')
  const seen = new Set<string>()
  for (const item of rows(result.items)) {
    if (typeof item.occurrence_key !== 'string' || seen.has(item.occurrence_key) || typeof item.title !== 'string' || typeof item.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(item.fingerprint) || !Array.isArray(item.tasks) || !Array.isArray(item.evidence))
      throw new Error('核对明细不完整，请重新读取。')
    seen.add(item.occurrence_key)
  }
  rows(result.record_task_links)
  return result
}
async function load() {
  if (!elderId.value || !scope.valid() || action.busy.value) return
  const ticket = ++epoch
  loading.value = true; error.value = ''; snapshot.value = null; review.value = null
  try {
    const result = await request('/insights/coverage?'+new URLSearchParams({elder_id:elderId.value,service_date:day.value}))
    if (ticket === epoch && scope.valid()) snapshot.value = validate(result)
  } catch(failure) { if(ticket === epoch && scope.valid()) error.value = (failure as Error).message }
  finally { if(ticket === epoch) loading.value = false }
}
function selectScope() {
  void router.replace({query:{...route.query,elder:elderId.value,service_date:day.value}})
}
async function saveReview() {
  if (!action.pending.value && (!review.value || !note.value.trim())) return
  const result = action.pending.value ? await action.retry(validate) : await action.submit('/insights/coverage/reviews', {
    elder_id:elderId.value, service_date:day.value, occurrence_key:review.value!.occurrence_key,
    expected_fingerprint:review.value!.fingerprint, decision:decision.value, note:note.value.trim(),
  }, validate)
  if (result && scope.valid()) { snapshot.value = result; review.value = null; note.value = '' }
}
watch(() => route.query, query => {
  if (action.pending.value) return
  elderId.value = String(query.elder_id || query.elder || '')
  day.value = typeof query.service_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.service_date) ? query.service_date : localTime(new Date()).slice(0,10)
  snapshot.value = null; review.value = null
  if (elderId.value) void load()
}, {immediate:true})
void loadDirectory()
onBeforeUnmount(() => epoch++)
</script>
<template>
  <section v-if="scope.active.value" class="workspace-panel" aria-label="双向核对工作区">
    <h1>双向核对</h1><p>同一老人、同一北京时间日期，同时查看计划结果和记录关联。当前服务尚未提供跨老人班次汇总。</p>
    <form class="workspace-actions" @submit.prevent="load">
      <label>老人<select v-model="elderId" :disabled="locked" @change="selectScope"><option value="">请选择老人</option><option v-for="elder in elders" :key="String(elder.id)" :value="elder.id">{{elder.name}} · {{elder.bed_label || '床位未提供'}}</option></select></label>
      <label>照护日期<input v-model="day" type="date" :disabled="locked" @change="selectScope" /></label>
      <button type="submit" :disabled="locked || !elderId">{{loading?'读取中…':'刷新同一范围'}}</button>
    </form>
    <p v-if="directoryError" role="alert">{{directoryError}} <button type="button" @click="loadDirectory">重试老人目录</button></p>
    <p v-if="error || action.error.value" role="alert">{{error || action.error.value}}</p>
    <button v-if="action.pending.value" type="button" :disabled="action.busy.value" @click="saveReview">使用原请求核实核对结果</button>
    <p v-if="loading" role="status">正在读取计划结果与记录关联…</p>
    <template v-if="snapshot">
      <p>{{snapshot.notice}} <span>刷新于 {{workspaceDate(snapshot.as_of)}}</span></p>
      <h2>计划要求与实际登记结果</h2>
      <p v-if="!items.length">这一范围暂无计划发生项；不能据此认定没有提供照护。</p>
      <article v-for="item in items" :key="String(item.occurrence_key)" class="workspace-panel">
        <h3>{{item.title}}</h3><p>{{item.requirement || '要求未提供'}}</p><p>{{statuses[String(item.coverage_status)] || '状态待核实'}} · {{workspaceDate(item.scheduled_at)}}</p>
        <ul><li v-for="task in rows(item.tasks)" :key="String(task.id)"><RouterLink :to="{path:'/tasks',query:{elder:elderId,task:String(task.id)}}">查看关联任务</RouterLink><p>{{task.result || '尚无完成结果'}}</p></li></ul>
        <button type="button" :disabled="locked" @click="review=item;note=''">人工核对这一项</button>
        <form v-if="review?.occurrence_key===item.occurrence_key" @submit.prevent="saveReview">
          <label>核对结论<select v-model="decision" :disabled="locked"><option value="needs_followup">需要跟进</option><option value="not_applicable">本次不适用</option><option value="reopen_review">重新核对</option></select></label>
          <label>核对说明<textarea v-model="note" required :disabled="locked" /></label><button :disabled="locked || !note.trim()">保存核对</button>
        </form>
      </article>
      <h2>记录对应的任务</h2><p v-if="!links.length">同一范围暂无记录关联。</p>
      <article v-for="record in links" :key="String(record.record_id)" class="workspace-panel">
        <p>{{Array.isArray(record.observations) ? record.observations.join('；') : '观察内容未提供'}}</p>
        <p v-if="!rows(record.linked_tasks).length">尚未关联任务；记录无需全部转为任务。</p>
        <RouterLink v-for="task in rows(record.linked_tasks)" :key="String(task.id)" :to="{path:'/tasks',query:{elder:elderId,task:String(task.id)}}">{{task.title}}</RouterLink>
      </article>
    </template>
    <p v-else-if="!loading && !error && !elderId">请选择老人，开始核对。</p>
  </section>
</template>
