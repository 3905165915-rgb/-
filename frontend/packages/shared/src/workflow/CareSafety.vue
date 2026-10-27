<script setup lang="ts">
import WorkflowPanel from './WorkflowPanel.vue'
import { readSession } from '../session'
import type { Row } from './model'
withDefaults(defineProps<{ context?: Row; report?: boolean; recordPath?: string; initialAction?: string; focused?: boolean }>(), { context: () => ({}), report: false, recordPath: '/records/new' })
const emit=defineEmits<{changed:[]}>()
const apiMode = readSession()?.mode === 'api'
</script>
<template>
  <section class="care-safety">
    <h1>照护安全与事件上报</h1>
    <p>登记事实、已采取措施及依据，接续人工分级、整改和独立复查。</p>
    <RouterLink :to="{ path: recordPath, query: { elder: String(context.elder_id || ''), elder_id: String(context.elder_id || '') } }" class="wf-secondary">先人工记一条事实</RouterLink>
    <p v-if="!apiMode" role="status">当前是虚构演示环境，尚未提供安全事件本机演示；切换服务器账号后可人工上报。</p>
    <WorkflowPanel v-else group="incidents" :focused="focused" :context="context" :initial-action="initialAction || (context.incident_id ? '/incidents/{incident_id}' : '/incidents')" :auto-read="!initialAction && (!!context.incident_id || !report)" @changed="emit('changed')" />
  </section>
</template>
<style scoped>
.care-safety { min-width: 0; overflow-wrap: anywhere; }
.care-safety > a { display: inline-flex; align-items: center; min-height: 44px; padding: 8px 12px; margin-bottom: 12px; color: var(--hl-primary, #1767cf); background: var(--hl-primary-soft, #edf4fe); border: 1px solid var(--hl-border, #dce3e7); border-radius: 6px; text-decoration: none; }
</style>
