<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { createRecordEditor, touchRecordEditor, type RecordEditor } from '../editor'
import { loadRecordEditor, saveRecordEditor, writeRecordJournal } from '../storage'
import { createDemoApi, saveDemoManualRecord, saveDemoOriginal } from '../demo-actions'
import { loadDemoState } from '../demo-store'
import { readSession } from '../session'
const props = defineProps<{ elderId?: string; localId?: string }>()
const emit = defineEmits<{ saved: [] }>()
const session = readSession()
const editor = ref<RecordEditor>(createRecordEditor('demo', session?.accountKey || '', props.elderId))
const ready = ref(false), busy = ref(false), error = ref(''), notice = ref(''), saved = ref(false)
const elderLabel = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let saving = Promise.resolve(true)
const clone = () => structuredClone(toRaw(editor.value))
async function persist() {
  clearTimeout(timer)
  const next = clone()
  saving = saving.catch(() => false).then(async () => {
    try {
      if (readSession()?.accountKey !== session?.accountKey) throw new Error('账号已变化，请重新进入记录页')
      next.persistedVersion = editor.value.persistedVersion
      await saveRecordEditor(next)
      if (editor.value.localId === next.localId) {
        editor.value.persistedVersion = next.editVersion
        if (editor.value.editVersion === next.editVersion) saved.value = true
      }
      return true
    } catch (failure) { error.value = (failure as Error).message; saved.value = false; return false }
  })
  return saving
}
function changed(source = false) {
  touchRecordEditor(editor.value, source); saved.value = false
  try { writeRecordJournal(clone()) } catch (failure) { error.value = '恢复日志未保存：' + (failure as Error).message }
  clearTimeout(timer); timer = setTimeout(() => { void persist() }, 300)
}
async function original() {
  if (!(await persist())) throw new Error('请先恢复本机保存后重试')
  const source = clone()
  const id = await saveDemoOriginal(source)
  editor.value.originalId = id; editor.value.originalRevision = source.sourceRevision
  notice.value = '原文已保存到本机。可继续整理或人工核对。'
  changed(); await persist(); emit('saved')
}
async function organize() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    await original()
    editor.value.phase = 'extracting'; changed(); await persist()
    const result = await createDemoApi().extractRecord({ text: editor.value.text, elder_id: editor.value.elderId, expectedEpoch: editor.value.demoEpoch, sourceKey: `${editor.value.localId}:${editor.value.sourceRevision}` })
    editor.value.ai = { draft: result, localId: editor.value.localId, elderId: editor.value.elderId, sourceText: editor.value.text, sourceRevision: editor.value.sourceRevision }
    editor.value.review = { ...editor.value.review, ...result.fields }; editor.value.phase = 'reviewing'
    changed(); await persist(); notice.value = '原文已保存，整理结果已就绪。请逐项核对。'
  } catch (failure) { editor.value.phase = 'editing'; changed(); await persist(); error.value = (failure as Error).message; notice.value = editor.value.originalId ? '原文已保存到本机。可单独重试整理或人工核对。' : '' }
  finally { busy.value = false }
}
async function saveOriginalOnly() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await original() } catch (failure) { error.value = (failure as Error).message }
  finally { busy.value = false }
}
async function confirm() {
  if (busy.value || !editor.value.review.observation.trim() || editor.value.phase === 'submitted') return
  busy.value = true; error.value = ''
  try {
    await original()
    editor.value.phase = 'submitting'; changed()
    if (!(await persist())) throw new Error('提交前保存失败，请重试')
    const result = await saveDemoManualRecord(clone())
    editor.value.confirmedRecordId = result.record_id
    editor.value.phase = 'submitted'; changed(); await persist(); emit('saved')
    notice.value = '记录已确认并保存到本机。后续安排仍需补全责任人与时间后新建任务。'
  } catch (failure) { editor.value.phase = 'editing'; changed(); await persist(); error.value = (failure as Error).message }
  finally { busy.value = false }
}
async function leave() { if (busy.value) return false; return !ready.value || await persist() }
onBeforeRouteLeave(leave); onBeforeRouteUpdate(leave)
onMounted(async () => {
  try {
    const state = await loadDemoState()
    const existing = props.localId ? await loadRecordEditor('demo', session?.accountKey || '', props.localId) : undefined
    if (props.localId && !existing) throw new Error('草稿已变化，请返回草稿列表重试')
    editor.value = existing || createRecordEditor('demo', session?.accountKey || '', props.elderId || (state.elders.length === 1 ? state.elders[0].id : ''))
    editor.value.demoEpoch ||= state.epoch
    if (editor.value.demoEpoch !== state.epoch) throw new Error('演示已重建，请重新选择草稿')
    const elder = state.elders.find(row => row.id === editor.value.elderId)
    if (!elder || (props.elderId && props.elderId !== elder.id)) throw new Error('老人上下文已变化，请返回记录列表重新选择')
    elderLabel.value = `${elder.name} · ${elder.bedLabel}`
    const original = state.originals.find(row => row.localId === `${editor.value.localId}:${editor.value.sourceRevision}` && row.elderId === editor.value.elderId && row.text === editor.value.text)
    const draft = state.drafts.find(row => row.id === original?.draftId)
    if (original) { editor.value.originalId = original.id; editor.value.originalRevision = original.sourceRevision }
    if (draft && !editor.value.ai && editor.value.phase !== 'submitted') {
      editor.value.ai = { draft, localId: editor.value.localId, elderId: editor.value.elderId, sourceText: editor.value.text, sourceRevision: editor.value.sourceRevision }
      editor.value.review = { ...editor.value.review, ...draft.fields }; editor.value.phase = 'reviewing'
    }
    if (['extracting', 'submitting'].includes(editor.value.phase)) editor.value.phase = 'editing'
    saved.value = !!existing; ready.value = true
  } catch (failure) { error.value = (failure as Error).message }
})
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <section class="demo-composer" aria-label="写记录">
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="ready">
      <p>当前记录对象：{{ elderLabel }}</p>
      <label>原文<textarea v-model="editor.text" :disabled="busy || editor.phase === 'submitted'" @input="changed(true)" /></label>
      <p role="status">{{ saved ? '已保存到本机' : '有未保存修改' }} · {{ editor.phase === 'submitted' ? '记录已确认' : editor.phase === 'extracting' ? '正在整理' : '等待核对' }}</p>
      <div v-if="editor.phase !== 'submitted'" class="actions"><button type="button" :disabled="busy || !editor.text.trim()" @click="saveOriginalOnly">保存原文</button><button type="button" :disabled="busy || !editor.text.trim()" @click="organize">{{ busy ? '处理中…' : '保存并查看整理结果' }}</button></div>
      <details v-if="editor.ai"><summary>整理依据与提醒</summary><blockquote>{{ editor.ai.sourceText }}</blockquote><p v-for="warning in editor.ai.draft.warnings" :key="warning">{{ warning }}</p></details>
      <label>人工核对观察<textarea v-model="editor.review.observation" :disabled="busy || editor.phase === 'submitted'" @input="changed()" /></label>
      <p>只保存实际观察。任务须另行核对事项、时间和负责人。</p>
      <button v-if="editor.phase !== 'submitted'" type="button" :disabled="busy || !editor.text.trim() || !editor.review.observation.trim()" @click="confirm">确认并保存记录</button>
      <RouterLink v-else :to="{ path: '/tasks', query: { create: '1', elder: editor.elderId, source_record: editor.confirmedRecordId } }">核对并新建后续任务</RouterLink>
    </template>
  </section>
</template>
<style scoped>
.demo-composer { min-width: 0; } label { display: grid; gap: 8px; margin-block: 16px; } textarea { box-sizing: border-box; min-height: 100px; width: 100%; padding: 10px; font: inherit; color: var(--hl-ink); background: white; border: 1px solid var(--hl-border); border-radius: 6px; } .actions { display: flex; flex-wrap: wrap; gap: 8px; } button { min-height: 44px; padding: 8px 12px; color: var(--hl-primary); background: white; border: 1px solid var(--hl-primary); border-radius: 6px; } button:disabled { opacity: .55; } p { line-height: 1.6; color: var(--hl-muted); } [role='alert'] { color: var(--hl-danger); }
</style>
