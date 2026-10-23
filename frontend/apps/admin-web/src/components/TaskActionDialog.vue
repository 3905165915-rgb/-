<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import TaskCareContext from '@hulao/shared/task-care-context'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Elder, Task } from '@hulao/shared'
import { Clock3, Paperclip, Save, Send, Trash2 } from 'lucide-vue-next'
import StatusLabel from './StatusLabel.vue'
import { useTaskAction } from '../composables/useTaskAction'
import { mode, queryClient, session } from '../services/data'
const serverWorkflow = ['api'].includes(import.meta.env.VITE_APP_MODE || 'api')
const props = defineProps<{
  task: Task | null
  assignees: string[]
  elder?: Elder
}>()
const emit = defineEmits<{ close: [] }>()
const workflowPanel = ref<{ canClose: () => boolean | Promise<boolean> } | null>(null)
const taskId = computed(() => props.task?.id ?? '')
const route = useRoute()
const router = useRouter()
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
async function close() {
  if (mode === 'api') {
    if (props.task && !(await workflowPanel.value?.canClose?.())) return false
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
    v-if="serverWorkflow"
    :model-value="!!task"
    title="处理任务"
    size="min(800px, 100vw)"
    :close-on-click-modal="false"
    :before-close="close"
  >
    <TaskCareContext
      v-if="task"
      :task-id="task.id"
      :mode="mode"
      :session="session"
    />
    <WorkflowPanel
      v-if="task"
      ref="workflowPanel"
      :key="task.id"
      group="tasks"
      :context="{ task_id: task.id }"
      initial-action="/tasks/{task_id}/transition"
      @changed="queryClient.invalidateQueries()"
    />
  </el-drawer>
  <el-drawer
    v-else
    :model-value="!!task"
    title="处理任务"
    size="min(560px, 100vw)"
    direction="rtl"
    class="task-action-drawer"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy && !loading"
    :show-close="!busy && !loading"
    :before-close="close"
  >
    <TaskCareContext
      v-if="task"
      :task-id="task.id"
      :mode="mode"
      :session="session"
    />
    <div class="task-drawer-summary">
      <div class="drawer-reference">
        <span class="table-secondary">{{ task?.id }}</span
        ><StatusLabel :status="task?.status" />
      </div>
      <h2>{{ task?.title }}</h2>
      <p class="drawer-identity">
        {{ elder?.name || task?.elderId
        }}<span v-if="elder?.bedLabel"> · {{ elder.bedLabel }}</span>
      </p>
      <div class="drawer-meta">
        <span
          >{{ task?.shift || '班次未提供' }} ·
          {{ task?.assignee || '责任人未提供' }}</span
        ><span
          ><Clock3 :size="14" aria-hidden="true" />{{
            task?.dueAt || '期限未提供'
          }}</span
        >
      </div>
    </div>
    <p v-if="loading">正在恢复表单…</p>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    /><el-alert v-if="message" :title="message" type="info" :closable="false" />
    <el-form
      v-if="form"
      label-position="top"
      :disabled="busy || uncertain || submitted || deleted"
    >
      <el-form-item label="操作">
        <el-radio-group v-model="form.action" @change="changed">
          <el-radio-button value="start"> 开始 </el-radio-button
          ><el-radio-button value="complete"> 完成 </el-radio-button
          ><el-radio-button value="not_done"> 未执行 </el-radio-button
          ><el-radio-button value="transfer"> 转交 </el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="form.action === 'complete'" label="完成结果（必填）">
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
            v-for="reason in ['老人拒绝', '身体状况不允许', '资源不足', '其他']"
            :key="reason"
            :label="reason"
            :value="reason"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="form.action === 'transfer'" label="转交对象（必填）">
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
          :disabled="busy || uncertain || submitted || deleted"
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
          :disabled="busy || uncertain || submitted || deleted"
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
      ><el-button
        :disabled="busy || uncertain || submitted || deleted"
        text
        @click="removeMissing(name)"
      >
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
      }}<span v-if="saved && form?.updatedAt"> · {{ form.updatedAt }}</span>
    </p>
    <div
      v-if="(error || deleted) && !uncertain && !submitted"
      class="action-row"
    >
      <el-button :disabled="busy" @click="loadSaved">
        载入已保存版本
      </el-button>
      <el-button :disabled="busy" @click="saveAsNew"> 另存当前内容 </el-button>
    </div>
    <template #footer>
      <el-button :disabled="busy || loading" @click="close"> 关闭 </el-button
      ><el-button v-if="uncertain" :loading="busy" @click="reconcile">
        核实状态 </el-button
      ><el-button v-if="submitted && mode === 'demo'" @click="initialize(true)">
        填写下一操作 </el-button
      ><el-button :disabled="!form || busy" @click="save">
        <Save :size="16" aria-hidden="true" />保存本机草稿 </el-button
      ><el-button
        type="primary"
        :loading="busy"
        :disabled="!canSend"
        @click="submit"
      >
        <Send :size="16" aria-hidden="true" />{{
          mode === 'demo' ? '提交演示操作' : '提交完成结果'
        }}
      </el-button>
    </template>
  </el-drawer>
</template>
