<script setup lang="ts">
import { computed } from 'vue'
import { label, display, type Row } from './model'
const props = withDefaults(defineProps<{ value: unknown; depth?: number }>(), {
  depth: 0,
})
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
</script>
<template>
  <div v-if="array" class="wf-result-list">
    <p v-if="!array.length" class="wf-muted">暂无记录</p>
    <article v-for="(item, index) in array" :key="index" class="wf-result-item">
      <WorkflowResult
        :value="item"
        :depth="depth + 1"
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
      {{
        object.status === 'draft' && Array.isArray(object.items)
          ? Number(object.revision || 0) < 1
            ? '刷新交班事项'
            : '填写注意事项并提交交班'
          : '选择此项办理后续'
      }}
    </button>
    <template v-for="(item, key) in object" :key="key">
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
          >{{ display(item, String(key)) }}</strong
        >
      </div>
    </template>
  </div>
  <p v-else class="wf-result-scalar">{{ display(value) }}</p>
</template>
