<script setup lang="ts">
import { computed } from 'vue'
import {
  type Schema,
  type Row,
  resolveSchema,
  initial,
  label,
  display,
  resourceFor,
  rowName,
} from './model'
const props = defineProps<{
  schema: Schema
  modelValue: unknown
  field: string
  required?: boolean
  catalogs: Record<string, Row[]>
  optionOverrides?: Record<string, Row[]>
  path?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [unknown] }>()
const schema = computed(() => resolveSchema(props.schema))
const fieldPath = computed(() => props.path || props.field)
const readonlyVersion = computed(() => /^(expected_.*(?:revision|fingerprint)|source_revision|revision)$/.test(props.field))
const inputValue = computed(() => {
  const value = props.modelValue
  if (schema.value.format !== 'date-time' || typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value)) return value ?? ''
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return ''
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 19)
})
const options = computed(
  () => props.optionOverrides?.[props.field] ?? props.catalogs[resourceFor[props.field] || ''] ?? [],
)
const object = computed(
  () =>
    (props.modelValue && typeof props.modelValue === 'object'
      ? props.modelValue
      : {}) as Row,
)
const array = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue : [],
)
function updateField(key: string, value: unknown) {
  const next = { ...object.value, [key]: value }
  if (key === 'record_id') {
    const source = props.catalogs.records?.find((row) => row.id === value)
    if (source) {
      next.revision = source.revision
      next.field = 'observations'
      next.quote = (source.observations as string[])?.[0] || ''
    }
  }
  emit('update:modelValue', next)
}
function input(event: Event) {
  const node = event.target as HTMLInputElement
  emit(
    'update:modelValue',
    schema.value.type === 'boolean'
      ? node.value === ''
        ? ''
        : node.value === 'true'
      : node.value,
  )
}
function setItem(index: number, value: unknown) {
  const next = [...array.value]
  next[index] = value
  emit('update:modelValue', next)
}
function add() {
  emit('update:modelValue', [
    ...array.value,
    initial(schema.value.items || {}, props.field),
  ])
}
function remove(index: number) {
  emit(
    'update:modelValue',
    array.value.filter((_, i) => i !== index),
  )
}
const inputType = computed(() =>
  schema.value.format === 'date-time'
    ? 'datetime-local'
    : schema.value.format === 'date'
      ? 'date'
      : props.field === 'password'
        ? 'password'
        : ['integer', 'number'].includes(schema.value.type || '')
          ? 'number'
          : 'text',
)
const longText = computed(() =>
  /text|observations|quote|content|reason|note|summary|instruction|description|goal|result|basis|criterion|criteria|reply|plan$/.test(
    props.field,
  ),
)
const primitiveOptions = computed(
  () => schema.value.enum || (schema.value.const ? [schema.value.const] : []),
)
</script>
<template>
  <fieldset
    v-if="schema.type === 'object'"
    class="wf-fieldset"
    :data-field="fieldPath"
  >
    <legend>{{ label(field) }}<span v-if="required"> *</span></legend>
    <WorkflowField
      v-for="(child, key) in schema.properties"
      :key="key"
      :schema="child"
      :field="String(key)"
      :path="fieldPath + '.' + key"
      :required="schema.required?.includes(String(key))"
      :model-value="object[key]"
      :catalogs="catalogs"
      :option-overrides="optionOverrides"
      @update:model-value="updateField(String(key), $event)"
    />
  </fieldset>
  <fieldset
    v-else-if="schema.type === 'array'"
    class="wf-fieldset"
    :data-field="fieldPath"
  >
    <legend>{{ label(field) }}<span v-if="required"> *</span></legend>
    <div v-for="(item, index) in array" :key="index" class="wf-array-item">
      <WorkflowField
        :schema="schema.items || {}"
        :field="field"
        :path="fieldPath + '.' + index"
        :model-value="item"
        :required="true"
        :catalogs="catalogs"
        :option-overrides="optionOverrides"
        @update:model-value="setItem(index, $event)"
      />
      <button
        type="button"
        class="wf-secondary"
        :aria-label="'移除' + label(field) + (index + 1)"
        @click="remove(index)"
      >
        移除
      </button>
    </div>
    <button
      type="button"
      class="wf-secondary"
      :disabled="!!schema.maxItems && array.length >= schema.maxItems"
      @click="add"
    >
      添加{{ label(field) }}
    </button>
  </fieldset>
  <label v-else class="wf-field" :data-field="fieldPath">
    <span>{{ label(field) }}<b v-if="required"> *</b></span>
    <select
      v-if="primitiveOptions.length"
      :value="modelValue ?? ''"
      @change="input"
    >
      <option value="">请选择</option>
      <option
        v-for="value in primitiveOptions"
        :key="String(value)"
        :value="value"
      >
        {{ display(value) }}
      </option>
    </select>
    <select
      v-else-if="resourceFor[field]"
      :value="modelValue ?? ''"
      @change="input"
    >
      <option value="">请选择{{ label(field) }}</option>
      <option
        v-if="optionOverrides?.[field] && modelValue && !options.some(row => row.id === modelValue)"
        :value="String(modelValue)"
        disabled
      >原选项不可用于本次操作，请重新选择</option>
      <option v-for="row in options" :key="String(row.id)" :value="row.id">
        {{ rowName(row) }}{{ row.bed_label ? ' · ' + row.bed_label : '' }} · {{ row.id
        }}{{ row.status ? ' · ' + display(row.status) : '' }}
      </option>
    </select>
    <select
      v-else-if="schema.type === 'boolean'"
      :value="modelValue === '' || modelValue == null ? '' : String(modelValue)"
      @change="input"
    >
      <option value="">请选择（不修改）</option>
      <option value="true">是</option>
      <option value="false">否</option>
    </select>
    <textarea
      v-else-if="longText"
      :value="String(modelValue ?? '')"
      :maxlength="schema.maxLength"
      rows="3"
      @input="input"
    />
    <input
      v-else
      :type="inputType"
      :value="inputValue"
      :readonly="readonlyVersion"
      :min="schema.minimum"
      :max="schema.maximum"
      :maxlength="schema.maxLength"
      :step="
        schema.type === 'integer' || schema.format === 'date-time'
          ? 1
          : undefined
      "
      @input="input"
    />
  </label>
</template>
