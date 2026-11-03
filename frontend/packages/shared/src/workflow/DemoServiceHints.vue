<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { loadDemoState, subscribeDemo, type DemoStateV2 } from '../demo-store'
import type { Task } from '../types'
const props = defineProps<{ task?: Task | null; mobile?: boolean }>()
const state = ref<DemoStateV2>(), error = ref('')
let ticket = 0
async function load() { const id = ++ticket; try { const next = await loadDemoState(); if (id === ticket) { state.value = next; error.value = '' } } catch (failure) { if (id === ticket) error.value = (failure as Error).message } }
const hints = computed(() => (state.value?.memories || []).filter(memory => {
  if (memory.elderId !== props.task?.elderId || memory.status !== 'confirmed') return false
  if (memory.kind === 'temporary' && (!memory.expiresAt || Date.parse(memory.expiresAt) <= Date.now())) return false
  if (!memory.sourceRecordIds.length || memory.sourceRecordIds.some(id => !state.value?.records.some(record => record.id === id && record.elderId === memory.elderId && record.content.includes(memory.quote)))) return false
  return memory.group === 'communication' || (props.task?.scene === 'activity' && ['activities', 'recentChanges'].includes(memory.group)) || (props.task?.scene === 'rest' && ['habits', 'recentChanges'].includes(memory.group))
}))
watch(() => props.task?.id, load, { immediate: true })
const unsubscribe = subscribeDemo(load)
onBeforeUnmount(() => { ticket++; unsubscribe() })
function source(id: string) { return { path: props.mobile ? '/records' : '/workflows/records', query: { tab: 'history', elder_id: props.task?.elderId, record_id: id } } }
</script>
<template>
  <section v-if="task" class="service-hints" aria-label="本次服务提示"><h2>本次服务提示</h2><p v-if="error" role="alert">提示未载入：{{ error }}</p><p v-else-if="!state">正在读取…</p><template v-else><article v-for="hint in hints" :key="hint.id"><strong>{{ hint.kind === 'temporary' ? '本次临时意愿' : '已确认习惯' }}</strong><p>{{ hint.content }}</p><details><summary>原文依据</summary><blockquote>{{ hint.quote }}</blockquote><RouterLink v-for="id in hint.sourceRecordIds" :key="id" :to="source(id)">查看来源记录</RouterLink></details></article><p v-if="!hints.length">暂无已确认且适用于本次服务的提示，办理前请询问本人意愿。</p></template></section>
</template>
<style scoped>
.service-hints { padding: 14px; background: var(--hl-primary-soft); border-radius: 8px; margin-block: 12px; min-width: 0; overflow-wrap: anywhere; } h2 { font-size: 16px; margin: 0 0 10px; } p { margin: 6px 0; line-height: 1.6; } article + article { margin-top: 12px; } summary, blockquote { color: var(--hl-muted); } blockquote { margin: 10px 0; } a { display: inline-flex; min-height: 44px; align-items: center; }
</style>
