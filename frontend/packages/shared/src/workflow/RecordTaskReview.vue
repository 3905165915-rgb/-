<script setup lang="ts">
import { computed } from 'vue'
import { readSession } from '../session'
import { actorId } from './shift-access'
import { selectedRecordTasks } from './record-tasks'
import type { Row } from './model'
const props = defineProps<{
  modelValue: unknown
  elderName: string
  owners: Row[]
}>()
const emit = defineEmits<{ 'update:modelValue': [Row[]] }>()
const rows = computed(() => Array.isArray(props.modelValue) ? props.modelValue as Row[] : [])
const count = computed(() => selectedRecordTasks(rows.value).length)
const me = computed(() => props.owners.find(person => person.id === actorId(readSession())))
function update(index: number, field: string, value: unknown) {
  emit('update:modelValue', rows.value.map((row, i) => i === index ? { ...row, [field]: value } : { ...row }))
}
function localTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  if (!/(Z|[+-]\d\d:\d\d)$/.test(value)) return value
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return ''
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}
function add() {
  emit('update:modelValue', [...rows.value, { title: '', assigned_to: '', due_at: '', condition: '', due_text: '', include_task: true }])
}
</script>
<template>
  <section class="wf-task-review" aria-label="记录关联任务核对">
    <h4>随记录创建任务（{{ count }}项）</h4>
    <p class="wf-muted">对象：{{ elderName || '请先选择老人' }}。核对后一次保存，记录和勾选的任务一起生成，无需到任务页重复新建。</p>
    <p v-if="!rows.length" class="wf-muted">尚无待办。已经完成的事、否定安排不会作为新任务；如有遗漏，可补充一项。</p>
    <article v-for="(row, index) in rows" :key="index" class="wf-task-review-card" :data-task-review="index">
      <label class="wf-task-toggle">
        <input type="checkbox" :checked="row.include_task !== false" @change="update(index, 'include_task', ($event.target as HTMLInputElement).checked)" />
        <strong>创建第{{ index + 1 }}项任务</strong>
      </label>
      <p v-if="row.evidence_text" class="wf-evidence">原文依据：{{ row.evidence_text }}</p>
      <p v-if="row.due_text" class="wf-muted">原文时间：{{ row.due_text }}。请核对日期、时刻，模糊表达需要补充。</p>
      <p v-if="Array.isArray(row.review_notes) && row.include_task !== false" class="wf-muted">{{ row.review_notes.join(' ') }}</p>
      <p v-if="row.include_task === false" class="wf-muted">本项不创建，原文仍随记录保存；可重新勾选。</p>
      <template v-else>
        <label class="wf-field"><span>要做的事<b> *</b></span><input :aria-label="'第' + (index + 1) + '项要做的事'" :value="row.title || ''" maxlength="300" @input="update(index, 'title', ($event.target as HTMLInputElement).value)" /></label>
        <label class="wf-field"><span>负责人<b> *</b></span><select :aria-label="'第' + (index + 1) + '项负责人'" :value="row.assigned_to || ''" @change="update(index, 'assigned_to', ($event.target as HTMLSelectElement).value)">
          <option value="">请选择负责人</option><option v-for="person in owners" :key="String(person.id)" :value="String(person.id)">{{ person.display_name || '工作人员' }}</option>
        </select></label>
        <button v-if="me && row.assigned_to !== me.id" type="button" class="wf-secondary" @click="update(index, 'assigned_to', me.id)">本项由我负责</button>
        <p v-if="!owners.length" class="wf-notice">当前没有可安排的负责人，请核对班次；护理员只能安排给本人，其他分工由主管处理。</p>
        <label class="wf-field"><span>截止时间<b> *</b></span><input type="datetime-local" step="1" :aria-label="'第' + (index + 1) + '项截止时间'" :value="localTime(row.due_at)" @input="update(index, 'due_at', ($event.target as HTMLInputElement).value)" /></label>
        <p class="wf-muted">时间选择器按当前设备时区填写；带时区的识别结果会自动换算。</p>
        <label class="wf-field"><span>执行前提</span><textarea :aria-label="'第' + (index + 1) + '项执行前提'" :value="String(row.condition || '')" rows="2" placeholder="没有前提可留空；如本人同意后" @input="update(index, 'condition', ($event.target as HTMLTextAreaElement).value)" /></label>
        <p v-if="row.condition" class="wf-notice">创建不代表前提已满足，执行前仍需按任务流程核验。</p>
        <label v-if="row.object_review_required" class="wf-task-toggle wf-notice"><input type="checkbox" :checked="row.object_review_confirmed === true" @change="update(index, 'object_review_confirmed', ($event.target as HTMLInputElement).checked)" /><span>原文还提到了其他老人。我已核对，本项任务确实属于{{ elderName }}；否则请取消本项，拆分记录。</span></label>
      </template>
    </article>
    <button type="button" class="wf-secondary" :disabled="rows.length >= 50 || !elderName" @click="add">补充一项待办</button>
    <p class="wf-muted">缺负责人或时刻时，补齐或取消该项再保存。取消全部任务可以仅保存记录，系统不会再次补回已取消的候选。</p>
  </section>
</template>
