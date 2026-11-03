<script setup lang="ts">
import { computed } from 'vue'
import { display, type Row } from './model'
const props = defineProps<{ value: Row; confirmed?: boolean; busy?: boolean }>()
const emit = defineEmits<{ 'update:confirmed': [boolean] }>()
const items = computed(() => Array.isArray(props.value.items) ? props.value.items as Row[] : [])
const missing = computed(() => Array.isArray(props.value.unassigned_items) ? props.value.unassigned_items as Row[] : [])
const count = (value: unknown) => Array.isArray(value) ? value.length : 0
</script>
<template>
  <section
    class="generation-preview"
    aria-label="服务器任务生成预览"
  >
    <h3>核对本次任务排期</h3><p>服务日期：{{ value.service_date }} · 新建 {{ items.length }} 项 · 本班已有 {{ count(value.existing_task_ids) }} 项 · 其他班次保留 {{ count(value.retained_task_ids) }} 项</p>
    <ol>
      <li
        v-for="(item,index) in items"
        :key="index"
      >
        <strong>{{ item.title }}</strong><p>{{ display(item.scheduled_at, 'scheduled_at') }} 至 {{ display(item.due_at, 'due_at') }}</p><p>{{ item.completion_criteria }}</p>
      </li>
    </ol>
    <div
      v-if="missing.length"
      role="status"
    >
      <h4>尚未覆盖的事项（{{ missing.length }}）</h4><p
        v-for="(item,index) in missing"
        :key="index"
      >
        {{ item.title }} · {{ display(item.scheduled_at, 'scheduled_at') }} · {{ item.reason }}
      </p>
    </div>
    <p v-if="!items.length">
      本次没有新建任务。已有任务保持原样。
    </p>
    <label class="generation-confirm"><input
      :checked="confirmed"
      type="checkbox"
      :disabled="busy"
      @change="emit('update:confirmed', ($event.target as HTMLInputElement).checked)"
    >已核对事项、时间、责任人与班次，确认按此预览生成</label>
  </section>
</template>
<style scoped>
.generation-preview{padding:18px;margin:16px 0;border:1px solid #cdded3;background:#f3f8f4;border-radius:14px;overflow-wrap:anywhere}.generation-preview h3{margin:0 0 12px}.generation-preview p{line-height:1.65}.generation-preview ol{padding-left:22px}.generation-preview li{padding:10px 0;border-bottom:1px solid #dce7df}.generation-confirm{display:flex;align-items:center;gap:10px;min-height:44px;line-height:1.6}.generation-confirm input{width:20px;height:20px;flex-shrink:0}
</style>
