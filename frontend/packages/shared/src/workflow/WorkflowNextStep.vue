<script setup lang="ts">
import { computed } from 'vue'
import { workflowHint, type WorkflowAction } from './workflow-presentation'
import type { Row } from './model'
const props = defineProps<{ value: Row; catalogs?: Record<string, Row[]>; busy?: boolean }>()
const emit = defineEmits<{ action: [WorkflowAction] }>()
const hint = computed(() => workflowHint(props.value))
const responsible = computed(() => {
  const id = hint.value?.responsibility?.assigned_to
  return id ? props.catalogs?.staff?.find(row => row.id === id)?.display_name || '指定责任人' : ''
})
const roles: Record<string, string> = { admin: '管理员', supervisor: '主管', caregiver: '护理员', nurse: '护士' }
</script>
<template>
  <aside
    v-if="hint"
    class="next-step"
    aria-label="当前状态与下一步"
  >
    <div><strong>{{ hint.state_label || '当前进展' }}</strong><span v-if="responsible">责任人：{{ responsible }}</span><span v-else-if="hint.responsibility?.roles?.length">办理岗位：{{ hint.responsibility.roles.map(role => roles[role] || role).join('、') }}</span></div>
    <p
      v-if="hint.blocked_reason"
      role="status"
    >
      {{ hint.blocked_reason }}
    </p>
    <button
      v-if="hint.primary_action"
      type="button"
      class="wf-primary"
      :disabled="busy"
      @click="emit('action', hint.primary_action)"
    >
      {{ hint.primary_action.label }}
    </button>
    <details v-if="hint.secondary_actions?.length">
      <summary>更多操作</summary><button
        v-for="action in hint.secondary_actions"
        :key="action.code"
        type="button"
        class="wf-secondary"
        :disabled="busy"
        @click="emit('action', action)"
      >
        {{ action.label }}
      </button>
    </details>
  </aside>
</template>
<style scoped>
.next-step{padding:16px;border:1px solid var(--hl-border,#d8e3dc);border-radius:14px;background:var(--hl-primary-soft,#edf5ef);margin:12px 0}.next-step>div{display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center}.next-step strong{font-size:17px}.next-step span,.next-step p{line-height:1.6}.next-step button{margin:10px 8px 0 0;min-height:44px}.next-step summary{padding:12px 0;cursor:pointer}
</style>
