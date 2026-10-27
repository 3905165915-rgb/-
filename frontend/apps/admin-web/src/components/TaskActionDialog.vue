<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import TaskCareContext from '@hulao/shared/task-care-context'
import DemoServiceHints from '../../../../packages/shared/src/workflow/DemoServiceHints.vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Elder, Task } from '@hulao/shared'
import { Clock3, Paperclip, Save, Send, Trash2 } from 'lucide-vue-next'
import StatusLabel from './StatusLabel.vue'
import { useTaskAction } from '../composables/useTaskAction'
import { mode, queryClient, session, useTasks } from '../services/data'
import {
  taskActionAllowed,
  taskPrimaryLabel,
  taskTime,
} from '../composables/task-presentation'
const serverWorkflow = ['api'].includes(import.meta.env.VITE_APP_MODE || 'api')
const props = defineProps<{
  task: Task | null
  assignees: string[]
  elder?: Elder
}>()
const emit = defineEmits<{ close: [] }>()
const workflowPanel = ref<{
  canClose: () => boolean | Promise<boolean>
} | null>(null)
const taskId = computed(() => props.task?.id ?? '')
const route = useRoute()
const router = useRouter()
const tasks = useTasks()
const editable = computed(() => taskActionAllowed(props.task, 'complete'))
const {
  form,
  busy,
  loading,
  error,
  message,
  uncertain,
  submitted,
  saved,
  saveStatus,
  deleted,
  copyAsNew,
  loadSaved,
  removeMissing,
  errors,
  canSend,
  save,
  changed,
  addFiles,
  submit,
  reconcile,
  initialize,
} = useTaskAction(
  () => taskId.value,
  () => (typeof route.query.draft === 'string' ? route.query.draft : undefined),
  () => !serverWorkflow,
)
watch(form, (value) => {
  if (
    value &&
    value.phase === 'editing' &&
    value.persistedVersion === undefined &&
    !value.editVersion
  ) {
    value.action = props.task?.status === 'in_progress' ? 'complete' : 'start'
  }
})
const readonly = computed(
  () =>
    busy.value ||
    loading.value ||
    uncertain.value ||
    submitted.value ||
    deleted.value ||
    !editable.value ||
    !!tasks.error.value ||
    tasks.isPending.value,
)
async function close() {
  if (mode === 'api') {
    if (workflowPanel.value && !(await workflowPanel.value.canClose()))
      return false
    emit('close')
    return
  }
  if (busy.value || loading.value) return
  if (form.value && !(await save())) return
  emit('close')
}
async function saveAsNew() {
  await copyAsNew()
  if (saved.value && form.value?.localId && route.query.draft)
    await router.replace({
      query: { ...route.query, draft: form.value.localId },
    })
}
</script>
<template>
  <el-drawer
    :model-value="!!task"
    :title="task ? taskPrimaryLabel(task) : '任务详情'"
    :size="serverWorkflow ? 'min(800px, 100vw)' : 'min(560px, 100vw)'"
    direction="rtl"
    class="task-action-drawer"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy && !loading"
    :show-close="!busy && !loading"
    :before-close="close"
  >
    <TaskCareContext
      v-if="task && mode === 'api'"
      :task-id="task.id"
      :mode="mode"
      :session="session"
    />
    <DemoServiceHints v-else-if="mode === 'demo'" :task="task" />
    <div class="task-drawer-summary">
      <div class="drawer-reference">
        <details>
          <summary>任务标识</summary>
          {{ task?.id }}
        </details>
        <StatusLabel :status="task?.status" />
      </div>
      <h2>{{ task?.title }}</h2>
      <p class="drawer-identity">
        {{ task?.nameSnapshot || elder?.name || '姓名未提供' }} ·
        {{ task?.bedSnapshot || elder?.bedLabel || '床位未提供' }}
      </p>
      <div class="drawer-meta">
        <span
          >{{
            task?.shiftName ||
            (mode === 'demo' ? task?.shift : '') ||
            '班次未提供'
          }}
          ·
          {{
            task?.assigneeName ||
            (mode === 'demo' ? task?.assignee : '') ||
            '责任人未提供'
          }}</span
        ><span>执行：{{ taskTime(task?.executionAt) }}</span
        ><span
          ><Clock3 :size="14" aria-hidden="true" />截止：{{
            taskTime(task?.deadlineAt || task?.dueAt)
          }}</span
        >
      </div>
      <section
        v-if="
          task &&
          (task.status === 'completed' ||
            task.status === 'not_done' ||
            task.result)
        "
        class="task-result"
        aria-labelledby="drawer-task-result-title"
      >
        <h3 id="drawer-task-result-title">
          {{ task.status === 'not_done' ? '未执行原因' : '任务结果' }}
        </h3>
        <p>{{ task.result || '结果未提供' }}</p>
      </section>
    </div>
    <WorkflowPanel
      v-if="serverWorkflow && task && !tasks.error.value"
      ref="workflowPanel"
      :key="task.id"
      group="tasks"
      :title="taskPrimaryLabel(task)"
      :context="{ task_id: task.id }"
      :initial-action="
        !editable
          ? '/tasks/{task_id}'
          : task.status === 'in_progress'
            ? '/tasks/{task_id}/complete'
            : '/tasks/{task_id}/transition'
      "
      :auto-read="!editable"
      @changed="queryClient.invalidateQueries()"
    />
    <el-alert
      v-if="tasks.error.value"
      title="任务刷新失败，请关闭后刷新列表再处理。"
      type="error"
      :closable="false"
    />
    <template v-if="!serverWorkflow">
      <p v-if="loading">正在恢复表单…</p>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      /><el-alert
        v-if="message"
        :title="message"
        type="info"
        :closable="false"
      />
      <el-form
        v-if="form && editable && !submitted"
        label-position="top"
        :disabled="readonly"
      >
        <el-form-item label="操作">
          <el-radio-group v-model="form.action" @change="changed">
            <el-radio-button
              value="start"
              :disabled="!taskActionAllowed(task, 'start')"
            >
              开始服务 </el-radio-button
            ><el-radio-button value="complete"> 登记结果 </el-radio-button
            ><el-radio-button value="not_done"> 未执行 </el-radio-button
            ><el-radio-button value="transfer"> 转交 </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item
          v-if="form.action === 'complete'"
          label="服务结果（必填）"
        >
          <el-input
            v-model="form.result"
            type="textarea"
            :rows="4"
            @input="changed"
          />
        </el-form-item>
        <el-form-item
          v-if="form.action === 'not_done'"
          label="未执行原因（必填）"
        >
          <el-select v-model="form.reason" @change="changed">
            <el-option
              v-for="reason in [
                '老人拒绝',
                '身体状况不允许',
                '资源不足',
                '其他',
              ]"
              :key="reason"
              :label="reason"
              :value="reason"
            />
          </el-select>
        </el-form-item>
        <el-form-item
          v-if="form.action === 'transfer'"
          label="转交对象（必填）"
        >
          <el-select
            v-model="form.transferTo"
            filterable
            allow-create
            default-first-option
            @change="changed"
          >
            <el-option
              v-for="name in assignees"
              :key="name"
              :value="name"
              :label="name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="3"
            @input="changed"
          />
        </el-form-item>
        <el-form-item label="本机附件（最多3个，每个5MB）">
          <input
            type="file"
            multiple
            aria-label="选择本机附件"
            :disabled="readonly"
            @change="addFiles"
          />
        </el-form-item>
        <div
          v-for="(file, index) in form.attachments"
          :key="index"
          class="attachment-row"
        >
          <Paperclip :size="17" aria-hidden="true" /><span
            >{{ file.name }} · {{ Math.ceil(file.size / 1024) }}KB ·
            {{ saved ? '已保存到本机' : '尚未保存' }}</span
          ><el-button
            :disabled="readonly"
            title="移除附件"
            aria-label="移除附件"
            text
            @click="
              () => {
                form!.attachments.splice(index, 1)
                changed()
              }
            "
          >
            <Trash2 :size="17" aria-hidden="true" />
          </el-button>
        </div>
      </el-form>
      <div
        v-for="name in form?.missingAttachments"
        :key="name"
        class="attachment-row"
      >
        <span class="warning-text">{{ name }} · 需要重新选择</span
        ><el-button :disabled="readonly" text @click="removeMissing(name)">
          移除缺失附件
        </el-button>
      </div>
      <p v-if="mode === 'api'" class="muted">
        当前仅支持提交完成结果；其他操作、备注及附件仅保存在本机。
      </p>
      <p v-if="errors.length" class="muted">
        {{ errors.join('；') }}
      </p>
      <p class="save-status" role="status">
        {{ saveStatus
        }}<span v-if="saved && form?.updatedAt">
          · {{ taskTime(form.updatedAt) }}</span
        >
      </p>
      <div
        v-if="(error || deleted) && !uncertain && !submitted"
        class="action-row"
      >
        <el-button :disabled="busy" @click="loadSaved">
          载入已保存版本
        </el-button>
        <el-button :disabled="busy" @click="saveAsNew">
          另存当前内容
        </el-button>
      </div>
      <p
        v-if="form && editable && !taskActionAllowed(task, form.action)"
        class="warning-text"
        role="status"
      >
        任务状态已变化，请重新选择操作。
      </p>
    </template>
    <template v-if="!serverWorkflow" #footer>
      <el-button :disabled="busy || loading" @click="close"> 关闭 </el-button
      ><el-button v-if="uncertain" :loading="busy" @click="reconcile">
        核实状态 </el-button
      ><el-button
        v-if="submitted && mode === 'demo' && editable"
        @click="initialize(true)"
      >
        填写下一操作 </el-button
      ><el-button
        v-if="editable"
        :disabled="!form || busy || loading || deleted"
        @click="save"
      >
        <Save :size="16" aria-hidden="true" />保存本机草稿 </el-button
      ><el-button
        type="primary"
        v-if="editable && !submitted"
        :loading="busy"
        :disabled="
          !canSend || readonly || !form || !taskActionAllowed(task, form.action)
        "
        @click="submit"
      >
        <Send :size="16" aria-hidden="true" />{{
          form?.action === 'start'
            ? '开始服务'
            : form?.action === 'complete'
              ? '登记结果'
              : form?.action === 'not_done'
                ? '登记未执行'
                : '转交任务'
        }}
      </el-button>
    </template>
  </el-drawer>
</template>
<style scoped>
.task-result {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--hl-border);
  border-radius: 8px;
}
.task-result p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
