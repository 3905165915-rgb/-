<script setup lang="ts">
import { computed } from 'vue'
import WorkflowPanel from './WorkflowPanel.vue'
import { readSession } from '../session'
import type { Row } from './model'
const props = withDefaults(
  defineProps<{
    context?: Row
    report?: boolean
    recordPath?: string
    initialAction?: string
    focused?: boolean
  }>(),
  { context: () => ({}), report: false, recordPath: '/records/new' },
)
const emit = defineEmits<{ changed: [] }>()
const apiMode = readSession()?.mode === 'api'
const reporter = ['caregiver', 'nurse'].includes(readSession()?.role || '')
const entry = computed(
  () =>
    props.initialAction ||
    (props.context.incident_id ? '/incidents/{incident_id}' : '/incidents'),
)
</script>
<template>
  <section class="care-safety">
    <header class="safety-heading">
      <strong class="safety-badge">紧急安全事件</strong>
      <h1>{{ reporter ? '安全事件上报' : '安全事件处置' }}</h1>
      <p>
        {{
          reporter
            ? '发现异常先联系现场人员，随后上报事实与已采取措施。'
            : '优先查看事件事实和已采取措施，核实后安排分级、整改与复查。'
        }}
      </p>
    </header>
    <p v-if="!apiMode" role="status">
      当前是虚构演示环境，尚未提供安全事件本机演示；切换服务器账号后可人工上报。
    </p>
    <WorkflowPanel
      v-else
      group="incidents"
      :focused="focused"
      :context="context"
      :initial-action="entry"
      :initial-method="
        reporter && !context.incident_id && !initialAction ? 'post' : ''
      "
      :auto-read="
        entry === '/incidents/{incident_id}' || (!reporter && !initialAction)
      "
      @changed="emit('changed')"
    />
  </section>
</template>
<style scoped>
.care-safety {
  min-width: 0;
  overflow-wrap: anywhere;
}
.safety-heading {
  border-left: 5px solid #b42318;
  background: #fff1ef;
  padding: 18px 20px;
  margin-bottom: 20px;
  border-radius: 8px;
  color: #7a271a;
}
.safety-heading h1 {
  margin: 8px 0;
}
.safety-heading p {
  margin: 0;
  line-height: 1.7;
}
.safety-badge {
  display: inline-flex;
  background: #b42318;
  color: white;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 14px;
}
.care-safety > a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  margin-bottom: 12px;
  color: var(--hl-primary, #1767cf);
  background: var(--hl-primary-soft, #edf4fe);
  border: 1px solid var(--hl-border, #dce3e7);
  border-radius: 6px;
  text-decoration: none;
}
</style>
