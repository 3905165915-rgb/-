<script setup lang="ts">
const serverWorkflow = ['api'].includes(import.meta.env.VITE_APP_MODE || 'api')
import TaskExecution from '../../../../../packages/shared/src/workflow/TaskExecution.vue'
import TaskCareContext from '@hulao/shared/task-care-context'
import DemoServiceHints from '../../../../../packages/shared/src/workflow/DemoServiceHints.vue'
import { computed, ref, watch } from 'vue'
const attachmentInput = ref<HTMLInputElement | null>(null)
const contextRevision = ref(0)
const taskExecution = ref<{ canClose: () => boolean }>()
function refreshTaskContext() {
  tasks.refetch()
  contextRevision.value++
}
import { Clock3, Save, Send, Paperclip } from 'lucide-vue-next'
import {
  compactReference,
  isKnownStatus,
  resolveStatus,
  taskStatusMeta,
} from '@hulao/shared'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router'
import { showConfirmDialog } from 'vant'
import FeedbackState from '../../components/FeedbackState.vue'
import { useTasks, useElders, mode, session } from '../../services/data'
import { useTaskAction } from '../../composables/useTaskAction'
import { taskStatusLabels } from '../../composables/useTaskFilters'
import {
  taskActionAllowed,
  taskPrimaryLabel,
  taskTime,
} from '../../composables/task-presentation'
const route = useRoute()
const router = useRouter()
const tasks = useTasks()
const elders = useElders()
const task = computed(() =>
  tasks.data.value?.find((item) => item.id === route.params.id),
)
const assignees = computed(() => [
  ...new Set(tasks.data.value?.map((item) => item.assignee)),
])
const elder = computed(() =>
  elders.data.value?.find((row) => row.id === task.value?.elderId),
)
const status = computed(() => resolveStatus(taskStatusMeta, task.value?.status))
const editable = computed(() => taskActionAllowed(task.value, 'complete'))
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
  () => String(route.params.id),
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
    value.action = task.value?.status === 'in_progress' ? 'complete' : 'start'
  }
})
const readonly = computed(
  () =>
    busy.value ||
    loading.value ||
    uncertain.value ||
    submitted.value ||
    deleted.value ||
    tasks.isPending.value ||
    !!tasks.error.value ||
    !editable.value ||
    !task.value ||
    !isKnownStatus(taskStatusMeta, task.value.status),
)
async function leave() {
  if (!session.value) return true
  if (busy.value) return false
  if (!form.value || (await save())) return true
  try {
    await showConfirmDialog({
      title: '本机保存失败',
      message: '尚未保存的修改可能丢失，仍然离开？',
    })
    return true
  } catch {
    return false
  }
}
onBeforeRouteLeave(() =>
  mode === 'api' ? (taskExecution.value?.canClose() ?? true) : leave(),
)
onBeforeRouteUpdate(() =>
  mode === 'api' ? (taskExecution.value?.canClose() ?? true) : leave(),
)
async function saveAsNew() {
  await copyAsNew()
  if (saved.value && form.value?.localId && route.query.draft)
    await router.replace({
      query: { ...route.query, draft: form.value.localId },
    })
}
</script>
<template>
  <TaskCareContext
    v-if="mode === 'api'"
    :task-id="String(route.params.id)"
    :mode="mode"
    :session="session"
    :refresh-key="contextRevision"
  />
  <TaskExecution
    ref="taskExecution"
    v-if="serverWorkflow"
    :task-id="String(route.params.id)"
    @changed="refreshTaskContext"
  />
  <DemoServiceHints v-else :task="task" mobile />
  <section
    v-if="!serverWorkflow"
    class="task-detail-page"
    :class="{ 'editor-page': editable }"
  >
    <p class="page-kicker">任务详情</p>
    <FeedbackState
      :loading="tasks.isPending.value || loading"
      :error="tasks.error.value"
      :empty="!tasks.isPending.value && !tasks.error.value && !task"
      empty-text="未找到任务"
      @retry="tasks.refetch()"
    />
    <div v-if="task" class="task-overview surface-band">
      <div class="task-reference">
        <details>
          <summary>任务标识</summary>
          {{ compactReference(task.id) }}
        </details>
        <span class="status-label" :data-tone="status.tone">{{
          taskStatusLabels[task.status]
        }}</span>
      </div>
      <div class="person-line">
        <div class="detail-bed">
          <small>床位</small
          ><strong>{{
            task.bedSnapshot ||
            (elders.error.value ? '未载入' : elder?.bedLabel || '未提供')
          }}</strong>
        </div>
        <div>
          <strong>{{
            task.nameSnapshot ||
            (elders.error.value
              ? '老人信息未载入'
              : elder?.name || '老人信息未提供')
          }}</strong>
          <p class="muted">
            {{
              task.shiftName ||
              (mode === 'demo' ? task.shift : '') ||
              '班次未提供'
            }}
            ·
            {{
              task.assigneeName ||
              (mode === 'demo' ? task.assignee : '') ||
              '责任人未提供'
            }}
          </p>
        </div>
      </div>
      <h1>{{ task.title }}</h1>
      <p class="task-deadline">执行：{{ taskTime(task.executionAt) }}</p>
      <p class="task-deadline">
        <Clock3 :size="16" aria-hidden="true" />截止：{{
          taskTime(task.deadlineAt || task.dueAt)
        }}
      </p>
      <section
        v-if="
          task.status === 'completed' ||
          task.status === 'not_done' ||
          task.result
        "
        class="task-result"
        aria-labelledby="task-result-title"
      >
        <h2 id="task-result-title">
          {{ task.status === 'not_done' ? '未执行原因' : '任务结果' }}
        </h2>
        <p>{{ task.result || '结果未提供' }}</p>
      </section>
      <van-button
        v-if="task.itemId"
        size="small"
        icon="clock-o"
        :to="'/timeline/' + encodeURIComponent(task.itemId)"
      >
        事项回放
      </van-button>
    </div>
    <FeedbackState :error="elders.error.value" @retry="elders.refetch()" />
    <WorkflowPanel
      v-if="serverWorkflow && task && !tasks.error.value"
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
      @changed="tasks.refetch()"
    />
    <template v-if="!serverWorkflow && task">
      <p v-if="!status.known" class="warning-text" role="status">
        任务状态待核实，暂不可处理，请刷新任务。
      </p>
      <p v-else-if="submitted" class="success-text" role="status">
        此任务操作已结束，当前内容只读。
      </p>
      <p v-if="uncertain" class="warning-text" role="status">
        提交结果待核实，请勿重复提交。
      </p>
      <p v-if="error" class="error-text" role="alert">
        {{ error }}
      </p>
      <p v-if="message" role="status">
        {{ message }}
      </p>
      <p
        v-if="form && editable && !taskActionAllowed(task, form.action)"
        class="warning-text"
        role="status"
      >
        任务状态已变化，请重新选择操作。
      </p>
      <fieldset
        v-if="form && editable && !submitted"
        :disabled="readonly"
        class="plain-fieldset form-band"
      >
        <h2>{{ taskPrimaryLabel(task) }}</h2>
        <label class="select-field"
          >操作<select v-model="form.action" @change="changed">
            <option value="start" :disabled="!taskActionAllowed(task, 'start')">
              开始服务
            </option>
            <option value="complete">登记结果</option>
            <option value="not_done">未执行</option>
            <option value="transfer">转交</option>
          </select></label
        >
        <van-field
          v-if="form.action === 'complete'"
          v-model="form.result"
          label="服务结果"
          required
          type="textarea"
          :disabled="readonly"
          rows="4"
          autosize
          placeholder="填写本次观察及处理结果"
          @update:model-value="changed"
        />
        <label v-if="form.action === 'not_done'" class="select-field"
          >未执行原因<select v-model="form.reason" @change="changed">
            <option value="">请选择</option>
            <option
              v-for="reason in [
                '老人拒绝',
                '身体状况不允许',
                '资源不足',
                '其他',
              ]"
              :key="reason"
            >
              {{ reason }}
            </option>
          </select></label
        >
        <van-field
          v-if="form.action === 'transfer'"
          v-model="form.transferTo"
          label="转交对象"
          required
          list="assignees"
          :disabled="readonly"
          @update:model-value="changed"
        /><datalist id="assignees">
          <option v-for="name in assignees" :key="name">
            {{ name }}
          </option>
        </datalist>
        <van-field
          v-model="form.note"
          label="备注"
          type="textarea"
          :disabled="readonly"
          rows="3"
          autosize
          placeholder="补充需要关注的信息"
          @update:model-value="changed"
        />
        <div class="file-field">
          <span class="field-label-with-icon">
            <Paperclip :size="18" aria-hidden="true" />本机附件
          </span>
          <span class="muted">最多3个，每个不超过5MB</span>
          <van-button
            size="small"
            native-type="button"
            :disabled="readonly"
            @click="attachmentInput?.click()"
          >
            选择文件
          </van-button>
          <input
            ref="attachmentInput"
            type="file"
            class="file-input-hidden"
            multiple
            :disabled="readonly"
            aria-label="选择本机附件"
            @change="addFiles"
          />
        </div>
        <div
          v-for="(file, index) in form.attachments"
          :key="index"
          class="attachment-row"
        >
          <span
            >{{ file.name }} · {{ Math.ceil(file.size / 1024) }}KB ·
            {{ saved ? '已保存到本机' : '尚未保存' }}</span
          ><van-button
            size="mini"
            icon="delete-o"
            title="移除附件"
            :aria-label="'移除附件 ' + file.name"
            :disabled="readonly"
            @click="
              () => {
                form!.attachments.splice(index, 1)
                changed()
              }
            "
          >
            移除
          </van-button>
        </div>
      </fieldset>
      <div
        v-for="name in form?.missingAttachments"
        :key="name"
        class="attachment-row"
      >
        <span class="warning-text">{{ name }} · 需要重新选择</span
        ><van-button
          size="mini"
          :disabled="readonly"
          @click="removeMissing(name)"
        >
          移除缺失附件
        </van-button>
      </div>
      <p v-if="mode === 'api'" class="muted">
        仅完成结果可提交；其他操作、备注及附件仅保存在本机。
      </p>
      <p v-if="errors.length" class="muted">
        {{ errors.join('；') }}
      </p>
      <div
        v-if="(error || deleted) && !uncertain && !submitted"
        class="action-row"
      >
        <van-button
          size="small"
          icon="replay"
          :disabled="busy"
          @click="loadSaved"
        >
          载入已保存版本
        </van-button>
        <van-button
          size="small"
          icon="add-o"
          aria-label="另存当前内容"
          :disabled="busy"
          @click="saveAsNew"
        >
          另存当前内容
        </van-button>
      </div>
      <footer v-if="editable || uncertain" class="editor-footer hl-glass">
        <p
          class="save-status"
          :class="{ 'warning-text': !saved, 'error-text': error }"
          role="status"
        >
          {{ saveStatus
          }}<span v-if="saved && form?.updatedAt">
            · {{ taskTime(form.updatedAt) }}</span
          >
        </p>
        <div class="footer-actions">
          <van-button
            :disabled="!form || busy || loading || deleted"
            @click="save"
          >
            <Save :size="17" aria-hidden="true" />保存本机 </van-button
          ><van-button
            type="primary"
            :loading="busy"
            v-if="editable && !submitted"
            :disabled="
              !canSend ||
              readonly ||
              !form ||
              !taskActionAllowed(task, form.action)
            "
            @click="submit"
          >
            <Send :size="17" aria-hidden="true" />{{
              form?.action === 'start'
                ? '开始服务'
                : form?.action === 'complete'
                  ? '登记结果'
                  : form?.action === 'not_done'
                    ? '登记未执行'
                    : '转交任务'
            }}
          </van-button>
        </div>
        <div
          v-if="uncertain || (submitted && mode === 'demo')"
          class="footer-secondary-actions"
        >
          <van-button
            v-if="uncertain"
            block
            size="small"
            :disabled="busy"
            @click="reconcile"
          >
            核实状态 </van-button
          ><van-button
            v-if="submitted && mode === 'demo' && editable"
            block
            size="small"
            :disabled="busy || !status.known || !!tasks.error.value"
            @click="initialize(true)"
          >
            填写下一操作
          </van-button>
        </div>
      </footer>
    </template>
  </section>
</template>
<style scoped>
.file-field {
  min-width: 0;
}
.file-field > .van-button {
  align-self: flex-start;
}
.file-field .file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
.task-result {
  margin-block: 16px;
  padding: 12px;
  border: 1px solid var(--hl-border);
  border-radius: 8px;
}
.task-result h2 {
  font-size: 17px;
}
.task-result p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
