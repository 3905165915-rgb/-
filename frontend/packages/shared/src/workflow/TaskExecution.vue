<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { request, type Row } from './model'
import { object, useWorkspaceAction, workspaceDate, workspaceStorageKey } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import WorkflowPanel from './WorkflowPanel.vue'
const props = defineProps<{ taskId: string }>()
const emit = defineEmits<{ changed: [] }>()
const scope = useWorkspaceScope()
const task = ref<Row | null>(null), error = ref(''), note = ref(''), reason = ref(''), notDone = ref(false)
const action = useWorkspaceAction(() => props.taskId, 'task-execution', () => '/tasks/' + encodeURIComponent(props.taskId) + '/')
const { busy, pending, error: actionError } = action
const allowed = computed(() => task.value?.allowed_actions as string[] || [])
const primary = computed(() => allowed.value.includes('start') ? 'start' : allowed.value.includes('complete') ? 'complete' : '')
const labels: Record<string,string> = {pending:'待执行',in_progress:'执行中',overdue:'已逾期',not_done:'未执行',completed:'已完成',cancelled:'已取消'}
const reasons = {elder_refused:'老人拒绝',out:'老人外出',unwell:'身体不适',staff_shortage:'人员不足',equipment:'设备问题',family_request:'家属要求',other:'其他'}
const storageKey = computed(() => workspaceStorageKey(scope.owner, props.taskId, 'task-result-text'))
let epoch = 0
async function load() {
  const ticket = ++epoch
  try {
    const value = object(await request('/tasks/' + encodeURIComponent(props.taskId)))
    if (ticket === epoch && scope.valid()) {task.value = value;error.value=''}
  } catch (failure) { if (ticket === epoch) error.value = (failure as Error).message }
}
function preserve() {
  try { sessionStorage.setItem(storageKey.value, JSON.stringify({note:note.value,reason:reason.value,notDone:notDone.value})) }
  catch { error.value = '无法保存本机草稿，请保持页面打开。' }
}
function validate(value: unknown) {
  const result = object(value)
  if (result.id !== props.taskId || !Number.isInteger(result.revision)) throw new Error('提交回执不完整，请重试原操作。')
  return result
}
async function send(kind: string) {
  if (!task.value || !scope.valid()) return
  error.value = ''
  if (!pending.value && kind !== 'start' && !note.value.trim()) { error.value='请写下实际结果或未执行情况。'; return }
  if (!pending.value && kind === 'not_done' && !reason.value) { error.value='请选择未执行原因。'; return }
  const root = '/tasks/' + encodeURIComponent(props.taskId)
  const result = pending.value ? await action.retry(validate) : await action.submit(
    root + (kind==='complete'?'/complete':'/transition'),
    kind==='complete' ? {result:note.value.trim()} : {action:kind,expected_revision:task.value.revision,
      ...(kind==='not_done'?{reason_code:reason.value,note:note.value.trim()}:{})}, validate)
  if (result) {
    note.value=''; reason.value=''; notDone.value=false; preserve()
    emit('changed'); await load()
  }
}
watch(() => props.taskId, () => {
  task.value=null; error.value=''; note.value=''; reason.value=''; notDone.value=false
  try { const draft=JSON.parse(sessionStorage.getItem(storageKey.value)||'{}'); note.value=typeof draft.note==='string'?draft.note:''; reason.value=draft.reason||''; notDone.value=draft.notDone===true } catch { error.value='本机草稿无法恢复，请核对服务器任务。' }
  void load()
}, {immediate:true})
onBeforeUnmount(()=>epoch++)
defineExpose({canClose: () => {preserve();return !busy.value}})
</script>
<template>
  <section class="workspace-panel" aria-label="办理当前任务">
    <p v-if="error || actionError" role="alert">{{ error || actionError }}</p>
    <template v-if="task">
      <h3>{{ task.title }}</h3><p>{{ task.elder_name || '老人关联待核对' }} · {{ task.bed_label || '历史床位待核对' }}</p>
      <p>{{ task.assignee_name || '待分配' }} · {{ task.shift_name || '班次待核对' }} · {{ labels[String(task.status)] || '状态待核对' }}</p>
      <p v-if="task.scheduled_at">服务 {{ workspaceDate(task.scheduled_at) }}</p><p>截止 {{ workspaceDate(task.due_at) }}</p>
      <p v-if="task.result">办理结果：{{ task.result }}</p>
      <p v-if="pending">上次提交结果待核实，请重试原操作。</p>
      <fieldset :disabled="busy || !!pending">
        <template v-if="primary==='complete' || notDone"><label>{{ notDone?'未执行说明':'服务结果' }}<textarea v-model="note" rows="3" maxlength="2000" @input="preserve" /></label></template>
        <label v-if="notDone">未执行原因<select v-model="reason" @change="preserve"><option value="">请选择</option><option v-for="(label,key) in reasons" :key="key" :value="key">{{ label }}</option></select></label>
        <button v-if="primary" type="button" @click="send(notDone?'not_done':primary)">{{ notDone?'登记未执行':primary==='start'?'开始服务':'提交服务结果' }}</button>
        <button v-if="allowed.includes('not_done')" type="button" @click="notDone=!notDone;preserve()">{{ notDone?'返回服务办理':'本次未执行' }}</button>
      </fieldset>
      <button v-if="pending" type="button" :disabled="busy" @click="send('retry')">核实上次提交</button>
      <details v-if="allowed.length"><summary>转交、前提核实及其他办理</summary><WorkflowPanel group="tasks" :context="{task_id:taskId}" @changed="load();emit('changed')" /></details>
    </template>
    <p v-else>正在读取任务…</p>
  </section>
</template>
<style scoped>fieldset{border:0;padding:0;min-width:0}textarea,select{width:100%;box-sizing:border-box}button{margin:.5rem .5rem .5rem 0}</style>
