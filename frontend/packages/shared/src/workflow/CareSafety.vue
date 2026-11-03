<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  { context: () => ({}), report: false, recordPath: '/records/new', initialAction: '', focused: true },
)
const emit = defineEmits<{ changed: [] }>()
const apiMode = readSession()?.mode === 'api'
const reporter = ['caregiver', 'nurse'].includes(readSession()?.role || '')
const requestedAction = computed(() => props.initialAction || (typeof props.context.action === 'string' ? props.context.action : ''))
const view = ref<'initial' | 'list' | 'report'>('initial')
const panelKey = ref(0), reportRun = ref(0), notice = ref(''), advancedOpen = ref(false)
const panel = ref<{ canLeave: () => boolean }>()
const showingDetail = ref(!!props.context.incident_id || !!requestedAction.value)
const panelContext = computed(() => {
  if (view.value === 'initial') return props.context
  const context = { ...props.context }
  delete context.incident_id
  delete context.rectification_id
  return { ...context, safety_view: view.value, ...(view.value === 'report' ? { report_run: reportRun.value } : {}) }
})
const entry = computed(
  () =>
    (view.value === 'initial' ? requestedAction.value : '') ||
    (view.value !== 'initial' ? '/incidents' : '') ||
    (props.context.incident_id ? '/incidents/{incident_id}' : '/incidents'),
)
const method = computed(() => view.value === 'list' ? 'get' : view.value === 'report' ? 'post' : reporter && !props.context.incident_id && (!requestedAction.value || requestedAction.value === '/incidents' && props.report) ? 'post' : '')
const shouldRead = computed(() => method.value === 'get' || entry.value === '/incidents/{incident_id}' || /^\/incidents\/INCIDENT-[^/]+$/.test(entry.value) || entry.value === '/incidents' && method.value !== 'post')
const isReport = computed(() => entry.value === '/incidents' && method.value === 'post' && !showingDetail.value)
function navigate(next: 'list' | 'report') {
  if (panel.value && !panel.value.canLeave()) { notice.value = '当前提交回执尚待核实，请先在原表单核实结果。'; return }
  view.value = next; panelKey.value++; showingDetail.value = false; notice.value = ''; advancedOpen.value = false
  if (next === 'report') reportRun.value++
}
watch(() => props.context, () => { view.value = 'initial'; showingDetail.value = !!props.context.incident_id || !!requestedAction.value; panelKey.value++ }, { deep: true })
</script>
<template>
  <section class="care-safety">
    <header class="safety-heading">
      <strong class="safety-badge">紧急安全事件</strong>
      <h1>{{ reporter ? isReport ? '安全事件上报' : '已上报安全事件' : '安全事件处置' }}</h1>
      <p>
        {{
          reporter
            ? '发现异常先联系现场人员，随后上报事实与已采取措施。'
            : '优先查看事件事实和已采取措施，核实后安排分级、整改与复查。'
        }}
      </p>
    </header>
    <p
      v-if="!apiMode"
      role="status"
    >
      当前是虚构演示环境，尚未提供安全事件本机演示；切换服务器账号后可人工上报。
    </p>
    <template v-else>
      <div class="safety-navigation">
        <button
          v-if="showingDetail || isReport"
          type="button"
          @click="navigate('list')"
        >
          {{ showingDetail ? '返回事件清单' : '查看已上报事件' }}
        </button>
        <button
          v-if="reporter && !isReport"
          type="button"
          class="safety-report"
          @click="navigate('report')"
        >
          上报新事件
        </button>
        <p
          v-if="notice"
          role="status"
        >
          {{ notice }}
        </p>
      </div>
      <WorkflowPanel
        :key="panelKey"
        ref="panel"
        group="incidents"
        :focused="focused"
        :context="panelContext"
        :initial-action="entry"
        :initial-method="method"
        :auto-read="shouldRead"
        @select="showingDetail = true"
        @changed="emit('changed')"
      />
      <details
        class="safety-advanced"
        @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary>历史与高级办理</summary><WorkflowPanel
          v-if="advancedOpen"
          group="incidents"
          :context="{ ...context, safety_advanced: true }"
          :focused="false"
          initial-action="/incidents"
          initial-method="get"
          auto-read
          @changed="emit('changed')"
        />
      </details>
    </template>
  </section>
</template>
<style scoped>
.care-safety {
  min-width: 0;
  overflow-wrap: anywhere;
}
.safety-navigation{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0}.safety-navigation button{min-height:44px;padding:9px 14px;border:1px solid #d2ddd5;border-radius:9px;background:white;color:#365d48;font:inherit;cursor:pointer}.safety-navigation .safety-report{background:#b42318;color:white;border-color:#b42318}.safety-advanced{margin-top:24px;border-top:1px solid var(--hl-border,#dce5df)}.safety-advanced>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;padding:10px 0}
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
