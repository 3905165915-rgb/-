<script setup lang="ts">
import { computed } from 'vue'
import { display, type Row } from './model'
import WorkflowResult from './WorkflowResult.vue'
const props = defineProps<{ value: unknown; catalogs: Record<string, Row[]> }>()
const emit = defineEmits<{ select: [Row] }>()
const rows = computed(() => {
  const value = props.value
  if (Array.isArray(value)) return value as Row[]
  if (!value || typeof value !== 'object') return null
  const obj = value as Row
  if (obj.record && typeof obj.record === 'object') return [obj.record as Row]
  return typeof obj.id === 'string' && /^(AI|REC)-/.test(obj.id) ? [obj] : null
})
const linkedTasks = computed(() => ((props.value as Row)?.tasks || []) as Row[])
const isDraft = (row: Row) => String(row.id).startsWith('AI-')
const elderName = (row: Row) =>
  String(
    props.catalogs.elders?.find((elder) => elder.id === row.elder_id)?.name ||
      '老人信息待核对',
  )
const observations = (row: Row) =>
  Array.isArray(row.observations) ? (row.observations as string[]) : []
const content = (row: Row) =>
  observations(row).join('；') || String(row.raw_text || '暂无内容')
const evidenceFields = (row: Row) =>
  Object.fromEntries(
    [
      'evidence',
      'warnings',
      'ambiguity',
      'missing',
      'context_notes',
      'memory_candidates',
    ]
      .filter(
        (key) => Array.isArray(row[key]) && (row[key] as unknown[]).length,
      )
      .map((key) => [key, row[key]]),
  )
</script>
<template>
  <div v-if="rows" class="wf-record-cards">
    <p v-if="!rows.length" class="wf-muted">暂无记录</p>
    <article v-for="row in rows" :key="String(row.id)" class="wf-record-card">
      <header class="wf-record-card-header">
        <strong>{{ elderName(row) }}</strong>
        <span class="wf-record-status">{{
          display(row.status || (isDraft(row) ? 'pending_review' : 'confirmed'))
        }}</span>
      </header>
      <p class="wf-muted">{{ display(row.created_at, 'created_at') }}</p>
      <p class="wf-record-preview">{{ content(row) }}</p>
      <p
        v-if="isDraft(row) && row.status === 'pending_review'"
        class="wf-muted"
      >
        整理结果尚待人工核对，不代表已完成服务。
      </p>
      <button
        type="button"
        class="wf-secondary wf-select-row"
        @click="emit('select', row)"
      >
        {{ isDraft(row) ? '打开草稿' : '查看记录' }}
      </button>
      <details class="wf-result-details" :open="isDraft(row)">
        <summary>原文与核对依据</summary>
        <p class="wf-evidence wf-record-preview">{{ row.raw_text }}</p>
        <WorkflowResult
          v-if="Object.keys(evidenceFields(row)).length"
          :value="evidenceFields(row)"
        />
      </details>
      <details
        v-if="Array.isArray(row.task_candidates) && row.task_candidates.length"
        class="wf-result-details"
      >
        <summary>待办候选（{{ row.task_candidates.length }}）</summary>
        <p class="wf-muted">
          人工核对责任人、时限和执行前提后，才随正式记录生成待办。
        </p>
        <WorkflowResult :value="row.task_candidates" />
      </details>
      <details class="wf-result-details wf-record-metadata">
        <summary>记录详情与追溯信息</summary>
        <WorkflowResult
          :value="
            Object.fromEntries(
              Object.entries(row).filter(
                ([key]) =>
                  ![
                    'raw_text',
                    'observations',
                    'task_candidates',
                    'evidence',
                    'warnings',
                    'context_notes',
                    'memory_candidates',
                    'ambiguity',
                    'missing',
                  ].includes(key),
              ),
            )
          "
        />
      </details>
    </article>
    <details v-if="linkedTasks.length" class="wf-result-details">
      <summary>本次关联待办（{{ linkedTasks.length }}）</summary>
      <WorkflowResult :value="linkedTasks" />
    </details>
  </div>
  <WorkflowResult v-else :value="value" @select="emit('select', $event)" />
</template>
