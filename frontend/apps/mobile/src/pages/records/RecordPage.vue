<script setup lang="ts">
const serverWorkflow = ['api'].includes(import.meta.env.VITE_APP_MODE || 'api')
import WorkflowPanel from '@hulao/shared/workflow'
import { computed, onMounted, ref, watch } from 'vue'
import { Save, Send } from 'lucide-vue-next'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { compactReference, loadDemoState } from '@hulao/shared'
import {
  useElders,
  useTasks,
  mode,
  session,
  errorMessage,
} from '../../services/data'
import { useRecordEditor } from '../../composables/useRecordEditor'
import RecordReviewForm from '../../components/RecordReviewForm.vue'
import FeedbackState from '../../components/FeedbackState.vue'
const route = useRoute()
const elders = useElders()
const tasks = useTasks()
const {
  editor,
  drafts,
  busy,
  savingLocal,
  saved,
  saveError,
  error,
  notice,
  frozen,
  confirmable,
  changed,
  persist,
  initialize,
  restore,
  fresh,
  copyAsNew,
  extract,
  discard,
  submit,
} = useRecordEditor()
const manual = ref(false)
const restoreId = ref('')
const phaseLabels: Record<string, string> = {
  editing: '编辑中',
  extracting: '提取中',
  reviewing: '待核对',
  submitting: '提交中',
  submitted: '已提交',
  uncertain: '结果待核实',
  discarded_local: '本机已放弃',
}
const stale = computed(
  () =>
    editor.value.ai &&
    (editor.value.ai.sourceRevision !== editor.value.sourceRevision ||
      editor.value.ai.elderId !== editor.value.elderId ||
      editor.value.ai.sourceText !== editor.value.text),
)
const ready = ref(false)
const validElder = computed(
  () =>
    !elders.isPending.value &&
    !elders.error.value &&
    !!elders.data.value?.some((row) => row.id === editor.value.elderId),
)
function requireElder() {
  if (validElder.value) return true
  error.value = '请先成功载入老人列表，并选择当前有效的老人。'
  return false
}
onMounted(async () => {
  if (serverWorkflow) return
  await initialize(
    typeof route.query.draft === 'string' ? route.query.draft : undefined,
  )
  ready.value = true
})
async function confirm() {
  if (!requireElder()) return
  try {
    await showConfirmDialog({
      title: mode === 'demo' ? '确认演示记录' : '确认提交',
      message: '请核对老人、原文与观察结果。',
    })
  } catch {
    return
  }
  if (requireElder()) await submit(manual.value)
}
async function leave() {
  if (!session.value) return true
  if (busy.value && editor.value.phase === 'submitting') return false
  if (await persist()) return true
  try {
    await showConfirmDialog({
      title: '本机保存失败',
      message: '尚未保存的文字可能丢失，仍然离开？',
    })
    return true
  } catch {
    return false
  }
}
onBeforeRouteLeave(() => (mode === 'api' ? true : leave()))
onBeforeRouteUpdate(() => (mode === 'api' ? true : leave()))
watch(
  () => route.query.draft,
  async (value) => {
    if (
      ready.value &&
      typeof value === 'string' &&
      value !== editor.value.localId
    )
      await initialize(value)
  },
)
async function useExample() {
  if (busy.value || frozen.value) return
  const localId = editor.value.localId
  const editVersion = editor.value.editVersion
  try {
    const state = await loadDemoState()
    if (
      editor.value.localId !== localId ||
      editor.value.editVersion !== editVersion
    )
      return
    const preset = state.drafts[0]
    if (!preset) return
    editor.value.elderId = preset.elderId
    editor.value.text = preset.originalText
    changed(true)
  } catch (failure) {
    error.value = errorMessage(failure)
  }
}
async function newDraft() {
  await fresh()
  manual.value = false
}
function retryQueries() {
  void elders.refetch()
  void tasks.refetch()
}
function extractDraft() {
  if (!requireElder()) return
  manual.value = false
  void extract()
}
async function restoreDraft() {
  if (restoreId.value) {
    await restore(restoreId.value)
    manual.value = !editor.value.ai
  }
}
</script>
<template>
  <WorkflowPanel
    v-if="serverWorkflow"
    group="records"
    title="记录"
    :context="typeof route.query.elder === 'string' ? { elder_id: route.query.elder } : {}"
    initial-action="/records/context-extract"
  />
  <section v-else class="record-page editor-page">
    <div class="page-title-row">
      <h1>快速记录</h1>
      <van-tag
        :type="
          editor.phase === 'submitted'
            ? 'success'
            : editor.phase === 'uncertain'
              ? 'warning'
              : 'default'
        "
      >
        {{ phaseLabels[editor.phase] }}
      </van-tag>
    </div>
    <FeedbackState
      :loading="!ready || elders.isPending.value"
      :error="elders.error.value || tasks.error.value"
      @retry="retryQueries"
    />
    <div class="action-row">
      <van-button
        v-if="saveError && !frozen"
        :disabled="busy"
        @click="copyAsNew"
      >
        另存当前内容
      </van-button>
      <van-button
        icon="plus"
        size="small"
        :disabled="busy || !ready"
        @click="newDraft"
      >
        新草稿
      </van-button>
    </div>
    <details class="draft-recovery">
      <summary>
        恢复本机草稿 <span class="muted">{{ drafts.length }} 项</span>
      </summary>
      <label class="select-field"
        >恢复草稿<select v-model="restoreId" :disabled="busy">
          <option value="">请选择</option>
          <option
            v-for="draft in drafts"
            :key="draft.localId"
            :value="draft.localId"
          >
            {{ draft.recoveredFrom ? '其他窗口恢复 · ' : ''
            }}{{ draft.text.slice(0, 20) || '空白草稿' }} ·
            {{ phaseLabels[draft.phase] }} · {{ draft.updatedAt }}
          </option>
        </select></label
      ><van-button
        size="small"
        :disabled="!restoreId || busy"
        @click="restoreDraft"
      >
        恢复所选草稿
      </van-button>
    </details>
    <template v-if="ready">
      <div class="form-band">
        <h2>护理记录</h2>
        <label class="select-field"
          >老人<select
            v-model="editor.elderId"
            :disabled="frozen"
            @change="changed(true)"
          >
            <option value="">请选择老人</option>
            <option
              v-if="
                editor.elderId &&
                !elders.data.value?.some((item) => item.id === editor.elderId)
              "
              :value="editor.elderId"
            >
              {{ editor.elderId }}（当前列表未找到）
            </option>
            <option
              v-for="elder in elders.data.value"
              :key="elder.id"
              :value="elder.id"
            >
              {{ elder.name }} · {{ elder.bedLabel }}
            </option>
          </select></label
        >
        <van-field
          v-model="editor.text"
          label="原文"
          required
          type="textarea"
          rows="5"
          autosize
          :disabled="frozen"
          placeholder="输入护理观察、待办或沟通内容"
          @update:model-value="changed(true)"
        />
        <p v-if="saveError" class="error-text" role="alert">
          {{ saveError }}
        </p>
        <p v-else-if="saved" class="muted" role="status">已保存到本机</p>
        <p v-if="error" class="error-text" role="alert">
          {{ error }}
        </p>
        <p v-if="notice" role="status">
          {{ notice }}
        </p>
        <van-notice-bar
          v-if="editor.phase === 'uncertain'"
          text="提交结果待核实，当前草稿不能重复提交。"
        />
        <div class="action-row">
          <van-button
            v-if="mode === 'demo'"
            :disabled="busy || frozen"
            @click="useExample"
          >
            使用演示原文 </van-button
          ><van-button
            type="primary"
            :loading="busy && editor.phase === 'extracting'"
            :disabled="busy || frozen || !editor.text.trim() || !validElder"
            @click="extractDraft"
          >
            提取AI草稿 </van-button
          ><van-button :disabled="busy || frozen" @click="manual = true">
            手工录入
          </van-button>
        </div>
        <template v-if="editor.ai">
          <h2>AI原始结果</h2>
          <p>
            来源：{{
              editor.ai.draft.provider ||
              (mode === 'demo' ? 'mock（演示）' : '未知，请核实')
            }}
          </p>
          <p v-if="stale" class="error-text">
            原文或老人已变更，旧结果不可确认。
          </p>
          <details class="evidence">
            <summary>提取时的原文证据</summary>
            <p>{{ editor.ai.sourceText }}</p>
            <p>老人编号：{{ compactReference(editor.ai.elderId) }}</p>
            <p>观察：{{ editor.ai.draft.fields.observation }}</p>
            <p>后续：{{ editor.ai.draft.fields.followUp }}</p>
            <p>联系对象：{{ editor.ai.draft.fields.contactTarget }}</p>
            <ul>
              <li v-for="item in editor.ai.draft.evidence" :key="item">
                {{ item }}
              </li>
            </ul>
          </details>
          <p
            v-for="warning in editor.ai.draft.warnings"
            :key="warning"
            class="warning-text"
          >
            {{ warning }}
          </p>
        </template>
        <template v-if="manual || editor.ai">
          <h2>{{ manual ? '手工录入' : '人工核对' }}</h2>
          <RecordReviewForm
            v-model="editor.review"
            :local-assignment="!manual || mode === 'api'"
            :server-mode="mode === 'api'"
            :disabled="frozen || busy"
            :tasks="
              tasks.data.value?.filter(
                (task) => task.elderId === editor.elderId,
              ) ?? []
            "
            @update:model-value="changed()"
          />
          <p v-if="!editor.review.observation.trim()" class="muted">
            请填写观察结果。
          </p>
          <p v-if="manual && mode === 'api'" class="muted">
            确认后提交服务端；后续安排每行生成一项待办。
          </p>
        </template>
        <details v-if="!frozen" class="discard-draft">
          <summary>放弃本机草稿</summary>
          <van-field
            v-model="editor.discardReason"
            label="放弃原因"
            type="textarea"
            @update:model-value="changed()"
          /><van-button
            type="danger"
            plain
            :disabled="busy || !editor.discardReason.trim()"
            @click="discard"
          >
            放弃并保留原文
          </van-button>
        </details>
      </div>
      <footer class="editor-footer hl-glass">
        <p
          class="save-status"
          :class="{ 'error-text': saveError, 'warning-text': !saved }"
          role="status"
        >
          {{
            savingLocal
              ? '正在保存到本机…'
              : saveError || (saved ? '已保存到本机' : '有未保存修改')
          }}<span v-if="editor.phase === 'submitted'"> · 已提交</span
          ><span v-if="editor.phase === 'uncertain'"> · 提交待核实</span>
        </p>
        <div class="footer-actions">
          <van-button
            :disabled="busy || !ready || savingLocal"
            @click="persist"
          >
            <Save :size="17" aria-hidden="true" />保存本机
          </van-button>
          <van-button
            type="primary"
            :loading="editor.phase === 'submitting'"
            :disabled="
              busy ||
              !validElder ||
              frozen ||
              !(manual || editor.ai) ||
              (manual
                ? !editor.elderId ||
                  !editor.text.trim() ||
                  !editor.review.observation.trim()
                : !confirmable)
            "
            @click="confirm"
          >
            <Send :size="17" aria-hidden="true" />{{
              manual && mode === 'demo' ? '提交演示记录' : '确认并提交'
            }}
          </van-button>
        </div>
      </footer>
    </template>
  </section>
</template>
