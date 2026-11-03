<script setup lang="ts">
import { computed, ref } from 'vue'
import { display, type Row } from './model'
import WorkflowResult from './WorkflowResult.vue'
import PhotoObservation from './PhotoObservation.vue'
const props = defineProps<{ value: unknown; catalogs: Record<string, Row[]> }>()
const emit = defineEmits<{ select: [Row] }>()
const openPhotos = ref<Record<string, boolean>>({})
const rows = computed(() => {
  const value = props.value
  if (Array.isArray(value)) return value as Row[]
  if (!value || typeof value !== 'object') return null
  const obj = value as Row
  if (obj.record && typeof obj.record === 'object') return [obj.record as Row]
  return typeof obj.id === 'string' && /^(AI|REC)-/.test(obj.id) ? [obj] : null
})
const linkedTasks = computed(() => ((props.value as Row)?.tasks || []) as Row[])
const savedRecord = computed(() => !!(props.value && typeof props.value === 'object' && !Array.isArray(props.value) && (props.value as Row).record))
const isDraft = (row: Row) => String(row.id).startsWith('AI-')
const elderName = (row: Row) =>
  String(
    props.catalogs.elders?.find((elder) => elder.id === row.elder_id)?.name ||
      '老人信息待核对',
  )
const ownerName = (row: Row) => String(props.catalogs.staff?.find(staff => staff.id === row.assigned_to)?.display_name || '负责人待核对')
const readableTask = (row: Row) => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'assigned_to')), responsible_name: ownerName(row) })
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
    <p v-if="savedRecord" class="wf-notice" role="status">
      这条正式记录也已纳入该老人的印象资料。下次整理印象时，会结合历史记录一起分析；待办安排不等于服务已经发生，也不会直接改成长期偏好。
    </p>
    <article v-for="row in rows" :key="String(row.id)" class="wf-record-card">
      <header class="wf-record-card-header">
        <strong>{{ elderName(row) }}</strong>
        <span class="wf-record-status">{{
          display(row.status || (isDraft(row) ? 'pending_review' : 'confirmed'))
        }}</span>
      </header>
      <p class="wf-muted">{{ display(row.created_at, 'created_at') }}</p>
      <p class="wf-record-preview">{{ content(row) }}</p>
      <template v-if="Array.isArray(row.source_attachment_ids) && row.source_attachment_ids.length">
        <button type="button" class="wf-secondary" :aria-expanded="!!openPhotos[String(row.id)]" @click="openPhotos[String(row.id)] = !openPhotos[String(row.id)]">{{ openPhotos[String(row.id)] ? '收起原图与人工审核' : '查看原图与人工审核' }}</button>
        <PhotoObservation v-if="openPhotos[String(row.id)]" :elder-id="String(row.elder_id)" :attachment-id="String(row.source_attachment_ids[0])" :analysis-id="typeof row.source_image_analysis_id === 'string' ? row.source_image_analysis_id : undefined" read-only />
      </template>
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
        <WorkflowResult :value="(row.task_candidates as Row[]).map(readableTask)" />
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
    <details v-if="linkedTasks.length" class="wf-result-details" open>
      <summary>已随记录创建任务（{{ linkedTasks.length }}项）</summary>
      <p class="wf-success">任务已正式生成，可在“任务”中先选老人再查看、执行和交班接续，无需重复创建。</p>
      <article v-for="task in linkedTasks" :key="String(task.id)" class="wf-record-card">
        <strong>{{ task.title }}</strong>
        <p class="wf-muted">{{ elderName(task) }} · {{ ownerName(task) }} · {{ display(task.status) }}</p>
        <p>截止时间：{{ display(task.due_at, 'due_at') }}</p>
        <p v-if="task.condition" class="wf-notice">执行前提：{{ task.condition }}。执行前仍需核验。</p>
      </article>
    </details>
  </div>
  <WorkflowResult v-else :value="value" @select="emit('select', $event)" />
</template>
