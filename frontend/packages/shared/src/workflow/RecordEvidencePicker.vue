<script setup lang="ts">
import { computed } from 'vue'
import type { Row } from './model'
import { chooseRecordEvidence, eligibleRecordEvidence } from './record-evidence'

const props = defineProps<{ modelValue: Row; records: Row[]; path: string }>()
const emit = defineEmits<{ 'update:modelValue': [Row] }>()
const available = computed(() => eligibleRecordEvidence(props.records, props.modelValue.elder_id))
const selected = computed(() => available.value.find(row => row.id === props.modelValue.source_record_id))
const observations = computed(() => (selected.value?.observations || []) as string[])
const current = computed(() => selected.value && selected.value.revision === props.modelValue.source_revision)
function choose(event: Event) {
  emit('update:modelValue', chooseRecordEvidence(props.modelValue, available.value.find(row => row.id === (event.target as HTMLSelectElement).value)))
}
const date = (row: Row) => new Date(String(row.happened_at || row.created_at)).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
</script>
<template>
  <div class="wf-evidence-picker">
    <label class="wf-field" :data-field="path + '.source_record_id'">
      <span>选择原始照护记录 <b>*</b></span>
      <select :value="modelValue.source_record_id || ''" @change="choose">
        <option value="">请选择这位老人的正式记录</option>
        <option v-for="row in available" :key="String(row.id)" :value="row.id">{{ date(row) }} · {{ String((row.observations as string[])[0]).slice(0, 55) }}</option>
      </select>
    </label>
    <p v-if="!available.length" class="wf-muted">请先选择老人；若没有正式记录，先在“记录”中保存事实。</p>
    <p v-if="selected && current" class="wf-muted">已自动关联当前记录版本，无需填写版本号。请选择支持本条记忆的原文。</p>
    <p v-if="selected && !current" role="alert" class="wf-notice">来源记录已变化，请重新选择记录、核对原文后提交。</p>
    <label v-if="selected" class="wf-field" :data-field="path + '.source_quote'">
      <span>作为依据的原文 <b>*</b></span>
      <select :value="modelValue.source_quote || ''" @change="emit('update:modelValue', { ...modelValue, source_quote: ($event.target as HTMLSelectElement).value })">
        <option value="">请选择对应的已核对观察</option>
        <option v-if="modelValue.source_quote && !observations.includes(String(modelValue.source_quote))" :value="String(modelValue.source_quote)" disabled>原引用需重新核对</option>
        <option v-for="(quote, i) in observations" :key="i" :value="quote">{{ quote }}</option>
      </select>
    </label>
    <blockquote v-if="modelValue.source_quote">{{ modelValue.source_quote }}</blockquote>
  </div>
</template>
