<script setup lang="ts">
const serverWorkflow = ['api'].includes(import.meta.env.VITE_APP_MODE || 'api')
import TaskExecution from '../../../../../packages/shared/src/workflow/TaskExecution.vue'
import TaskCareContext from '@hulao/shared/task-care-context'
import { computed, ref } from 'vue'
const contextRevision=ref(0)
import { Clock3, Save, Send, Paperclip } from 'lucide-vue-next'
import { compactReference, isKnownStatus, resolveStatus, taskStatusMeta, workspaceDate } from '@hulao/shared'
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
const readonly = computed(
  () =>
    busy.value ||
    loading.value ||
    uncertain.value ||
    submitted.value ||
    deleted.value ||
    tasks.isPending.value ||
    !!tasks.error.value ||
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
onBeforeRouteLeave(() => (mode === 'api' ? true : leave()))
onBeforeRouteUpdate(() => (mode === 'api' ? true : leave()))
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
    :task-id="String(route.params.id)"
    :mode="mode"
    :session="session"
    :refresh-key="contextRevision"
  />
  <TaskExecution v-if="serverWorkflow" :task-id="String(route.params.id)" @changed="tasks.refetch();contextRevision++" />
  <section v-else class="task-detail-page editor-page">
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
        <span>任务 {{ compactReference(task.id) }}</span
        ><span class="status-label" :data-tone="status.tone">{{
          taskStatusLabels[task.status]
        }}</span>
      </div>
      <div class="person-line">
        <div class="detail-bed">
          <small>床位</small
          ><strong>{{
            task.bedLabel || elder?.bedLabel || '历史床位待核对'
          }}</strong>
        </div>
        <div>
          <strong>{{
            task.elderName || elder?.name || '老人关联待核对'
          }}</strong>
          <p class="muted">
            {{ task.shift || '班次未提供' }} ·
            {{ task.assignee || '责任人未提供' }}
          </p>
        </div>
      </div>
      <h1>{{ task.title }}</h1>
      <p class="task-deadline">
        <Clock3 :size="16" aria-hidden="true" />截止：{{
          workspaceDate(task.dueAt)
        }}
      </p>
      <p v-if="task.result">最新结果：{{ task.result }}</p>
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
    <template v-if="task">
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
      <fieldset
        v-if="form"
        :disabled="readonly"
        class="plain-fieldset form-band"
      >
        <h2>处理任务</h2>
        <label class="select-field"
          >操作<select v-model="form.action" @change="changed">
            <option value="start">开始</option>
            <option value="complete">完成</option>
            <option value="not_done">未执行</option>
            <option value="transfer">转交</option>
          </select></label
        >
        <van-field
          v-if="form.action === 'complete'"
          v-model="form.result"
          label="完成结果"
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
        /><label class="file-field"
          ><span class="field-label-with-icon"
            ><Paperclip :size="18" aria-hidden="true" />本机附件</span
          ><span class="muted">最多3个，每个不超过5MB</span
          ><input
            type="file"
            multiple
            :disabled="readonly"
            aria-label="选择本机附件"
            @change="addFiles"
        /></label>
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
      <footer class="editor-footer hl-glass">
        <p
          class="save-status"
          :class="{ 'warning-text': !saved, 'error-text': error }"
          role="status"
        >
          {{ saveStatus
          }}<span v-if="saved && form?.updatedAt"> · {{ form.updatedAt }}</span>
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
            :disabled="!canSend || readonly"
            @click="submit"
          >
            <Send :size="17" aria-hidden="true" />{{
              mode === 'demo' ? '提交演示操作' : '提交完成结果'
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
            v-if="submitted && mode === 'demo'"
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
