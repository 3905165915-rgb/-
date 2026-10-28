<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Mic, RefreshCw, Send, Square } from 'lucide-vue-next'
import { readSession, taskStatusLabels } from '@hulao/shared'
import {
  incomingShiftOptions,
  selectHandoverShifts,
  sourceShiftOptions,
} from './handover-shifts'
import { useTasks, useElders } from '../services/data'
import {
  request,
  type Row,
} from '../../../../packages/shared/src/workflow/model'
import { toCloudWav } from '../../../../packages/shared/src/workflow/audio'
import { useVoiceRecorder } from '../../../../packages/shared/src/workflow/voice-recorder'
import {
  readSpeechResponse,
  speechErrorMessage,
} from '../../../../packages/shared/src/workflow/speech-response'
import {
  object,
  rows,
  workspaceDate,
} from '../../../../packages/shared/src/workflow/workspace-action'

type Handover = Row & { items: Row[] }
type Suggestion = Row & {
  id: string
  title: string
  evidence_text: string
  condition?: string
  due_text?: string
}
type AcceptedTask = {
  suggestion_id: string
  elder_id: string
  title: string
  shift_id: string
  assigned_to: string
  due_at: string
  completion_criteria: string
}
const tasks = useTasks()
const elders = useElders()
const shifts = ref<Row[]>([])
const rawTasks = ref<Row[]>([])
const staff = ref<Row[]>([])
const sourceShiftId = ref('')
const targetShiftId = ref('')
const note = ref('')
const handover = ref<Handover | null>(null)
const summary = ref('')
const suggestions = ref<Suggestion[]>([])
const accepted = ref<Record<string, AcceptedTask>>({})
const selectedSuggestions = ref<Record<string, boolean>>({})
const busy = ref(false)
const analyzing = ref(false)
const submitting = ref(false)
const transcribing = ref(false)
const error = ref('')
const notice = ref('')
const voice = useVoiceRecorder({
  onAudio: transcribe,
  onError: (message) => {
    error.value = message
  },
})
const {
  recording,
  starting,
  finishing,
  seconds,
  locked: recordingLocked,
} = voice
const reviewMode = ref<'ai' | 'manual' | ''>('')
const reviewedNote = ref('')
const reviewChanged = computed(
  () => !!reviewMode.value && reviewedNote.value !== note.value.trim(),
)
const draftKey = computed(() => {
  const current = readSession()
  return (
    'hulao:handover-quick:v1:' +
    JSON.stringify([current?.accountKey, current?.userId, current?.role])
  )
})
let transcription: AbortController | undefined
let disposed = false
let speechEpoch = 0
const sourceOptions = computed(() =>
  sourceShiftOptions(
    shifts.value,
    readSession()?.userId || '',
    readSession()?.role || '',
  ),
)
const targetOptions = computed(() =>
  incomingShiftOptions(shifts.value, sourceShiftId.value),
)
const displayedSources = computed(() =>
  handover.value && handover.value.status !== 'draft'
    ? shifts.value.filter((row) => row.id === handover.value?.source_shift_id)
    : sourceOptions.value,
)
const displayedTargets = computed(() =>
  handover.value && handover.value.status !== 'draft'
    ? shifts.value.filter((row) => row.id === handover.value?.target_shift_id)
    : targetOptions.value,
)
const shiftIssue = computed(() => {
  if (busy.value) return '正在载入班次…'
  if (!sourceOptions.value.some((row) => row.id === sourceShiftId.value))
    return '请先选择要交出的班次；没有可选班次时，请联系主管安排。'
  if (!targetOptions.value.length)
    return '尚未安排后续接班班次，请联系主管先安排下一班。'
  if (!targetOptions.value.some((row) => row.id === targetShiftId.value))
    return '请选择晚于交出班次的接班班次。'
  return ''
})
const sourceTasks = computed(() =>
  rawTasks.value.filter(
    (task) =>
      task.status !== 'completed' &&
      task.status !== 'cancelled' &&
      task.shift_id === sourceShiftId.value,
  ),
)
function taskElder(task: Row) {
  return (
    task.elder_name ||
    elders.data.value?.find((row) => row.id === task.elder_id)?.name ||
    '老人资料待核实'
  )
}
function taskOwner(task: Row) {
  return (
    task.assignee_name ||
    task.assigned_name ||
    staff.value.find((row) => row.id === task.assigned_to)?.display_name ||
    '待安排责任人'
  )
}
function taskStatus(task: Row) {
  return taskStatusLabels[String(task.status)] || '状态待核实'
}
function staffOptions(shiftId: string) {
  const shift = shifts.value.find((row) => row.id === shiftId)
  const ids = Array.isArray(shift?.caregiver_ids) ? shift.caregiver_ids : []
  return staff.value.filter(
    (user) => ids.includes(user.id) && user.active !== false,
  )
}
function persistDraft() {
  try {
    const value = {
      sourceShiftId: sourceShiftId.value,
      targetShiftId: targetShiftId.value,
      note: note.value,
      handoverId: handover.value?.id || '',
    }
    if (
      value.sourceShiftId ||
      value.targetShiftId ||
      value.note ||
      value.handoverId
    )
      sessionStorage.setItem(draftKey.value, JSON.stringify(value))
    else sessionStorage.removeItem(draftKey.value)
  } catch {
    error.value = '交班草稿暂存失败，请保持当前页面并继续核对。'
  }
}
function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(draftKey.value)
    if (!raw) return ''
    const value = object(JSON.parse(raw))
    sourceShiftId.value =
      typeof value.sourceShiftId === 'string' ? value.sourceShiftId : ''
    targetShiftId.value =
      typeof value.targetShiftId === 'string' ? value.targetShiftId : ''
    note.value = typeof value.note === 'string' ? value.note : ''
    return typeof value.handoverId === 'string' ? value.handoverId : ''
  } catch {
    error.value = '本机交班草稿无法读取，请核实服务器状态后再继续。'
    return ''
  }
}
function applyHandover(value: unknown) {
  const row = object(value) as Handover
  handover.value = row
  summary.value = String(object(row.ai_summary || {}).text || '')
  reviewMode.value = row.ai_summary ? 'ai' : ''
  reviewedNote.value = String(object(row.ai_summary || {}).input_text || '')
  suggestions.value = Array.isArray(row.handover_suggestions)
    ? row.handover_suggestions.map((item) => object(item) as Suggestion)
    : []
  if (suggestions.value.length) initializeAccepted()
  persistDraft()
}
async function recoverHandover(savedId: string) {
  let existing: Row | undefined
  if (savedId) {
    try {
      existing = object(
        await request('/handovers/' + encodeURIComponent(savedId)),
      )
    } catch {
      existing = undefined
    }
  }
  if (!existing && sourceShiftId.value && targetShiftId.value) {
    const listing = rows(
      await request(
        '/handovers?shift_id=' + encodeURIComponent(sourceShiftId.value),
      ),
    )
    existing = listing.find(
      (row) =>
        row.source_shift_id === sourceShiftId.value &&
        row.target_shift_id === targetShiftId.value &&
        row.status === 'draft',
    )
  }
  if (
    existing &&
    (existing.source_shift_id !== sourceShiftId.value ||
      existing.target_shift_id !== targetShiftId.value)
  )
    existing = undefined
  if (existing && existing.status === 'draft') applyHandover(existing)
  else if (
    existing &&
    ['submitted', 'received'].includes(String(existing.status))
  ) {
    applyHandover(existing)
    notice.value = '交班已提交；已从服务器核实结果。'
    sessionStorage.removeItem(draftKey.value)
  }
}
function initializeAccepted() {
  selectedSuggestions.value = Object.fromEntries(
    suggestions.value.map((item) => [item.id, false]),
  )
  accepted.value = Object.fromEntries(
    suggestions.value.map((item) => [
      item.id,
      {
        suggestion_id: item.id,
        elder_id: '',
        title: item.title,
        shift_id: targetShiftId.value,
        assigned_to: '',
        due_at: '',
        completion_criteria: '',
      },
    ]),
  )
}
async function load(recover = true) {
  busy.value = true
  error.value = ''
  const savedId = restoreDraft()
  try {
    const [shiftRows, staffRows, taskRows] = await Promise.all([
      request('/shifts?limit=200&offset=0'),
      request('/staff?limit=200&offset=0'),
      request('/tasks'),
    ])
    shifts.value = rows(shiftRows)
    staff.value = rows(staffRows)
    rawTasks.value = rows(taskRows)
    if (handover.value && handover.value.status !== 'draft') return
    const previousPair = [sourceShiftId.value, targetShiftId.value].join('|')
    const session = readSession()
    const pair = selectHandoverShifts(
      shifts.value,
      session?.userId || '',
      session?.role || '',
      sourceShiftId.value,
      targetShiftId.value,
    )
    sourceShiftId.value = pair.sourceId
    targetShiftId.value = pair.targetId
    if (previousPair !== [pair.sourceId, pair.targetId].join('|')) {
      handover.value = null
      reviewMode.value = ''
      if (note.value.trim())
        notice.value =
          '交班文字已保留，已为你修正交出和接入班次，请核对后继续。'
    }
    if (recover && sourceShiftId.value && targetShiftId.value)
      await recoverHandover(savedId)
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : '交班资料载入失败。'
  } finally {
    busy.value = false
  }
}
function sourceChanged() {
  targetShiftId.value = String(targetOptions.value[0]?.id || '')
  handover.value = null
  reviewMode.value = ''
  persistDraft()
}
function changeShifts() {
  const wasSubmitted = handover.value && handover.value.status !== 'draft'
  handover.value = null
  reviewMode.value = ''
  summary.value = ''
  suggestions.value = []
  if (wasSubmitted) {
    note.value = ''
    sourceShiftId.value = ''
    targetShiftId.value = ''
  }
  persistDraft()
  void load(false)
}
async function prepareHandover() {
  if (shiftIssue.value) throw new Error(shiftIssue.value)
  if (!handover.value) await recoverHandover('')
  if (!handover.value)
    applyHandover(
      await request('/handovers', 'post', {
        source_shift_id: sourceShiftId.value,
        target_shift_id: targetShiftId.value,
      }),
    )
  if (!handover.value || handover.value.status !== 'draft')
    throw new Error('本次交班已提交，请点击“开始下一次交班”。')
  // Refresh sources before either review path; never submit an out-of-date snapshot.
  applyHandover(
    await request(
      '/handovers/' +
        encodeURIComponent(String(handover.value.id)) +
        '/refresh',
      'post',
    ),
  )
  return handover.value!
}
async function manualReview() {
  if (
    busy.value ||
    analyzing.value ||
    submitting.value ||
    shiftIssue.value ||
    !note.value.trim()
  )
    return
  analyzing.value = true
  error.value = ''
  try {
    await prepareHandover()
    summary.value = note.value.trim()
    suggestions.value = []
    reviewMode.value = 'manual'
    reviewedNote.value = note.value.trim()
    notice.value = '请核对交班内容和待接续事项，再提交交班。'
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : '交班准备失败，文字已保留。'
  } finally {
    analyzing.value = false
  }
}
async function transcribe(blob: Blob) {
  if (disposed || transcribing.value) return
  const ticket = speechEpoch
  const controller = new AbortController()
  transcription = controller
  const timeout = setTimeout(() => controller.abort(), 90000)
  transcribing.value = true
  error.value = ''
  try {
    const wav = await toCloudWav(blob)
    if (disposed || ticket !== speechEpoch || controller.signal.aborted) return
    const session = readSession()
    const response = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '') +
        '/speech/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session?.accessToken,
          'Content-Type': 'audio/wav',
        },
        body: wav,
        signal: controller.signal,
      },
    )
    const body = await readSpeechResponse(response)
    if (disposed || ticket !== speechEpoch) return
    note.value = [note.value, body.text].filter(Boolean).join('\n')
    notice.value = '转写已填入交班内容，请核对并编辑后再分析。'
  } catch (failure) {
    if (!disposed && ticket === speechEpoch)
      error.value = speechErrorMessage(failure)
  } finally {
    clearTimeout(timeout)
    if (ticket === speechEpoch) transcribing.value = false
  }
}
function toggleRecording() {
  error.value = ''
  void voice.toggle()
}
function cancelAudio() {
  speechEpoch++
  voice.cancel()
  transcription?.abort()
  transcribing.value = false
}
async function analyze() {
  if (recording.value || recordingLocked.value || transcribing.value) return
  if (
    !!shiftIssue.value ||
    busy.value ||
    submitting.value ||
    analyzing.value ||
    !note.value.trim()
  )
    return
  analyzing.value = true
  error.value = ''
  notice.value = ''
  try {
    const currentHandover = await prepareHandover()
    if (!currentHandover) throw new Error('交班单尚未创建，请重试。')
    const result = object(
      await request(
        '/handovers/' +
          encodeURIComponent(String(currentHandover.id)) +
          '/ai-summary',
        'post',
        {
          expected_revision: Number(currentHandover.revision),
          text: note.value.trim(),
        },
        crypto.randomUUID(),
      ),
    )
    applyHandover(result)
    reviewedNote.value = note.value.trim()
    notice.value = '分析已完成；请核对摘要和新待办，再提交交班。'
  } catch (failure) {
    error.value =
      '交班内容已保留；分析未完成，可重试。' +
      (failure instanceof Error ? failure.message : '')
    if (handover.value?.id) {
      try {
        await recoverHandover(String(handover.value.id))
      } catch {
        /* Keep the editable local draft; refresh remains available. */
      }
    }
  } finally {
    analyzing.value = false
  }
}
function canAccept(id: string) {
  const item = accepted.value[id]
  return (
    !!selectedSuggestions.value[id] &&
    !!item &&
    item.elder_id &&
    item.title.trim() &&
    item.shift_id &&
    item.assigned_to &&
    item.due_at &&
    item.completion_criteria.trim()
  )
}
async function submit() {
  if (recording.value || recordingLocked.value || transcribing.value) return
  if (
    !handover.value ||
    handover.value.status !== 'draft' ||
    submitting.value ||
    !summary.value.trim() ||
    reviewChanged.value ||
    !reviewMode.value ||
    analyzing.value ||
    suggestions.value.some(
      (item) => selectedSuggestions.value[item.id] && !canAccept(item.id),
    )
  )
    return
  submitting.value = true
  error.value = ''
  try {
    const acceptedTasks = suggestions.value
      .filter((item) => canAccept(item.id))
      .map((item) => ({
        ...accepted.value[item.id],
        due_at: accepted.value[item.id].due_at + ':00+08:00',
      }))
    const result = object(
      await request(
        '/handovers/' +
          encodeURIComponent(String(handover.value.id)) +
          '/submit',
        'post',
        {
          expected_revision: Number(handover.value.revision),
          summary: summary.value.trim(),
          approve_ai_summary: reviewMode.value === 'ai',
          accepted_tasks: acceptedTasks,
        },
        crypto.randomUUID(),
      ),
    )
    applyHandover(result)
    notice.value = '交班已提交，已有未完成任务沿用原编号接续。'
    suggestions.value = []
    sessionStorage.removeItem(draftKey.value)
    await Promise.all([tasks.refetch(), load()])
  } catch (failure) {
    error.value =
      failure instanceof Error
        ? failure.message
        : '交班提交结果待核实，请刷新确认。'
    if (handover.value?.id) {
      try {
        await recoverHandover(String(handover.value.id))
      } catch {
        /* Keep the local draft until the server result is known. */
      }
    }
  } finally {
    submitting.value = false
  }
}
watch([sourceShiftId, targetShiftId, note], persistDraft)
onMounted(() => {
  void load()
})
watch([sourceShiftId, targetShiftId], cancelAudio)
onBeforeUnmount(() => {
  disposed = true
  cancelAudio()
})
</script>

<template>
  <section class="handover-quick" aria-label="交班">
    <header class="handover-heading">
      <h1>交班</h1>
      <button
        type="button"
        :disabled="busy"
        aria-label="刷新班次"
        @click="load()"
      >
        <RefreshCw :size="18" aria-hidden="true" />刷新
      </button>
    </header>
    <p v-if="error" class="handover-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div class="handover-shifts">
      <label
        >交出班次<select
          v-model="sourceShiftId"
          :disabled="busy || analyzing || submitting || !!handover"
          @change="sourceChanged"
        >
          <option value="">选择当前班次</option>
          <option
            v-for="row in displayedSources"
            :key="String(row.id)"
            :value="String(row.id)"
          >
            {{ row.name }} · {{ workspaceDate(row.start_at) }}
          </option>
        </select></label
      >
      <label
        >接入班次<select
          v-model="targetShiftId"
          :disabled="busy || analyzing || submitting || !!handover"
        >
          <option value="">选择接班班次</option>
          <option
            v-for="row in displayedTargets"
            :key="String(row.id)"
            :value="String(row.id)"
          >
            {{ row.name }} · {{ workspaceDate(row.start_at) }}
          </option>
        </select></label
      >
    </div>
    <p v-if="shiftIssue && !handover" role="status">{{ shiftIssue }}</p>
    <button
      v-if="handover"
      type="button"
      :disabled="busy || analyzing || submitting"
      @click="changeShifts"
    >
      {{
        handover.status === 'draft' ? '更换班次（保留文字）' : '开始下一次交班'
      }}
    </button>
    <section class="handover-tasks" aria-label="待接续任务">
      <h2>待接续任务</h2>
      <p v-if="tasks.isPending.value" role="status">正在载入未完成任务…</p>
      <p v-else-if="!sourceTasks.length">当前班次没有已载入的未完成任务。</p>
      <ul v-else>
        <li v-for="task in sourceTasks" :key="String(task.id)">
          <strong>{{ task.title }}</strong>
          <span
            >{{ taskElder(task) }} · {{ taskOwner(task) }} ·
            {{ taskStatus(task) }}</span
          >
          <small>交班后继续跟进本项，无需重复新建。</small>
        </li>
      </ul>
    </section>
    <label class="handover-note"
      >交班内容<textarea
        v-model="note"
        rows="5"
        maxlength="5000"
        :disabled="
          analyzing || submitting || (!!handover && handover.status !== 'draft')
        "
        placeholder="记录需要接班人员了解的情况和未完成事项。"
      />
    </label>
    <div class="handover-actions">
      <button
        type="button"
        :disabled="
          busy ||
          analyzing ||
          submitting ||
          transcribing ||
          recordingLocked ||
          (!!handover && handover.status !== 'draft')
        "
        @click="toggleRecording"
      >
        <Square v-if="recording" :size="17" aria-hidden="true" />
        <Mic v-else :size="17" aria-hidden="true" />
        {{
          starting
            ? '正在打开麦克风…'
            : recording
              ? `停止录音（${seconds}秒）`
              : transcribing || finishing
                ? '正在转写…'
                : '开始录音'
        }}
      </button>
      <button
        type="button"
        :disabled="
          busy ||
          analyzing ||
          submitting ||
          transcribing ||
          recordingLocked ||
          recording ||
          !note.trim() ||
          !!shiftIssue ||
          (!!handover && handover.status !== 'draft')
        "
        @click="analyze"
      >
        {{ analyzing ? '正在分析…' : '分析并核对' }}
      </button>
      <button
        type="button"
        :disabled="
          busy ||
          analyzing ||
          submitting ||
          transcribing ||
          recordingLocked ||
          recording ||
          !note.trim() ||
          !!shiftIssue ||
          (!!handover && handover.status !== 'draft')
        "
        @click="manualReview"
      >
        人工核对交班
      </button>
    </div>
    <section
      v-if="handover && reviewMode"
      class="handover-analysis"
      aria-label="交班分析结果"
    >
      <h2>交班总结</h2>
      <p v-if="reviewChanged" role="status">
        交班文字已修改，请重新分析或点击“人工核对交班”后再提交。
      </p>
      <label
        >摘要<textarea
          v-model="summary"
          rows="4"
          maxlength="5000"
          :disabled="submitting"
        />
      </label>
      <details
        v-for="(point, index) in rows(
          object(handover.ai_summary || {}).points || [],
        )"
        :key="index"
      >
        <summary>查看原文依据</summary>
        <p
          v-for="(citation, citationIndex) in rows(point.citations)"
          :key="citationIndex"
        >
          {{ String(citation.quote || '') }}
        </p>
      </details>
      <section
        v-for="item in suggestions"
        :key="item.id"
        class="handover-suggestion"
      >
        <label class="accept-row"
          ><input
            v-model="selectedSuggestions[item.id]"
            type="checkbox"
          />采纳新待办</label
        >
        <p>{{ item.evidence_text }}</p>
        <label
          >老人<select
            v-model="accepted[item.id].elder_id"
            :disabled="submitting"
          >
            <option value="">请选择</option>
            <option
              v-for="elder in elders.data.value || []"
              :key="elder.id"
              :value="elder.id"
            >
              {{ elder.name }}
            </option>
          </select></label
        >
        <label
          >接入班次<select
            v-model="accepted[item.id].shift_id"
            :disabled="submitting"
          >
            <option value="">请选择</option>
            <option
              v-for="row in targetOptions"
              :key="String(row.id)"
              :value="String(row.id)"
            >
              {{ row.name }}
            </option>
          </select></label
        >
        <label
          >责任人<select
            v-model="accepted[item.id].assigned_to"
            :disabled="submitting"
          >
            <option value="">请选择</option>
            <option
              v-for="user in staffOptions(accepted[item.id].shift_id)"
              :key="String(user.id)"
              :value="String(user.id)"
            >
              {{ user.display_name }}
            </option>
          </select></label
        >
        <label
          >截止时间<input
            v-model="accepted[item.id].due_at"
            type="datetime-local"
            :disabled="submitting"
        /></label>
        <label
          >完成标准<textarea
            v-model="accepted[item.id].completion_criteria"
            rows="2"
            :disabled="submitting"
            placeholder="填写可以核实的完成结果"
          />
        </label>
        <p v-if="item.condition || item.due_text" class="muted">
          {{ item.condition || '' }} {{ item.due_text || '' }}
        </p>
        <p
          v-if="selectedSuggestions[item.id] && !canAccept(item.id)"
          class="muted"
        >
          信息未补齐，不会创建此待办。
        </p>
      </section>
      <button
        class="handover-submit"
        type="button"
        :disabled="
          analyzing ||
          submitting ||
          handover.status !== 'draft' ||
          !summary.trim() ||
          reviewChanged ||
          suggestions.some(
            (item) => selectedSuggestions[item.id] && !canAccept(item.id),
          )
        "
        @click="submit"
      >
        <Send :size="17" aria-hidden="true" />{{
          submitting ? '正在提交…' : '核对并提交交班'
        }}
      </button>
    </section>
  </section>
</template>

<style scoped>
.handover-quick {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  color: var(--hl-ink, #172c45);
  overflow-wrap: anywhere;
}
.handover-heading,
.handover-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.handover-heading {
  justify-content: space-between;
}
.handover-quick h1 {
  margin: 0;
  font-size: 22px;
}
.handover-quick h2 {
  margin: 8px 0;
  font-size: 17px;
}
.handover-shifts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.handover-quick label {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.handover-quick input,
.handover-quick select,
.handover-quick textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 8px;
  font: inherit;
  color: inherit;
  border: 1px solid var(--hl-border, #cdd6e0);
  border-radius: 6px;
  background: var(--hl-surface, #fff);
}
.handover-quick textarea {
  resize: vertical;
}
.handover-quick button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--hl-border, #cdd6e0);
  border-radius: 6px;
  background: var(--hl-surface, #fff);
  color: var(--hl-ink, #172c45);
  font: inherit;
}
.handover-quick .handover-submit {
  color: #fff;
  background: var(--hl-primary, #1767cf);
  border-color: var(--hl-primary, #1767cf);
}
.handover-quick button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.handover-tasks,
.handover-analysis {
  border-top: 1px solid var(--hl-border, #cdd6e0);
  padding-top: 8px;
}
.handover-tasks ul {
  display: grid;
  gap: 8px;
  list-style: none;
  padding: 0;
}
.handover-tasks li,
.handover-suggestion {
  display: grid;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--hl-border, #cdd6e0);
}
.handover-tasks span,
.handover-tasks small,
.muted {
  color: var(--hl-muted, #536579);
}
.handover-error {
  color: var(--hl-danger, #a92c32);
}
.accept-row {
  display: flex !important;
  align-items: center;
}
.accept-row input {
  width: 20px;
}
@media (max-width: 480px) {
  .handover-shifts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
