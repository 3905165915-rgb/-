<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadDemoState, subscribeDemo, type DemoStateV2 } from '../demo-store'
import { createRecordEditor, type RecordEditor } from '../editor'
import { listRecordEditors, saveRecordEditor } from '../storage'
import { readSession } from '../session'
import { formatBusinessTime } from '../business-time'
import type { RecordDraft } from '../types'
import DemoRecordComposer from './DemoRecordComposer.vue'
const props = withDefaults(defineProps<{ mobile?: boolean }>(), { mobile: false })
const route = useRoute(), router = useRouter()
const state = ref<DemoStateV2>(), locals = ref<RecordEditor[]>([])
const error = ref(''), busy = ref(false), loaded = ref(false)
const search = ref(''), category = ref(''), period = ref(route.query.record_id ? 'all' : '30')
watch(() => route.query.record_id, id => { if (id) { period.value = 'all'; search.value = category.value = '' } })
const tab = computed(() => ['drafts', 'history'].includes(String(route.query.tab)) ? String(route.query.tab) : route.query.record_id ? 'history' : 'write')
const elderId = computed(() => String(route.query.elder_id || route.query.elder || (state.value?.elders.length === 1 ? state.value.elders[0].id : '')))
const records = computed(() => (state.value?.records || []).filter(row => row.elderId === elderId.value && (!route.query.record_id || row.id === route.query.record_id) && (!category.value || row.category === category.value) && (!search.value.trim() || `${row.title} ${row.content}`.includes(search.value.trim())) && (period.value === 'all' || Date.parse(row.happenedAt) >= Date.now() - Number(period.value) * 86400000)).sort((a, b) => Date.parse(b.happenedAt) - Date.parse(a.happenedAt)))
const localDrafts = computed(() => locals.value.filter(row => row.elderId === elderId.value && !['submitted', 'discarded_local'].includes(row.phase)))
const candidates = computed(() => state.value?.drafts.filter(row => row.elderId === elderId.value && row.status === 'pending_review' && !locals.value.some(local => local.ai?.draft.id === row.id)) || [])
let ticket = 0
async function load() {
  const current = ++ticket
  try {
    const session = readSession()
    const snapshot = await loadDemoState()
    const drafts = await listRecordEditors('demo', session?.accountKey || '')
    if (current !== ticket || session?.accountKey !== readSession()?.accountKey) return
    state.value = snapshot; locals.value = drafts; error.value = ''; loaded.value = true
  } catch (failure) { if (current === ticket) { error.value = (failure as Error).message; loaded.value = true } }
}
const location = (value: string) => ({ path: route.path, query: { ...route.query, tab: value, record_id: undefined, draft: undefined, elder_id: elderId.value } })
async function restore(localId: string) {
  await router.push(props.mobile ? { path: '/records/new', query: { draft: localId, elder: elderId.value } } : { ...location('write'), query: { ...location('write').query, draft: localId } })
}
async function openCandidate(draft: RecordDraft) {
  if (!state.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const existing = locals.value.find(local => local.ai?.draft.id === draft.id)
    if (existing) { await restore(existing.localId); return }
    const editor = createRecordEditor('demo', readSession()?.accountKey || '', draft.elderId)
    editor.demoEpoch = state.value.epoch; editor.text = draft.originalText
    editor.ai = { draft: { ...draft, demoEpoch: state.value.epoch }, localId: editor.localId, elderId: editor.elderId, sourceText: editor.text, sourceRevision: editor.sourceRevision }
    editor.review = { ...editor.review, ...draft.fields }; editor.phase = 'reviewing'
    await saveRecordEditor(editor); await restore(editor.localId)
  } catch (failure) { error.value = (failure as Error).message }
  finally { busy.value = false }
}
watch(() => [route.query.elder, route.query.elder_id], () => { search.value = category.value = ''; void load() }, { immediate: true })
const unsubscribe = subscribeDemo(() => { void load() })
onBeforeUnmount(() => { ticket++; unsubscribe() })
</script>
<template>
  <section class="demo-records" aria-label="记录">
    <nav class="record-tabs" aria-label="记录内部导航"><RouterLink v-for="(label, key) in { write: '写记录', drafts: '草稿', history: '历史' }" :key="key" :to="location(key)" :class="{ active: tab === key }">{{ label }}</RouterLink></nav>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="load">重试</button></p><p v-if="!loaded">正在读取记录…</p>
    <template v-else-if="tab === 'write'">
      <template v-if="mobile"><h2>写一条记录</h2><p>先保存原文，再在当前页面核对整理结果。</p><RouterLink class="primary-link" :to="{ path: '/records/new', query: { elder: elderId } }">开始记录</RouterLink></template>
      <DemoRecordComposer v-else :key="String(route.query.draft || elderId)" :elder-id="elderId" :local-id="typeof route.query.draft === 'string' ? route.query.draft : undefined" @saved="load" />
    </template>
    <section v-else-if="tab === 'drafts'" class="record-list"><h2>本机草稿与待核对内容</h2>
      <article v-for="local in localDrafts" :key="local.localId"><strong>{{ local.text.slice(0, 60) || '空白草稿' }}</strong><p>保存于 {{ formatBusinessTime(local.updatedAt, true) }} · {{ local.phase === 'uncertain' ? '结果待核实，请勿重复提交' : '未完成核对' }}</p><button type="button" @click="restore(local.localId)">继续编辑</button></article>
      <article v-for="draft in candidates" :key="draft.id"><strong>{{ draft.originalText }}</strong><p>整理结果待人工核对</p><button type="button" :disabled="busy" @click="openCandidate(draft)">继续核对</button></article>
      <p v-if="!localDrafts.length && !candidates.length && !error">暂无待核对草稿。</p>
    </section>
    <section v-else class="record-list"><h2>已保存历史</h2>
      <div class="filters"><label>搜索内容<input v-model="search" type="search" /></label><label>记录类型<select v-model="category"><option value="">全部类型</option><option>本人表达</option><option>护理观察</option><option>家属补充</option></select></label><label>时间范围<select v-model="period"><option value="7">近7天</option><option value="30">近30天</option><option value="all">全部</option></select></label><button type="button" @click="search = category = ''; period = 'all'">重置筛选</button></div>
      <article v-for="record in records" :key="record.id"><strong>{{ record.title }}</strong><p>{{ record.content }}</p><span>{{ record.category }} · {{ formatBusinessTime(record.happenedAt) }}</span><details><summary>完整时间与登记信息</summary><p>发生：{{ formatBusinessTime(record.happenedAt, true) }}</p><p>登记：{{ formatBusinessTime(record.enteredAt, true) }} · {{ record.actor }}</p></details></article>
      <p v-if="!records.length && !error">当前筛选没有记录，可调整时间或类型。</p>
    </section>
  </section>
</template>
<style scoped>
.demo-records { min-width: 0; overflow-wrap: anywhere; } .record-tabs { display: flex; gap: 4px; padding: 4px; margin: 12px 0 20px; background: var(--hl-surface); border: 1px solid var(--hl-border); border-radius: 8px; } .record-tabs a { flex: 1; min-height: 42px; display: grid; place-items: center; color: var(--hl-muted); } .record-tabs a.active { color: var(--hl-primary); background: var(--hl-primary-soft); font-weight: 600; } article { display: grid; gap: 6px; padding: 14px 0; border-bottom: 1px solid var(--hl-border); } article p { margin: 0; line-height: 1.6; } .filters { display: flex; flex-wrap: wrap; gap: 10px; } label { display: grid; gap: 6px; max-width: 100%; } input, select { box-sizing: border-box; min-height: 40px; max-width: 100%; padding: 8px; border: 1px solid var(--hl-border); border-radius: 6px; font: inherit; background: white; } button, .primary-link { display: inline-flex; align-items: center; justify-content: center; width: fit-content; min-height: 44px; padding: 6px 12px; border: 1px solid var(--hl-primary); border-radius: 6px; color: var(--hl-primary); background: white; cursor: pointer; } p, span, summary { color: var(--hl-muted); } h2 { font-size: 18px; }
</style>
