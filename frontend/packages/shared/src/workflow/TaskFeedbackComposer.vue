<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Row } from './model'
import { elderReactions } from './task-feedback'
const props = defineProps<{ modelValue: Row }>()
const emit = defineEmits<{ 'update:modelValue': [Row] }>()
const feedback = computed(() => (props.modelValue._care_feedback || {}) as Row)
const id = useId()
function update(key: string, value: unknown) {
  emit('update:modelValue', {
    ...props.modelValue,
    _care_feedback: { ...feedback.value, [key]: value },
  })
}
</script>
<template>
  <section class="task-feedback" aria-label="完成反馈辅助填写">
    <label class="feedback-toggle"
      ><input
        type="checkbox"
        :checked="feedback.enabled === true"
        @change="update('enabled', ($event.target as HTMLInputElement).checked)"
      />按本人反应和观察事实填写反馈</label
    >
    <template v-if="feedback.enabled === true">
      <p>
        仅在本任务要求已完成时提交。若任务只是“再次询问”，本人拒绝活动也可如实记录；若任务要求尚未完成，请使用“未执行”并说明已做部分及原因。
      </p>
      <div class="wf-field">
        <label :for="id + '-reaction'">本人反应 *</label
        ><select
          :id="id + '-reaction'"
          :value="feedback.reaction || ''"
          @change="
            update('reaction', ($event.target as HTMLSelectElement).value)
          "
        >
          <option value="">请选择，不自动推断</option>
          <option
            v-for="(label, key) in elderReactions"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </div>
      <label class="wf-field"
        ><span>实际执行、观察事实或本人原话 *</span
        ><textarea
          :value="String(feedback.facts || '')"
          maxlength="1200"
          rows="4"
          @input="update('facts', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
      <p>
        照护效果：尚不能判断。单次任务完成和本人接受，不能直接证明方法有效。
      </p>
      <label class="wf-field"
        ><span>后续关注说明（可选）</span
        ><textarea
          :value="String(feedback.followup || '')"
          maxlength="400"
          rows="2"
          @input="
            update('followup', ($event.target as HTMLTextAreaElement).value)
          "
        />
      </label>
      <p>
        提交后随完成结果保存在服务器。后续关注说明仅是一段记录；需要继续观察或主管复核时，请另行明确安排责任人和截止时间，并在交班中接续原任务。
      </p>
    </template>
  </section>
</template>
<style scoped>
.task-feedback {
  padding-block: 12px;
  border-block: 1px solid var(--hl-border, #dce3e7);
}
.feedback-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}
.feedback-toggle input {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}
p {
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
