<script setup lang="ts">
import type { RecordEditor, Task } from '@hulao/shared'
const props = defineProps<{
  modelValue: RecordEditor['review']
  disabled?: boolean
  tasks: Task[]
  localAssignment: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: RecordEditor['review']]
}>()
function update(key: keyof RecordEditor['review'], value: string | number) {
  emit('update:modelValue', { ...props.modelValue, [key]: String(value) })
}
</script>
<template>
  <van-cell-group>
    <van-field
      :model-value="modelValue.observation"
      label="观察结果"
      required
      type="textarea"
      rows="3"
      autosize
      :disabled="disabled"
      @update:model-value="update('observation', $event)"
    /><van-field
      :model-value="modelValue.followUp"
      label="后续安排"
      type="textarea"
      rows="3"
      autosize
      :disabled="disabled"
      @update:model-value="update('followUp', $event)"
    /><van-field
      :model-value="modelValue.contactTarget"
      label="联系对象"
      :disabled="disabled"
      @update:model-value="update('contactTarget', $event)"
    /><van-field
      :model-value="modelValue.assigneeId"
      label="责任人"
      :disabled="disabled"
      @update:model-value="update('assigneeId', $event)"
    /><van-field
      :model-value="modelValue.dueAt"
      label="期限"
      type="datetime-local"
      :disabled="disabled"
      @update:model-value="update('dueAt', $event)"
    />
  </van-cell-group><label class="select-field">关联任务<select
    :value="modelValue.linkedTaskId"
    :disabled="disabled"
    @change="
      update('linkedTaskId', ($event.target as HTMLSelectElement).value)
    "
  >
    <option value="">未关联</option>
    <option
      v-for="task in tasks"
      :key="task.id"
      :value="task.id"
    >
      {{ task.title }}
    </option>
  </select></label>
  <p class="muted">
    {{
      localAssignment
        ? '责任人、期限和关联任务仅保存在本机。'
        : '关联任务仅保存在本机。'
    }}
  </p>
</template>
