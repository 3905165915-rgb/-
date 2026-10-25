<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { readSession } from '../session'
import { request, display } from './model'
import { memoryCategories, expressors } from './elder-memories'
import { isCareScene, sameCareSession, parseSceneContext, type SceneContext } from './task-care-context'

const props = defineProps<{ elderId: string; scene: string }>()
const context = ref<SceneContext | null>(null)
const loading = ref(false)
const error = ref('')
const owner = readSession()
let epoch = 0
async function load() {
  const ticket = ++epoch
  context.value = null
  error.value = ''
  const session = readSession()
  if (!sameCareSession(owner, session) || session?.mode !== 'api' || !['admin', 'supervisor', 'caregiver'].includes(session.role || '') || !props.elderId || !isCareScene(props.scene)) {
    loading.value = false
    return
  }
  const elder = props.elderId, scene = props.scene
  loading.value = true
  try {
    const value = await request(`/memories/context?elder_id=${encodeURIComponent(elder)}&scene=${encodeURIComponent(scene)}`)
    if (ticket !== epoch || !sameCareSession(readSession(), session)) return
    context.value = parseSceneContext(value, elder, scene)
  } catch {
    if (ticket === epoch && sameCareSession(readSession(), session)) error.value = '照护提示暂未读取成功，请刷新核对；可以继续登记事实。'
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function revoke() { epoch++; context.value = null; loading.value = false; error.value = '登录或权限已变化，请重新读取提示。' }
function checkSession() { if (!sameCareSession(owner, readSession())) revoke() }
watch(() => [props.elderId, props.scene], load, { immediate: true, flush: 'sync' })
onMounted(() => { window.addEventListener('hulao:unauthorized', revoke); window.addEventListener('storage', checkSession); window.addEventListener('focus', checkSession) })
onBeforeUnmount(() => { epoch++; window.removeEventListener('hulao:unauthorized', revoke); window.removeEventListener('storage', checkSession); window.removeEventListener('focus', checkSession) })
</script>
<template>
  <aside v-if="elderId && isCareScene(scene)" class="wf-care-hints" aria-label="本次服务提示">
    <header class="wf-toolbar"><h4>本次服务提示</h4><button class="wf-secondary" type="button" :disabled="loading" @click="load">刷新提示</button></header>
    <p v-if="loading" role="status">正在读取已确认的照护记忆，无需等待模型整理。</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="context && !context.memories.length" class="wf-muted">当前场景还没有有效的个性化记忆，请以本人当次意愿和正式计划为准。</p>
    <article v-for="memory in context?.memories || []" :key="memory.id">
      <p><strong>{{ memory.content }}</strong></p><p>{{ memoryCategories[memory.category as keyof typeof memoryCategories] }} · {{ expressors[memory.attributed_to as keyof typeof expressors] }}</p>
      <p v-if="memory.review_due" class="wf-notice">已到建议复核时间，请与本人核实，不代表偏好自动失效。</p>
      <details><summary>查看确认和原文依据</summary><blockquote>{{ memory.source.quote }}</blockquote><p>来源记录：{{ memory.source.record_id }} · 第{{ memory.source.revision }}版</p><p>确认者：{{ memory.confirmed_by }}；确认时间：{{ display(memory.confirmed_at) }}</p><p>有效期：{{ display(memory.valid_from) }} 起；{{ memory.expires_at ? display(memory.expires_at) + ' 止' : '未设置结束时间' }}</p><p>建议复核：{{ memory.review_due_at ? display(memory.review_due_at) : '未设置' }}</p></details>
    </article>
    <p class="wf-muted">这些是经人工确认的生活提示，不代表本次服务已经完成；本人当次意愿优先。</p>
  </aside>
</template>
