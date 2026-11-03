<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadDemoState, subscribeDemo, type DemoStateV2 } from '../demo-store'
import { saveMemoryDecision, saveMemoryReview } from '../demo-memory-actions'
import { formatBusinessTime } from '../business-time'
import { readSession } from '../session'
const props = defineProps<{ elderId: string }>()
const state = ref<DemoStateV2>()
const error = ref(''), notice = ref(''), busy = ref(false)
const edits = ref<Record<string, string>>({}), notes = ref<Record<string, string>>({})
const management = computed(() => ['admin', 'supervisor'].includes(readSession()?.role || ''))
const groups = { habits: '生活习惯', activities: '活动喜好', communication: '沟通方式', recentChanges: '近期变化', attention: '需要留意' }
const memories = computed(() => state.value?.memories.filter(m => m.elderId === props.elderId) || [])
const reviews = computed(() => state.value?.memoryReviews.filter(r => r.elderId === props.elderId) || [])
let ticket = 0
async function load() {
  const current = ++ticket, elder = props.elderId
  try { const value = await loadDemoState(); if (current === ticket && elder === props.elderId) state.value = value }
  catch (e) { if (current === ticket) error.value = (e as Error).message }
}
async function decide(id: string, revision: number, action: 'confirm' | 'reject', content: string) {
  if (!state.value || busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await saveMemoryDecision(state.value.epoch, id, revision, action, edits.value[id] ?? content); delete edits.value[id]; await load(); notice.value = action === 'confirm' ? '已逐条确认，来源与历史已保留。' : '已暂不采用，原文与核对经过已保留。' }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function review(id: string, revision: number, action: 'submit' | 'approve' | 'return') {
  if (!state.value || busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await saveMemoryReview(state.value.epoch, id, revision, action, notes.value[id] || ''); delete notes.value[id]; await load(); notice.value = action === 'submit' ? '核对说明已保存，等待另一位负责人复查。' : action === 'approve' ? '独立复查已完成。' : '已退回重新核对。' }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
watch(() => props.elderId, () => { ticket++; state.value = undefined; edits.value = {}; notes.value = {}; error.value = ''; notice.value = ''; void load() }, { immediate: true })
const unsubscribe = subscribeDemo(() => { void load() })
onMounted(() => window.addEventListener('focus', load))
onBeforeUnmount(() => { ticket++; unsubscribe(); window.removeEventListener('focus', load) })
</script>
<template>
  <section class="understanding" aria-label="了解老人">
    <h2>了解{{ state?.elders.find(e => e.id === elderId)?.name || '他' }}</h2>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="!state && !error" role="status">正在读取生活习惯与核对依据…</p>
    <section v-for="(title, key) in groups" :key="key">
      <h3>{{ title }}</h3>
      <article v-for="memory in memories.filter(m => m.group === key && m.status !== 'rejected')" :key="memory.id" :data-memory="memory.id">
        <strong>{{ memory.content }}</strong>
        <p>{{ memory.kind === 'temporary' ? '临时意愿，仅本次有效' : '长期信息' }} · {{ memory.status === 'confirmed' ? '已人工确认' : '待逐条核对' }}<span v-if="memory.expiresAt"> · {{ formatBusinessTime(memory.expiresAt, true) }}到期</span></p>
        <details><summary>为什么这样建议</summary><blockquote>{{ memory.quote }}</blockquote><p v-for="source in state?.records.filter(r => memory.sourceRecordIds.includes(r.id))" :key="source.id">{{ source.category }} · {{ source.actor }} · {{ formatBusinessTime(source.happenedAt, true) }}</p><p>确认人：{{ memory.confirmedBy || '尚未确认' }}<span v-if="memory.confirmedAt"> · {{ formatBusinessTime(memory.confirmedAt, true) }}</span></p><ol><li v-for="(item, index) in memory.history" :key="index">{{ item.action }} · {{ item.actor }} · {{ formatBusinessTime(item.at, true) }}<p>{{ item.content }}</p></li></ol></details>
        <template v-if="management && memory.status === 'candidate'">
          <label>核对内容<textarea :value="edits[memory.id] ?? memory.content" :disabled="busy" @input="edits[memory.id] = ($event.target as HTMLTextAreaElement).value" /></label>
          <div class="actions"><button type="button" :disabled="busy" @click="decide(memory.id, memory.revision, 'confirm', memory.content)">确认这条</button><button type="button" :disabled="busy" @click="decide(memory.id, memory.revision, 'reject', memory.content)">暂不采用</button></div>
        </template>
      </article>
      <p v-if="!memories.some(m => m.group === key && m.status !== 'rejected')">暂无已确认信息，服务前请询问本人。</p>
    </section>
    <section aria-label="偏好变化核验"><h3>偏好变化核验</h3>
      <article v-for="item in reviews" :key="item.id" :data-review="item.id">
        <strong>{{ item.description }}</strong><p>{{ { pending: '待处理', awaiting_review: '待独立复查', closed: '已处理' }[item.status] }}</p>
        <details><summary>处理经过</summary><p>{{ item.note || '尚未登记核对情况' }}</p><p v-if="item.submittedBy">核对：{{ item.submittedBy }} · {{ formatBusinessTime(item.submittedAt || '', true) }}</p><p v-if="item.reviewedBy">复查：{{ item.reviewedBy }} · {{ formatBusinessTime(item.reviewedAt || '', true) }}</p></details>
        <template v-if="management && item.status !== 'closed'"><label>本次核对情况<textarea v-model="notes[item.id]" :disabled="busy" /></label>
          <button v-if="item.status === 'pending'" type="button" :disabled="busy" @click="review(item.id, item.revision, 'submit')">提交核对，等待复查</button>
          <template v-else-if="item.submittedBy !== readSession()?.accountKey"><div class="actions"><button type="button" :disabled="busy" @click="review(item.id, item.revision, 'approve')">独立复查通过</button><button type="button" :disabled="busy" @click="review(item.id, item.revision, 'return')">退回核对</button></div></template>
          <p v-else>请由另一位主管或管理员独立复查。</p>
        </template>
        <p v-else-if="!management && item.status !== 'closed'">请交由护理主管或管理员核对。</p>
      </article>
    </section>
    <details v-if="memories.some(m => m.status === 'rejected')"><summary>暂不采用的候选</summary><p v-for="memory in memories.filter(m => m.status === 'rejected')" :key="memory.id">{{ memory.content }} · 原文：{{ memory.quote }}</p></details>
  </section>
</template>
<style scoped>
.understanding { min-width: 0; overflow-wrap: anywhere; padding-block: 16px; border-top: 1px solid var(--hl-border); }
h2 { font-size: 20px; } h3 { margin-bottom: 6px; font-size: 16px; }
article { padding: 12px 0; border-bottom: 1px solid var(--hl-border); }
p, summary { color: var(--hl-muted); line-height: 1.6; } summary { cursor: pointer; min-height: 36px; }
blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid var(--hl-primary); }
label { display: grid; gap: 6px; margin-block: 8px; } textarea { box-sizing: border-box; width: 100%; min-height: 72px; padding: 8px; font: inherit; border: 1px solid var(--hl-border); border-radius: 6px; background: white; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; } button { padding: 8px 12px; min-height: 44px; border: 1px solid var(--hl-primary); border-radius: 6px; color: var(--hl-primary); background: white; cursor: pointer; } button:disabled { opacity: .55; }
</style>
