<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRaw, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { createHandoverEditor, type HandoverEditor } from '../handover-editor'
import { createDemoApi, submitDemoHandover } from '../demo-actions'
import { loadDemoState, subscribeDemo, type DemoStateV2 } from '../demo-store'
import { readSession } from '../session'
import { formatBusinessTime } from '../business-time'
import { WorkflowRecovery, withSubmissionLock } from './recovery'
const route = useRoute(), actor = readSession()
const state = ref<DemoStateV2>(), editor = ref<HandoverEditor>(), error = ref(''), message = ref(''), busy = ref(false), search = ref(''), notes = ref<Record<string, string>>({})
const shift = computed(() => typeof route.query.shift === 'string' ? route.query.shift : '晚班')
const items = computed(() => state.value?.handover.filter(item => item.shiftId === shift.value) || [])
const candidates = computed(() => state.value?.tasks.filter(task => ['pending', 'in_progress', 'overdue', 'transferred'].includes(task.status) && `${task.title} ${task.assignee} ${task.shift}`.includes(search.value.trim())) || [])
let recovery: WorkflowRecovery | undefined, ticket = 0
const clone = () => structuredClone(toRaw(editor.value!))
function persist() {
  if (!editor.value || !recovery) return false
  try { recovery.save({ operation: 'demo-handover', params: { epoch: editor.value.demoEpoch }, body: { editor: clone(), notes: { ...notes.value } }, phase: editor.value.phase === 'submitted_demo' ? 'succeeded' : 'editing' }); return true }
  catch (failure) { error.value = (failure as Error).message; return false }
}
function changed() { if (busy.value) return; persist() }
async function refresh() { const current = ++ticket; try { const next = await loadDemoState(); if (current === ticket) state.value = next } catch (failure) { error.value = (failure as Error).message } }
async function initialize() {
  await refresh()
  if (!state.value) return
  try {
    recovery = new WorkflowRecovery(`hulao:demo-form:handover:${actor?.accountKey}:${state.value.epoch}:${shift.value}`, localStorage, crypto.randomUUID())
    const saved = recovery.restore()
    editor.value = saved?.body.editor as HandoverEditor | undefined || createHandoverEditor('demo', actor?.accountKey || '', shift.value)
    editor.value.demoEpoch ||= state.value.epoch
    notes.value = saved?.body.notes as Record<string, string> || {}
    error.value = ''; message.value = ''
  } catch (failure) { error.value = (failure as Error).message }
}
async function send() {
  if (busy.value || !editor.value || editor.value.phase === 'submitted_demo') return
  if (!persist()) return
  busy.value = true; error.value = ''
  try {
    await withSubmissionLock(recovery!.key, async () => {
      if (!recovery!.isCurrent()) throw new Error('其他窗口已修改交班，请重新载入核对')
      await submitDemoHandover(clone())
    })
    editor.value.phase = 'submitted_demo'; persist(); await refresh(); message.value = '交班已保存到本机，等待接班人员确认'
  } catch (failure) { error.value = (failure as Error).message }
  finally { busy.value = false }
}
async function receive(id: string, status: 'received' | 'clarifying') {
  if (busy.value || !state.value || !persist()) return
  busy.value = true; error.value = ''
  try {
    await createDemoApi().receiveHandover(id, { status, note: notes.value[id], expectedEpoch: state.value.epoch })
    notes.value[id] = ''; persist(); await refresh(); message.value = status === 'received' ? '已确认接班。关联任务仍须单独执行与登记结果。' : '已提交澄清，事项尚未完成。'
  } catch (failure) { error.value = (failure as Error).message }
  finally { busy.value = false }
}
function nextVersion() { if (!editor.value) return; editor.value = { ...clone(), localId: crypto.randomUUID(), version: editor.value.version + 1, phase: 'editing', itemIds: [], note: '', clarification: {} }; persist() }
function leave() { return !busy.value && (!editor.value || persist() || window.confirm('本机交班未保存，仍然离开？')) }
onBeforeRouteLeave(leave); onBeforeRouteUpdate(leave)
watch(shift, initialize, { immediate: true })
const unsubscribe = subscribeDemo(refresh)
onBeforeUnmount(() => { ticket++; unsubscribe() })
</script>
<template>
  <section class="demo-handovers" aria-label="跨班交接"><p v-if="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
    <nav aria-label="交接班次"><RouterLink v-for="name in ['早班', '午班', '晚班']" :key="name" :to="{ query: { ...route.query, shift: name } }">{{ name }}</RouterLink></nav><h2>接入{{ shift }}</h2>
    <article v-for="item in items" :key="item.id"><h3>{{ item.title }}</h3><p>{{ item.detail }}</p><p>{{ item.status }} · 责任人：{{ item.owner }}</p><p v-if="item.receivedAt">{{ item.receivedBy }} · {{ formatBusinessTime(item.receivedAt, true) }}</p><p v-if="item.note">{{ item.note }}</p>
      <template v-if="item.status !== '已接收'"><label>接班备注或澄清内容<textarea v-model="notes[item.id]" :disabled="busy" @input="changed" /></label><div class="actions"><button type="button" :disabled="busy" @click="receive(item.id, 'received')">确认接班</button><button type="button" :disabled="busy || !notes[item.id]?.trim()" @click="receive(item.id, 'clarifying')">需要澄清</button></div></template><RouterLink :to="'/timeline/' + encodeURIComponent(item.itemId || '')">查看事项经过</RouterLink>
    </article><p v-if="state && !items.length">暂无接班事项</p>
    <section v-if="editor"><h2>交出事项至{{ shift }}</h2><p>编辑草稿与已提交历史分别保存。</p><template v-if="editor.phase !== 'submitted_demo'"><label>筛选候选事项<input v-model="search" type="search" /></label><label v-for="task in candidates" :key="task.id" class="check"><input v-model="editor.itemIds" type="checkbox" :value="task.id" :disabled="busy" @change="changed" />{{ task.title }} · {{ task.assignee }} · {{ task.shift }}</label><label>交班说明<textarea v-model="editor.note" :disabled="busy" @input="changed" /></label><button type="button" :disabled="busy || !editor.itemIds.length" @click="send">确认交班</button></template><button v-else type="button" :disabled="busy" @click="nextVersion">编写下一份交班</button></section>
    <details><summary>已提交历史</summary><article v-for="version in state?.handoverVersions.filter(row => row.shiftId === shift)" :key="version.id"><strong>第{{ version.version }}版 · {{ formatBusinessTime(version.createdAt, true) }}</strong><p>{{ version.note || '未填写补充说明' }}</p><p>{{ version.itemIds.length }}项交班事项</p></article></details>
  </section>
</template>
<style scoped>
.demo-handovers { max-width: 900px; min-width: 0; overflow-wrap: anywhere; } nav, .actions { display: flex; flex-wrap: wrap; gap: 12px; } nav a { padding: 12px; } article { border-bottom: 1px solid var(--hl-border); padding: 14px 0; } label { display: grid; gap: 8px; margin: 12px 0; } input, textarea { box-sizing: border-box; padding: 8px; min-height: 44px; max-width: 100%; font: inherit; border: 1px solid var(--hl-border); border-radius: 6px; background: white; } textarea { min-height: 80px; width: 100%; } .check { display: flex; align-items: center; } button { padding: 10px 14px; min-height: 44px; border: 1px solid var(--hl-primary); color: var(--hl-primary); background: white; border-radius: 6px; font: inherit; } button:disabled { opacity: .5; } [role='alert'] { color: var(--hl-danger); } p, summary { line-height: 1.6; color: var(--hl-muted); }
</style>
