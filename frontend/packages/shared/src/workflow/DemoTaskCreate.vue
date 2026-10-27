<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { loadDemoState } from '../demo-store'
import { createDemoTask, type DemoTaskInput } from '../demo-task-create'
import { readSession } from '../session'
import type { Elder } from '../types'
import { WorkflowRecovery, withSubmissionLock } from './recovery'
const props = defineProps<{ elderId?: string; mobile?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const actor = readSession()
const route = useRoute()
const sourceRecordId = computed(() => typeof route.query.source_record === 'string' ? route.query.source_record : undefined)
const elders = ref<Elder[]>([]), epoch = ref(''), error = ref(''), message = ref(''), busy = ref(false), ready = ref(false), receipt = ref('')
const form = reactive({ elderId: '', title: '', executionAt: '', deadlineAt: '', assignee: '', shiftName: '', scene: 'other' as DemoTaskInput['scene'], confirmed: false, operationKey: crypto.randomUUID() as string })
let recovery: WorkflowRecovery | undefined
const detail = computed(() => props.mobile ? `/tasks/${encodeURIComponent(receipt.value)}` : `/tasks?task=${encodeURIComponent(receipt.value)}`)
function changed() {
  if (!ready.value || busy.value || receipt.value) return
  try { recovery!.save({ operation: 'demo-task-create', params: { epoch: epoch.value }, body: { ...form }, phase: 'editing' }); message.value = '已保存到本机' }
  catch (failure) { error.value = (failure as Error).message; message.value = '本机保存失败，请保留内容' }
}
function switchElder() {
  Object.assign(form, { title: '', executionAt: '', deadlineAt: '', assignee: '', shiftName: '', scene: 'other', confirmed: false, operationKey: crypto.randomUUID() }); changed()
}
async function submit() {
  if (busy.value || receipt.value) return
  error.value = ''; busy.value = true
  try {
    if (!recovery || !recovery.isCurrent()) throw new Error('其他窗口已修改表单，请重新载入后核对')
    if (readSession()?.accountKey !== actor?.accountKey) throw new Error('账号已变化，请重新进入页面')
    // Persist the exact operation key before writing. A lost receipt can replay
    // this request without duplicating or resetting an existing task.
    recovery.save({ operation: 'demo-task-create', params: { epoch: epoch.value }, body: { ...form }, phase: 'editing' })
    const result = await withSubmissionLock(recovery.key, () => createDemoTask({ ...form, sourceRecordId: sourceRecordId.value, epoch: epoch.value, executionAt: form.executionAt ? `${form.executionAt}:00+08:00` : '', deadlineAt: form.deadlineAt ? `${form.deadlineAt}:00+08:00` : '' }))
    recovery.save({ operation: 'demo-task-create', params: { epoch: epoch.value }, body: { ...form }, phase: 'succeeded', result: result.id })
    receipt.value = result.id; message.value = '任务已保存到本机，等待执行'; emit('saved')
  } catch (failure) { error.value = (failure as Error).message }
  finally { busy.value = false }
}
function leave() { if (busy.value) return false; if (ready.value && !receipt.value) changed(); return !error.value || window.confirm('本机保存未完成，仍然离开？') }
onBeforeRouteLeave(leave); onBeforeRouteUpdate(leave)
onMounted(async () => {
  try {
    const state = await loadDemoState(); epoch.value = state.epoch; elders.value = state.elders
    recovery = new WorkflowRecovery(`hulao:demo-form:task:${actor?.accountKey}:${state.epoch}:${props.elderId || ''}:${sourceRecordId.value || ''}`, localStorage, crypto.randomUUID())
    const saved = recovery.restore()
    if (saved) { Object.assign(form, saved.body); if (saved.phase === 'succeeded' && typeof saved.result === 'string') receipt.value = saved.result }
    else form.elderId = props.elderId || (state.elders.length === 1 ? state.elders[0].id : '')
    if (!state.elders.some(elder => elder.id === form.elderId)) throw new Error('老人资料已变化，请返回老人档案重新选择')
    ready.value = true
  } catch (failure) { error.value = (failure as Error).message }
})
</script>
<template>
  <section class="demo-task-create" aria-label="新建照护任务">
    <h2>新建照护任务</h2><p v-if="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
    <form v-if="ready && !receipt" @submit.prevent="submit">
      <fieldset :disabled="busy"><label>老人<select v-model="form.elderId" required @change="switchElder"><option value="">请选择</option><option v-for="elder in elders" :key="elder.id" :value="elder.id">{{ elder.name }} · {{ elder.bedLabel }}</option></select></label>
      <label>照护事项<input v-model="form.title" required maxlength="200" @input="changed" /></label>
      <label>执行时间（北京时间）<input v-model="form.executionAt" type="datetime-local" required @input="changed" /></label><label>截止时间（北京时间）<input v-model="form.deadlineAt" type="datetime-local" required @input="changed" /></label>
      <label>责任人<select v-model="form.assignee" required @change="changed"><option value="">请选择</option><option>小王</option><option>小李</option><option>小陈</option></select></label><label>班次<select v-model="form.shiftName" required @change="changed"><option value="">请选择</option><option>早班</option><option>午班</option><option>晚班</option></select></label>
      <label>服务场景<select v-model="form.scene" @change="changed"><option value="other">其他</option><option value="activity">活动</option><option value="rest">休息</option><option value="dining">用餐</option><option value="communication">沟通</option></select></label>
      <label class="confirmation"><input v-model="form.confirmed" type="checkbox" @change="changed" />已核对老人、时间、责任人与班次</label><button type="submit" :disabled="!form.confirmed || busy">{{ busy ? '保存中…' : '确认新建任务' }}</button></fieldset>
    </form><RouterLink v-if="receipt" :to="detail">查看并办理任务</RouterLink>
  </section>
</template>
<style scoped>
.demo-task-create { max-width: 760px; min-width: 0; overflow-wrap: anywhere; } fieldset { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 16px; border: 0; padding: 0; min-width: 0; } label { display: grid; gap: 8px; min-width: 0; } input, select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; border: 1px solid var(--hl-border); border-radius: 6px; padding: 8px; background: white; font: inherit; color: var(--hl-ink); } .confirmation { display: flex; align-items: center; } .confirmation input { width: 20px; flex: 0 0 20px; } button { min-height: 44px; color: white; background: var(--hl-primary); border: 0; border-radius: 6px; padding: 10px; font: inherit; } button:disabled { opacity: .5; } [role='alert'] { color: var(--hl-danger); }
</style>
