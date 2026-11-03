<script setup lang="ts">
import { computed } from 'vue'
import { resultActionLabel } from './result-actions'
import { label, display, optionLabel, resourceFor, type Row } from './model'
const props = withDefaults(
  defineProps<{
    value: unknown
    depth?: number
    catalogs?: Record<string, Row[]>
  }>(),
  {
    depth: 0,
    catalogs: () => ({}),
  },
)
const emit = defineEmits<{ select: [Row] }>()
const array = computed(() => (Array.isArray(props.value) ? props.value : null))
const object = computed(() =>
  props.value && typeof props.value === 'object' && !Array.isArray(props.value)
    ? (props.value as Row)
    : null,
)
const omit = new Set([
  'id',
  'password',
  'password_hash',
  'access_token',
  'token_version',
])
const task = computed(
  () =>
    object.value &&
    typeof object.value.id === 'string' &&
    typeof object.value.title === 'string' &&
    typeof object.value.elder_id === 'string' &&
    typeof object.value.status === 'string' &&
    ('assigned_to' in object.value || 'due_at' in object.value),
)
const primaryKeys = [
  'title',
  'elder_id',
  'assigned_to',
  'due_at',
  'status',
  'condition',
  'completion_criteria',
  'result',
  'warnings',
]
const hasValue = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  (!Array.isArray(value) || value.length > 0)
const primary = computed(() =>
  Object.fromEntries(
    primaryKeys
      .filter((key) => object.value && hasValue(object.value[key]))
      .map((key) => [key, object.value![key]]),
  ),
)
const secondary = computed(() =>
  Object.fromEntries(
    Object.entries(object.value || {}).filter(
      ([key, value]) =>
        !omit.has(key) && !primaryKeys.includes(key) && hasValue(value),
    ),
  ),
)
function readable(value: unknown, field: string) {
  const resource = resourceFor[field]
  const choices = props.catalogs[resource] || []
  const row = choices.find((item) => item.id === value)
  return row
    ? optionLabel(field, row, choices, props.catalogs)
    : display(value, field)
}
</script>
<template>
  <div v-if="array" class="wf-result-list">
    <p v-if="!array.length" class="wf-muted">暂无记录</p>
    <article v-for="(item, index) in array" :key="index" class="wf-result-item">
      <WorkflowResult
        :value="item"
        :depth="depth + 1"
        :catalogs="catalogs"
        @select="emit('select', $event)"
      />
    </article>
  </div>
  <div v-else-if="object" class="wf-result-object">
    <button
      v-if="object.id || object.occurrence_key"
      class="wf-secondary wf-select-row"
      type="button"
      @click="emit('select', object)"
    >
      {{ resultActionLabel(object) }}
    </button>
    <template v-if="task">
      <WorkflowResult
        :key="String(object.id) + '-summary'"
        :value="primary"
        :depth="depth + 1"
        :catalogs="catalogs"
        @select="emit('select', $event)"
      />
      <details
        :key="String(object.id) + '-details'"
        class="wf-result-details wf-task-more"
      >
        <summary>来源、版本与更多信息</summary>
        <WorkflowResult
          :value="{ task_reference: object.id, ...secondary }"
          :depth="depth + 1"
          :catalogs="catalogs"
          @select="emit('select', $event)"
        />
      </details>
    </template>
    <template v-for="(item, key) in task ? {} : object" :key="key">
      <details
        v-if="
          !omit.has(String(key)) &&
          item &&
          typeof item === 'object' &&
          (!Array.isArray(item) || item.length > 0)
        "
        :open="
          depth < 2 ||
          [
            'evidence',
            'citations',
            'issues',
            'warnings',
            'memory_candidates',
          ].includes(String(key))
        "
        class="wf-result-details"
      >
        <summary>
          {{ label(String(key))
          }}{{ Array.isArray(item) ? '（' + item.length + '）' : '' }}
        </summary>
        <WorkflowResult
          :value="item"
          :depth="depth + 1"
          :catalogs="catalogs"
          @select="emit('select', $event)"
        />
      </details>
      <div v-else-if="!omit.has(String(key))" class="wf-result-line">
        <span>{{ label(String(key)) }}</span
        ><strong
          :class="{
            'wf-evidence': [
              'quote',
              'source_quote',
              'raw_text',
              'snapshot_text',
            ].includes(String(key)),
          }"
          >{{ readable(item, String(key)) }}</strong
        >
      </div>
    </template>
  </div>
  <p v-else class="wf-result-scalar">
    {{ display(value) }}
  </p>
</template>
