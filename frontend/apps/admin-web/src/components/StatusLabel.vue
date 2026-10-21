<script setup lang="ts">
import { computed } from 'vue'
import {
  aiDraftStatusMeta,
  familyCaseStatusMeta,
  handoverDisplayStatusMeta,
  resolveStatus,
  taskStatusMeta,
} from '@hulao/shared'

const props = withDefaults(
  defineProps<{
    status: unknown
    kind?: 'task' | 'family' | 'draft' | 'handover'
  }>(),
  { kind: 'task' },
)
const meta = computed(() => {
  switch (props.kind) {
    case 'family':
      return resolveStatus(familyCaseStatusMeta, props.status)
    case 'draft':
      return resolveStatus(aiDraftStatusMeta, props.status)
    case 'handover':
      return resolveStatus(handoverDisplayStatusMeta, props.status)
    default:
      return resolveStatus(taskStatusMeta, props.status)
  }
})
</script>

<template>
  <span
    class="status-label"
    :class="'status-' + meta.tone"
    :title="meta.known ? undefined : String(status)"
  >
    <span
      class="status-dot"
      aria-hidden="true"
    />{{ meta.label }}
  </span>
</template>
