<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  request,
  listAll,
  fieldError,
  WorkflowRequestError,
  type Row,
} from './model'
import { useWorkspaceScope } from './workspace-scope'
import { date, localTime } from './workspace-time'
import { workspaceStorageKey } from './workspace-action'
import {
  createSummaryMutations,
  familySummary,
  selectionPayload,
  summaryPreview,
  summaryState,
  summaryWorkspace,
  type FamilySummary,
  type PublicSelection,
  type SummaryPreview,
  type SummaryRecord,
  type SummaryWorkspace,
} from './family-summary'

const scope = useWorkspaceScope()
const route = useRoute()
const permitted = computed(
  () => scope.active.value && scope.management && scope.owner?.mode === 'api',
)
const elders = ref<Row[]>([]),
  elderId = ref(''),
  elderSearch = ref('')
const workspace = ref<SummaryWorkspace | null>(null),
  selected = ref<PublicSelection[]>([])
const text = ref(''),
  quotesConfirmed = ref(false),
  preview = ref<SummaryPreview | null>(null),
  previewSignature = ref('')
const start = ref(''),
  end = ref(''),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const history = ref<FamilySummary[]>([]),
  historyError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const saved = ref<FamilySummary | null>(null),
  editedText = ref(''),
  editReason = ref(''),
  savedPreviewText = ref(''),
  publishConfirmed = ref(false)
let epoch = 0,
  elderEpoch = 0,
  historyEpoch = 0
const recoveryBlocked = ref(false)
const journalKey = workspaceStorageKey(
  scope.owner,
  '',
  'family-summary-submission',
)
const mutations = createSummaryMutations(
  request,
  () => permitted.value && scope.valid(),
  () => crypto.randomUUID(),
  {
    read: () => JSON.parse(sessionStorage.getItem(journalKey) || 'null'),
    write: (attempt) => {
      try {
        if (attempt) sessionStorage.setItem(journalKey, JSON.stringify(attempt))
        else sessionStorage.removeItem(journalKey)
      } catch {
        throw new Error(
          '浏览器无法保留或更新提交凭证，请检查本机存储后核实原请求。',
        )
      }
    },
  },
)
const pending = mutations.pending
const locked = computed(
  () => busy.value || !!pending.value || recoveryBlocked.value,
)
const elderOptions = computed(() =>
  elders.value.filter(
    (item) =>
      !elderSearch.value ||
      String(item.name || '').includes(elderSearch.value) ||
      String(item.bed_label || '').includes(elderSearch.value),
  ),
)
const currentStep = computed(() =>
  saved.value
    ? 4
    : freshPreview.value
      ? 4
      : selected.value.length
        ? 3
        : elderId.value
          ? 2
          : 1,
)
const signature = () =>
  workspace.value
    ? JSON.stringify(
        selectionPayload(
          workspace.value,
          selected.value,
          text.value,
          quotesConfirmed.value,
        ),
      )
    : ''
const freshPreview = computed(() => {
  try {
    return !!preview.value && signature() === previewSignature.value
  } catch {
    return false
  }
})
const draftChanged = computed(
  () => !!saved.value && editedText.value !== saved.value.text,
)
const editPreviewFresh = computed(
  () => !!savedPreviewText.value && savedPreviewText.value === editedText.value,
)
const currentName = computed(
  () =>
    workspace.value?.elder.name ||
    String(
      elders.value.find((item) => item.id === elderId.value)?.name ||
        '所选老人',
    ),
)
function time(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间待核实'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
function failure(value: unknown) {
  fieldErrors.value =
    value instanceof WorkflowRequestError ? value.fieldErrors : {}
  return value instanceof Error ? value.message : '操作未完成，请核对后重试。'
}
function clearSelection() {
  fieldErrors.value = {}
  selected.value = []
  text.value = ''
  quotesConfirmed.value = false
  preview.value = null
  previewSignature.value = ''
  saved.value = null
  editedText.value = ''
  editReason.value = ''
  savedPreviewText.value = ''
  publishConfirmed.value = false
}
async function loadElders() {
  const ticket = ++elderEpoch
  try {
    const result = await listAll('/elders')
    if (ticket === elderEpoch && permitted.value && scope.valid())
      elders.value = result
  } catch (value) {
    if (ticket === elderEpoch && scope.valid()) error.value = failure(value)
  }
}
async function loadHistory(ticket = epoch) {
  if (!elderId.value || !permitted.value) return
  const chosen = elderId.value,
    historyTicket = ++historyEpoch
  historyError.value = ''
  try {
    const rows = await listAll(
      '/family/cases?kind=summary&elder_id=' + encodeURIComponent(chosen),
    )
    if (
      ticket === epoch &&
      historyTicket === historyEpoch &&
      elderId.value === chosen &&
      scope.valid()
    )
      history.value = rows.map((item) => familySummary(item, chosen))
  } catch (value) {
    if (ticket === epoch && historyTicket === historyEpoch && scope.valid())
      historyError.value = failure(value)
  }
}
async function loadWorkspace(
  options: {
    usePeriod?: boolean
    offset?: number
    reset?: boolean
    recovery?: boolean
    history?: boolean
  } = {},
) {
  if (!elderId.value || !permitted.value || (locked.value && !options.recovery))
    return
  const chosen = elderId.value,
    ticket = ++epoch
  loading.value = true
  error.value = ''
  notice.value = ''
  if (options.reset !== false) {
    clearSelection()
    workspace.value = null
    history.value = []
  }
  try {
    const query = new URLSearchParams({
      elder_id: chosen,
      limit: '20',
      offset: String(options.offset || 0),
    })
    if (options.usePeriod) {
      const lower = date(start.value),
        upper = date(end.value)
      if (
        Date.parse(lower) >= Date.parse(upper) ||
        Date.parse(upper) > Date.now()
      )
        throw new Error('结束时间须晚于开始时间，且不能晚于当前时间。')
      query.set('period_start', lower)
      query.set('period_end', upper)
    }
    const result = summaryWorkspace(
      await request('/family/summaries/workspace?' + query),
      chosen,
    )
    if (ticket !== epoch || chosen !== elderId.value || !scope.valid()) return
    workspace.value = result
    start.value = localTime(new Date(result.period_start)).slice(0, 19)
    end.value = localTime(new Date(result.period_end)).slice(0, 19)
    if (options.reset !== false || options.history) {
      await loadHistory(ticket)
      if (ticket === epoch && scope.valid() && !locked.value) openRouteSummary()
    }
  } catch (value) {
    if (ticket === epoch && scope.valid()) error.value = failure(value)
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function choose(record: SummaryRecord, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  error.value = ''
  quotesConfirmed.value = false
  if (checked && selected.value.length >= 10) {
    ;(event.target as HTMLInputElement).checked = false
    error.value = '每份简报最多选择10条记录。'
    return
  }
  selected.value = checked
    ? [
        ...selected.value,
        { record_id: record.record_id, public_quote: record.suggested_quote },
      ]
    : selected.value.filter((item) => item.record_id !== record.record_id)
}
function quote(recordId: string, value: string) {
  selected.value = selected.value.map((item) =>
    item.record_id === recordId ? { ...item, public_quote: value } : item,
  )
  quotesConfirmed.value = false
}
async function previewNow() {
  if (!workspace.value || locked.value || loading.value) return
  error.value = ''
  notice.value = ''
  const ticket = epoch
  busy.value = true
  try {
    const payload = selectionPayload(
      workspace.value,
      selected.value,
      text.value,
      quotesConfirmed.value,
    )
    const result = summaryPreview(
      await request('/family/summaries/preview-selection', 'post', payload),
      payload,
    )
    if (ticket !== epoch || !scope.valid()) return
    text.value = result.family_preview.text
    preview.value = result
    previewSignature.value = signature()
    notice.value = '公开正文已预览，可保存草稿。'
  } catch (value) {
    if (ticket === epoch && scope.valid()) error.value = failure(value)
  } finally {
    if (ticket === epoch) busy.value = false
  }
}
function useSummary(item: FamilySummary) {
  if (locked.value) return
  saved.value = item
  editedText.value = item.text
  savedPreviewText.value = ''
  editReason.value = ''
  publishConfirmed.value = false
  error.value = ''
  notice.value = ''
}
function openRouteSummary() {
  const summaryId =
    typeof route.query.summary_id === 'string' ? route.query.summary_id : ''
  if (!summaryId) return
  const item = history.value.find((summary) => summary.id === summaryId)
  if (item) useSummary(item)
  else if (!historyError.value)
    error.value = '这份简报不在当前老人可见的简报列表中，请核对后重新选择。'
}
function syncRoute() {
  if (!permitted.value || locked.value) return
  const chosen =
    typeof route.query.elder_id === 'string'
      ? route.query.elder_id
      : typeof route.query.elder === 'string'
        ? route.query.elder
        : ''
  if (chosen && chosen !== elderId.value) elderId.value = chosen
  else if (chosen === elderId.value && history.value.length) openRouteSummary()
}
async function received(item: FamilySummary | undefined) {
  if (!item || !scope.valid()) return
  saved.value = item
  editedText.value = item.text
  editReason.value = ''
  savedPreviewText.value = ''
  publishConfirmed.value = false
  notice.value =
    item.status === 'published'
      ? '简报已发布，当前有效授权家属可在家属端查看。'
      : item.status === 'withdrawn'
        ? '简报已撤回，家属端停止展示。'
        : '简报草稿已保存。'
  await loadHistory()
}
async function saveDraft() {
  if (
    !workspace.value ||
    !freshPreview.value ||
    !preview.value ||
    locked.value ||
    saved.value
  )
    return
  const ticket = epoch
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const payload = {
      ...selectionPayload(
        workspace.value,
        selected.value,
        text.value,
        quotesConfirmed.value,
      ),
      expected_context_token: preview.value.context_token,
    }
    const item = await mutations.execute(
      '/family/summaries/from-selection',
      'post',
      payload,
      elderId.value,
    )
    if (ticket === epoch) await received(item)
  } catch (value) {
    if (ticket === epoch && scope.valid()) error.value = failure(value)
  } finally {
    if (ticket === epoch) busy.value = false
  }
}
function previewEdited() {
  if (!editedText.value.trim() || editedText.value.trim().length > 2000) {
    error.value = '简报正文应为1至2000字。'
    return
  }
  editedText.value = editedText.value.trim()
  savedPreviewText.value = editedText.value
  publishConfirmed.value = false
  error.value = ''
}
async function updateDraft() {
  if (
    !saved.value ||
    saved.value.status !== 'draft' ||
    !draftChanged.value ||
    locked.value
  )
    return
  if (!editPreviewFresh.value || !editReason.value.trim()) {
    error.value = '请先预览修改后的正文，并填写修改说明。'
    return
  }
  const ticket = epoch
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const item = await mutations.execute(
      '/family/summaries/' + encodeURIComponent(saved.value.id),
      'patch',
      {
        expected_revision: saved.value.revision,
        text: editedText.value,
        reason: editReason.value.trim(),
      },
      elderId.value,
    )
    if (ticket === epoch) await received(item)
  } catch (value) {
    if (ticket === epoch && scope.valid()) error.value = failure(value)
  } finally {
    if (ticket === epoch) busy.value = false
  }
}
async function review(action: 'publish' | 'withdraw') {
  if (!saved.value || locked.value) return
  if (!editReason.value.trim()) {
    error.value =
      action === 'publish' ? '请填写发布核对说明。' : '请填写撤回原因。'
    return
  }
  if (
    action === 'publish' &&
    (!editPreviewFresh.value || draftChanged.value || !publishConfirmed.value)
  ) {
    error.value = '请先预览已保存正文，核对公开范围后确认发布。'
    return
  }
  const ticket = epoch
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const item = await mutations.execute(
      '/family/summaries/' + encodeURIComponent(saved.value.id) + '/review',
      'post',
      {
        expected_revision: saved.value.revision,
        action,
        reason: editReason.value.trim(),
      },
      elderId.value,
    )
    if (ticket === epoch) await received(item)
  } catch (value) {
    if (ticket === epoch && scope.valid()) error.value = failure(value)
  } finally {
    if (ticket === epoch) busy.value = false
  }
}
async function retryOriginal() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  const ticket = epoch
  try {
    const result = await mutations.retry()
    if (ticket === epoch) await received(result)
  } catch (value) {
    if (ticket === epoch && scope.valid()) error.value = failure(value)
  } finally {
    if (ticket === epoch) busy.value = false
  }
}
async function refreshSaved() {
  if (!saved.value || locked.value) return
  const wanted = saved.value.id,
    ticket = epoch,
    chosen = elderId.value
  busy.value = true
  error.value = ''
  try {
    await loadHistory(ticket)
    if (historyError.value) return
    const latest = summaryWorkspace(
      await request(
        '/family/summaries/workspace?' +
          new URLSearchParams({ elder_id: chosen, limit: '1' }),
      ),
      chosen,
    )
    if (ticket !== epoch || !scope.valid()) return
    const current = history.value.find((item) => item.id === wanted)
    if (!current) {
      error.value = '未找到当前简报，请刷新简报列表。'
      return
    }
    saved.value = current
    if (workspace.value)
      workspace.value = {
        ...workspace.value,
        recipients: latest.recipients,
        recipient_count: latest.recipient_count,
        can_publish: latest.can_publish,
        current_admission_id: latest.current_admission_id,
        context_notice: latest.context_notice,
      }
    savedPreviewText.value = ''
    publishConfirmed.value = false
    notice.value =
      editedText.value === current.text
        ? '已读取当前简报与家属授权，请重新核对后办理。'
        : '已读取当前简报与家属授权，本页保留了你的修改，请比对后决定是否保存。'
  } catch (value) {
    if (ticket === epoch && scope.valid()) error.value = failure(value)
  } finally {
    if (ticket === epoch) busy.value = false
  }
}
watch(elderId, () => {
  epoch++
  workspace.value = null
  history.value = []
  historyError.value = ''
  clearSelection()
  error.value = ''
  notice.value = ''
  if (elderId.value)
    void loadWorkspace(
      pending.value?.elderId === elderId.value
        ? { reset: false, recovery: true }
        : {},
    )
})
watch([editedText, editReason], () => {
  publishConfirmed.value = false
})
watch([text, editedText, editReason, start, end, quotesConfirmed], () => {
  fieldErrors.value = {}
})
watch(
  selected,
  () => {
    fieldErrors.value = {}
  },
  { deep: true },
)
watch(
  () => [route.query.elder_id, route.query.elder, route.query.summary_id],
  syncRoute,
)
watch(scope.active, (active) => {
  if (!active) {
    epoch++
    elderEpoch++
    elders.value = []
    workspace.value = null
    history.value = []
    clearSelection()
    mutations.clear()
  }
})
onMounted(() => {
  if (!permitted.value) return
  void loadElders()
  try {
    mutations.restore()
    if (pending.value) {
      elderId.value = pending.value.elderId
    } else syncRoute()
  } catch {
    recoveryBlocked.value = true
    error.value = '本机简报提交凭证无法读取，请先联系管理员核对结果。'
  }
})
onBeforeUnmount(() => {
  epoch++
  elderEpoch++
})
defineExpose({
  refresh: () =>
    elderId.value
      ? loadWorkspace({
          usePeriod: !!workspace.value,
          reset: false,
          history: true,
        })
      : loadElders(),
})
</script>

<template>
  <section
    v-if="permitted"
    class="summary-workspace"
    aria-label="家属简报工作区"
    :aria-busy="loading || busy"
  >
    <header class="summary-heading">
      <div>
        <p class="summary-eyebrow">
          家属沟通
        </p>
        <h2>把已核对的照护近况分享给家属</h2>
        <p>选记录、核对正文，再明确发布。</p>
      </div>
      <ol
        class="summary-steps"
        aria-label="简报办理步骤"
      >
        <li
          v-for="(step, index) in [
            '选择老人',
            '选择记录',
            '预览正文',
            '保存与发布',
          ]"
          :key="step"
          :aria-current="currentStep === index + 1 ? 'step' : undefined"
        >
          <span>{{ index + 1 }}</span>{{ step }}
        </li>
      </ol>
    </header>
    <div
      v-if="error"
      class="summary-error"
      role="alert"
    >
      {{ error }}
    </div>
    <p
      v-if="notice"
      class="summary-notice"
      role="status"
    >
      {{ notice }}
    </p>
    <div
      v-if="pending"
      class="summary-warning"
      role="status"
    >
      <p>上一笔操作尚未收到确定回执，输入已保留。请使用原请求核实结果。</p>
      <button
        type="button"
        :disabled="busy"
        @click="retryOriginal"
      >
        {{ busy ? '正在核实' : '重试原请求并核实结果' }}
      </button>
    </div>
    <section
      class="summary-section"
      aria-labelledby="summary-choose"
    >
      <h3 id="summary-choose">
        1. 选择老人
      </h3>
      <div class="summary-grid">
        <label>查找老人<input
          v-model="elderSearch"
          type="search"
          placeholder="姓名或床位"
          :disabled="locked"
        ></label>
        <label>老人<CareSelect
          v-model="elderId"
          :disabled="locked || loading"
        >
          <option value="">请选择老人</option>
          <option
            v-for="elder in elderOptions"
            :key="String(elder.id)"
            :value="String(elder.id)"
          >
            {{ elder.name
            }}{{ elder.bed_label ? ' · ' + elder.bed_label : '' }}
          </option>
        </CareSelect></label>
      </div>
      <button
        v-if="!elders.length"
        type="button"
        :disabled="locked"
        @click="loadElders"
      >
        重新读取老人列表
      </button>
    </section>
    <p
      v-if="loading"
      role="status"
    >
      正在读取{{ currentName }}的简报资料……
    </p>
    <template v-if="workspace">
      <p
        v-if="workspace.context_notice"
        class="summary-warning"
      >
        {{ workspace.context_notice }}
      </p>
      <div class="summary-audience">
        <strong>{{ currentName }} · 当前可接收家属
          {{ workspace.recipient_count }} 人</strong><span>{{
          workspace.recipients.map((item) => item.display_name).join('、') ||
            '暂无有效简报授权，可先保存草稿，授权完成后再发布。'
        }}</span>
      </div>
      <section
        class="summary-section"
        aria-labelledby="summary-records"
      >
        <div class="summary-title-row">
          <h3 id="summary-records">
            2. 选择记录 <small>已选 {{ selected.length }}/10 条</small>
          </h3>
          <button
            type="button"
            :disabled="locked || loading"
            @click="loadWorkspace()"
          >
            重新读取今日记录
          </button>
        </div>
        <form
          class="summary-grid"
          @submit.prevent="loadWorkspace({ usePeriod: true })"
        >
          <label>开始时间（北京时间）<CareDateTime
            v-model="start"
            type="datetime-local"
            step="1"
            required
            :aria-invalid="!!fieldError(fieldErrors, 'period_start')"
            :disabled="locked || loading"
          /><span
            v-if="fieldError(fieldErrors, 'period_start')"
            class="summary-field-error"
            role="alert"
          >{{ fieldError(fieldErrors, 'period_start') }}</span></label>
          <label>结束时间（北京时间，不含）<CareDateTime
            v-model="end"
            type="datetime-local"
            step="1"
            required
            :aria-invalid="!!fieldError(fieldErrors, 'period_end')"
            :disabled="locked || loading"
          /><span
            v-if="fieldError(fieldErrors, 'period_end')"
            class="summary-field-error"
            role="alert"
          >{{ fieldError(fieldErrors, 'period_end') }}</span></label>
          <button
            type="submit"
            :disabled="locked || loading"
          >
            按时段读取
          </button>
        </form>
        <p
          v-if="!workspace.items.length && !loading"
          class="summary-empty"
        >
          这个时段暂无本次入住记录。可以调整时段，或先保存并确认日常照护记录。
        </p>
        <div class="summary-record-list">
          <article
            v-for="record in workspace.items"
            :key="record.record_id"
            class="summary-record"
            :class="{
              'is-selected': selected.some(
                (item) => item.record_id === record.record_id,
              ),
            }"
          >
            <label class="summary-check"><input
              type="checkbox"
              :checked="
                selected.some((item) => item.record_id === record.record_id)
              "
              :disabled="locked || !!saved || !record.selectable || loading"
              @change="choose(record, $event)"
            ><span>{{
              record.suggested_quote || '尚无正式观察内容'
            }}</span></label>
            <p class="summary-meta">
              发生：{{ time(record.happened_at) }} · 登记：{{
                time(record.recorded_at)
              }}
            </p>
            <p
              v-if="!record.selectable"
              class="summary-warning"
            >
              {{ record.unavailable_reason }}
            </p>
            <details v-if="record.public_fragments.length > 1">
              <summary>查看这条记录的其他观察片段</summary>
              <ul>
                <li
                  v-for="(fragment, index) in record.public_fragments"
                  :key="index"
                >
                  {{ fragment }}
                </li>
              </ul>
            </details>
            <label
              v-if="
                selected.some((item) => item.record_id === record.record_id)
              "
            >本条拟公开片段<textarea
              :value="
                selected.find((item) => item.record_id === record.record_id)
                  ?.public_quote
              "
              maxlength="1000"
              rows="3"
              :disabled="locked || !!saved"
              @input="
                quote(
                  record.record_id,
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            /><span class="summary-meta">从记录原文中保留适合家属阅读的部分。</span></label>
          </article>
        </div>
        <p
          v-if="selected.length && workspace.total > workspace.items.length"
          class="summary-meta"
        >
          跨页选择会保留，共已选择 {{ selected.length }} 条。
        </p>
        <nav
          v-if="workspace.total > workspace.limit"
          class="summary-pagination"
          aria-label="候选记录分页"
        >
          <button
            type="button"
            :disabled="locked || loading || workspace.offset === 0"
            @click="
              loadWorkspace({
                usePeriod: true,
                offset: Math.max(0, workspace.offset - workspace.limit),
                reset: false,
              })
            "
          >
            上一页
          </button><span>第 {{ Math.floor(workspace.offset / workspace.limit) + 1 }} 页 · 共
            {{ workspace.total }} 条</span><button
            type="button"
            :disabled="
              locked ||
                loading ||
                workspace.offset + workspace.items.length >= workspace.total
            "
            @click="
              loadWorkspace({
                usePeriod: true,
                offset: workspace.offset + workspace.limit,
                reset: false,
              })
            "
          >
            下一页
          </button>
        </nav>
      </section>
      <section
        v-if="!saved"
        class="summary-section"
        aria-labelledby="summary-preview"
      >
        <h3 id="summary-preview">
          3. 编写并预览公开正文
        </h3>
        <label class="summary-check"><input
          v-model="quotesConfirmed"
          type="checkbox"
          :disabled="locked || !selected.length"
        ><span>我已逐条核对拟公开片段及披露范围。</span></label>
        <label>公开正文<textarea
          v-model="text"
          rows="7"
          maxlength="2000"
          :aria-invalid="!!fieldError(fieldErrors, 'text')"
          :disabled="locked || !selected.length"
          placeholder="可自行编写；留空时按已核对片段组成正文。"
        /><span class="summary-meta">{{ text.length }}/2000 字</span><span
          v-if="fieldError(fieldErrors, 'text')"
          class="summary-field-error"
          role="alert"
        >{{ fieldError(fieldErrors, 'text') }}</span></label>
        <button
          class="summary-primary"
          type="button"
          :disabled="locked || loading || !selected.length || !quotesConfirmed"
          @click="previewNow"
        >
          {{ busy ? '正在处理' : '预览家属将看到的内容' }}
        </button>
        <article
          v-if="preview"
          class="summary-public-preview"
          aria-label="公开简报预览"
        >
          <p class="summary-eyebrow">
            家属将看到的正文
          </p>
          <h4>{{ currentName }}的照护近况</h4>
          <p class="summary-meta">
            {{ time(preview.family_preview.period_start) }} —
            {{ time(preview.family_preview.period_end) }}
          </p>
          <p class="summary-public-text">
            {{ preview.family_preview.text }}
          </p>
          <p
            v-if="!freshPreview"
            class="summary-warning"
          >
            内容或选择已有改动，请重新预览。
          </p>
        </article>
        <div class="summary-save">
          <h3>4. 保存草稿，再确认发布</h3>
          <button
            class="summary-primary"
            type="button"
            :disabled="locked || loading || !freshPreview"
            @click="saveDraft"
          >
            保存简报草稿
          </button>
        </div>
      </section>
      <section
        v-if="saved"
        class="summary-section"
        aria-labelledby="summary-saved"
      >
        <div class="summary-title-row">
          <h3 id="summary-saved">
            {{ summaryState[saved.status] }} · {{ currentName }}的照护近况
          </h3>
          <button
            type="button"
            :disabled="locked || loading"
            @click="loadWorkspace()"
          >
            新建下一份简报
          </button>
        </div>
        <p class="summary-meta">
          {{ time(saved.period_start) }} — {{ time(saved.period_end) }}
        </p>
        <label>{{ saved.status === 'draft' ? '编辑草稿正文' : '已保存正文'
        }}<textarea
          v-model="editedText"
          maxlength="2000"
          rows="7"
          :aria-invalid="!!fieldError(fieldErrors, 'text')"
          :readonly="saved.status !== 'draft'"
          :disabled="locked"
        /><span class="summary-meta">{{ editedText.length }}/2000 字</span><span
          v-if="fieldError(fieldErrors, 'text')"
          class="summary-field-error"
          role="alert"
        >{{ fieldError(fieldErrors, 'text') }}</span></label>
        <details v-if="draftChanged">
          <summary>对比当前已保存正文</summary>
          <p class="summary-public-text">
            {{ saved.text }}
          </p>
        </details>
        <div class="summary-actions">
          <button
            type="button"
            :disabled="locked"
            @click="previewEdited"
          >
            预览当前正文
          </button><button
            type="button"
            :disabled="locked"
            @click="refreshSaved"
          >
            读取当前状态，保留本页修改
          </button>
        </div>
        <article
          v-if="savedPreviewText"
          class="summary-public-preview"
          aria-label="已保存简报公开预览"
        >
          <p class="summary-eyebrow">
            家属正文预览
          </p>
          <h4>{{ currentName }}的照护近况</h4>
          <p class="summary-meta">
            {{ time(saved.period_start) }} — {{ time(saved.period_end) }}
          </p>
          <p class="summary-public-text">
            {{ savedPreviewText }}
          </p>
          <p
            v-if="!editPreviewFresh"
            class="summary-warning"
          >
            正文已有改动，请重新预览。
          </p>
        </article>
        <template v-if="saved.status === 'draft'">
          <label>{{ draftChanged ? '修改说明' : '发布核对说明'
          }}<textarea
            v-model="editReason"
            maxlength="2000"
            rows="2"
            :aria-invalid="!!fieldError(fieldErrors, 'reason')"
            :disabled="locked"
          /><span
            v-if="fieldError(fieldErrors, 'reason')"
            class="summary-field-error"
            role="alert"
          >{{ fieldError(fieldErrors, 'reason') }}</span>
          </label>
          <button
            v-if="draftChanged"
            type="button"
            :disabled="locked || !editPreviewFresh || !editReason.trim()"
            @click="updateDraft"
          >
            保存修改后的草稿
          </button>
          <template v-else>
            <label class="summary-check"><input
              v-model="publishConfirmed"
              type="checkbox"
              :disabled="locked || !editPreviewFresh"
            ><span>我已核对公开正文，同意向当前有效授权家属发布。</span></label><button
              class="summary-primary"
              type="button"
              :disabled="
                locked ||
                  !editPreviewFresh ||
                  !publishConfirmed ||
                  !editReason.trim() ||
                  !workspace.can_publish
              "
              @click="review('publish')"
            >
              确认发布简报
            </button>
            <p
              v-if="!workspace.can_publish"
              class="summary-warning"
            >
              当前没有有效授权家属，草稿已保留。请在下方授权管理中完成授权，再重新读取资料。
            </p>
          </template>
        </template>
        <template v-else-if="saved.status === 'published'">
          <label>撤回原因<textarea
            v-model="editReason"
            maxlength="2000"
            rows="2"
            :disabled="locked"
          /></label><button
            class="summary-danger"
            type="button"
            :disabled="locked || !editReason.trim()"
            @click="review('withdraw')"
          >
            确认撤回这份简报
          </button>
        </template>
      </section>
      <section
        class="summary-section"
        aria-labelledby="summary-history"
      >
        <div class="summary-title-row">
          <h3 id="summary-history">
            已有简报
          </h3>
          <button
            type="button"
            :disabled="locked"
            @click="loadHistory()"
          >
            刷新简报列表
          </button>
        </div>
        <p
          v-if="historyError"
          class="summary-error"
          role="alert"
        >
          {{ historyError }}
        </p>
        <p
          v-if="!history.length && !historyError && !loading"
          class="summary-empty"
        >
          暂无简报。选取记录后可保存第一份草稿。
        </p>
        <ul class="summary-history">
          <li
            v-for="item in history"
            :key="item.id"
          >
            <div>
              <strong>{{ summaryState[item.status] }}</strong><span>{{ time(item.period_start) }} —
                {{ time(item.period_end) }}</span>
              <p>
                {{ item.text.slice(0, 100)
                }}{{ item.text.length > 100 ? '…' : '' }}
              </p>
            </div>
            <button
              type="button"
              :disabled="locked"
              @click="useSummary(item)"
            >
              {{
                item.status === 'draft'
                  ? '编辑与发布'
                  : item.status === 'published'
                    ? '查看与撤回'
                    : '查看正文'
              }}
            </button>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.summary-workspace {
  display: grid;
  gap: 18px;
  min-width: 0;
  color: var(--hl-text, #243c36);
}
.summary-heading {
  display: grid;
  gap: 18px;
  padding: 24px;
  border: 1px solid #d5e5df;
  border-radius: 18px;
  background: #f3f8f4;
}
.summary-heading h2 {
  margin: 4px 0 8px;
  font-size: 24px;
  line-height: 1.35;
}
.summary-heading p {
  margin: 0;
  line-height: 1.65;
}
.summary-eyebrow {
  font-size: 12px;
  font-weight: 700;
  color: #4c7166;
  letter-spacing: 0.08em;
}
.summary-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.summary-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.4;
  font-size: 14px;
  color: #50695f;
}
.summary-steps li span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  background: #e1ebe5;
  font-weight: 700;
}
.summary-steps [aria-current] span {
  background: #22745d;
  color: white;
}
.summary-section {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--hl-border, #dce5df);
  border-radius: 16px;
  background: #fffefa;
}
.summary-section h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.5;
}
.summary-section h3 small {
  font-weight: 400;
  color: #546b61;
  font-size: 14px;
}
.summary-title-row,
.summary-actions,
.summary-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.summary-actions {
  justify-content: flex-start;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: end;
}
.summary-grid button {
  justify-self: start;
}
.summary-workspace label {
  display: grid;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
}
.summary-workspace input:not([type='checkbox']),
.summary-workspace select,
.summary-workspace textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #b6c9bf;
  border-radius: 9px;
  background: white;
  color: inherit;
  font: inherit;
}
.summary-workspace textarea {
  resize: vertical;
  line-height: 1.7;
}
.summary-workspace button {
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid #b6c9bf;
  border-radius: 9px;
  background: #fffefa;
  color: #285f4c;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.summary-workspace button:disabled {
  cursor: default;
  opacity: 0.55;
}
.summary-workspace button:focus-visible,
.summary-workspace input:focus-visible,
.summary-workspace textarea:focus-visible,
.summary-workspace select:focus-visible,
.summary-workspace summary:focus-visible {
  outline: 3px solid #4282b5;
  outline-offset: 3px;
}
.summary-workspace .summary-primary {
  background: #226d55;
  border-color: #226d55;
  color: white;
}
.summary-workspace .summary-danger {
  color: #a0392f;
  border-color: #c67d74;
  background: #fff3ef;
}
.summary-audience {
  display: grid;
  gap: 6px;
  padding: 14px 18px;
  border-radius: 10px;
  background: #edf3f8;
  font-size: 14px;
  line-height: 1.7;
}
.summary-record-list {
  display: grid;
  gap: 12px;
}
.summary-record {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid #dce5df;
  border-radius: 12px;
}
.summary-record.is-selected {
  border-color: #679983;
  background: #f4f9f4;
}
.summary-record p {
  margin: 0;
}
.summary-workspace .summary-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  font-weight: 400;
  cursor: pointer;
}
.summary-check input {
  width: 20px;
  height: 20px;
  flex: none;
  margin: 2px 0;
  accent-color: #226d55;
}
.summary-record details {
  font-size: 14px;
  line-height: 1.7;
}
.summary-record summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #285f4c;
}
.summary-record ul {
  padding-left: 22px;
  margin-top: 0;
}
.summary-meta {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.65;
  color: #586c63;
}
.summary-error,
.summary-warning,
.summary-notice {
  padding: 12px 16px;
  border-radius: 9px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.summary-error {
  background: #fff0ec;
  color: #8f3028;
  border: 1px solid #e1b1a7;
}
.summary-warning {
  margin: 0;
  background: #fff4d9;
  color: #785315;
}
.summary-notice {
  margin: 0;
  background: #edf7ee;
  color: #295d3a;
}
.summary-warning p {
  margin: 0 0 10px;
}
.summary-empty {
  margin: 0;
  padding: 20px;
  border-radius: 10px;
  background: #f4f6f3;
  color: #54675f;
  line-height: 1.8;
}
.summary-public-preview {
  padding: 20px;
  border: 1px solid #d1e1ea;
  border-radius: 12px;
  background: #f5f9fc;
}
.summary-public-preview h4 {
  margin: 8px 0;
  font-size: 18px;
}
.summary-public-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.9;
}
.summary-save {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #e1e8e1;
  padding-top: 18px;
}
.summary-history {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.summary-history li {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #e3e9e3;
  padding-top: 14px;
}
.summary-history li div {
  min-width: 0;
}
.summary-history li span {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  color: #586c63;
}
.summary-history li p {
  margin: 7px 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.summary-history button {
  flex: none;
}
@media (max-width: 640px) {
  .summary-heading,
  .summary-section {
    padding: 16px;
  }
  .summary-heading h2 {
    font-size: 21px;
  }
  .summary-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .summary-grid {
    grid-template-columns: 1fr;
  }
  .summary-history li {
    align-items: flex-start;
    flex-direction: column;
  }
  .summary-pagination {
    justify-content: center;
  }
  .summary-title-row {
    align-items: flex-start;
  }
  .summary-workspace button {
    font-size: 14px;
  }
}
</style>
