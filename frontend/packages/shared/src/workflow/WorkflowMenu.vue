<script setup lang="ts">
import { operationTitle, type WorkflowArea } from './navigation'
import type { Operation } from './model'
defineProps<{
  areas: WorkflowArea[]
  activeArea: string
  activeId: string
  disabled: boolean
  records: boolean
}>()
const emit = defineEmits<{ choose: [Operation] }>()
</script>
<template>
  <nav class="wf-menu" aria-label="功能菜单">
    <template v-for="area in areas" :key="area.id">
      <details v-if="area.id === 'more'" class="wf-menu-group">
        <summary>{{ area.title }}</summary>
        <button
          v-for="op in area.actions"
          :key="op.id"
          type="button"
          class="wf-menu-item"
          :class="{ selected: activeId === op.id }"
          :disabled="disabled"
          @click="emit('choose', op)"
        >
          {{ operationTitle(op) }}
        </button>
      </details>
      <button
        v-else-if="records || area.actions.length === 1"
        type="button"
        class="wf-menu-item wf-menu-primary"
        :class="{ selected: activeArea === area.id }"
        :aria-current="activeArea === area.id ? 'page' : undefined"
        :disabled="disabled"
        @click="emit('choose', area.entry)"
      >
        {{ area.title }}
      </button>
      <details v-else class="wf-menu-group" :open="activeArea === area.id">
        <summary>{{ area.title }}</summary>
        <button
          v-for="op in area.actions"
          :key="op.id"
          type="button"
          class="wf-menu-item"
          :class="{ selected: activeId === op.id }"
          :aria-current="activeId === op.id ? 'page' : undefined"
          :disabled="disabled"
          @click="emit('choose', op)"
        >
          {{ operationTitle(op) }}
        </button>
      </details>
    </template>
  </nav>
</template>
