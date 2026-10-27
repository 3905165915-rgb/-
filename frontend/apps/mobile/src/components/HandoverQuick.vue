<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Mic, RefreshCw, Send, Square } from 'lucide-vue-next'
import { readSession } from '@hulao/shared'
import { useTasks, useElders } from '../services/data'
import {
  request,
  type Row,
} from '../../../../packages/shared/src/workflow/model'
import { toCloudWav } from '../../../../packages/shared/src/workflow/audio'
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
const recording = ref(false)
const draftKey = computed(() => {
  const current = readSession()
  return (
    'hulao:handover-quick:v1:' +
    JSON.stringify([current?.accountKey, current?.userId, current?.role])
  )
})
let recorder: MediaRecorder | undefined
let stream: MediaStream | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
const selectedSource = computed(() =>
  shifts.value.find((row) => row.id === sourceShiftId.value),
)
const targetOptions = computed(() =>
  shifts.value.filter(
    (row) =>
      row.status === 'open' &&
      row.id !== sourceShiftId.value &&
      selectedSource.value &&
      Date.parse(String(row.start_at)) >
        Date.parse(String(selectedSource.value.start_at)),
  ),
)
const sourceTasks = computed(() =>
  (tasks.data.value || []).filter(
    (task) =>
      task.status !== 'completed' &&
      task.status !== 'cancelled' &&
      (task.shift === selectedSource.value?.name || task.itemId),
  ),
)
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
  if (existing && existing.status === 'draft') applyHandover(existing)
  else if (existing?.status === 'submitted') {
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
async function load() {
  busy.value = true
  error.value = ''
  const savedId = restoreDraft()
  try {
    const [shiftRows, staffRows] = await Promise.all([
      request('/shifts?limit=200&offset=0'),
      request('/staff/directory'),
    ])
    shifts.value = rows(shiftRows)
    staff.value = rows(staffRows)
    if (!sourceShiftId.value) {
      const currentUser = readSession()?.userId
      const source = shifts.value.find(
        (row) =>
          row.status === 'open' &&
          Array.isArray(row.caregiver_ids) &&
          row.caregiver_ids.includes(currentUser),
      )
      if (source) sourceShiftId.value = String(source.id)
    }
    if (!targetShiftId.value) {
      const next = shifts.value
        .filter(
          (row) =>
            row.status === 'open' &&
            row.id !== sourceShiftId.value &&
            Date.parse(String(row.start_at)) > Date.now(),
        )
        .sort(
          (a, b) =>
            Date.parse(String(a.start_at)) - Date.parse(String(b.start_at)),
        )[0]
      targetShiftId.value = next ? String(next.id) : ''
    }
    if (sourceShiftId.value && targetShiftId.value)
      await recoverHandover(savedId)
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : '交班资料载入失败。'
  } finally {
    busy.value = false
  }
}
async function transcribe(blob: Blob) {
  transcribing.value = true
  error.value = ''
  try {
    const wav = await toCloudWav(blob)
    const session = readSession()
    const response = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1') +
        '/speech/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session?.accessToken,
          'Content-Type': 'audio/wav',
        },
        body: wav,
      },
    )
    const body = await response.json()
    if (!response.ok || typeof body.text !== 'string' || !body.text.trim())
      throw new Error('语音转写不可用，请继续手工编辑交班内容。')
    note.value = [note.value, body.text].filter(Boolean).join('\n')
    notice.value = '转写已填入交班内容，请核对并编辑后再分析。'
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '语音转写失败。'
  } finally {
    transcribing.value = false
  }
}
async function toggleRecording() {
  error.value = ''
  if (recording.value) {
    recorder?.stop()
    recording.value = false
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      clearTimeout(deadline)
      stream?.getTracks().forEach((track) => track.stop())
      stream = undefined
      await transcribe(
        new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }),
      )
    }
    recorder.start()
    recording.value = true
    deadline = setTimeout(() => recorder?.stop(), 60000)
  } catch {
    stream?.getTracks().forEach((track) => track.stop())
    stream = undefined
    error.value = '无法使用麦克风，可继续键入交班内容。'
  }
}
async function analyze() {
  if (
    !sourceShiftId.value ||
    !targetShiftId.value ||
    analyzing.value ||
    !note.value.trim()
  )
    return
  analyzing.value = true
  error.value = ''
  notice.value = ''
  try {
    if (!handover.value) {
      await recoverHandover('')
    }
    if (!handover.value) {
      applyHandover(
        await request('/handovers', 'post', {
          source_shift_id: sourceShiftId.value,
          target_shift_id: targetShiftId.value,
        }),
      )
    }
    const currentHandover = handover.value
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
  if (
    !handover.value ||
    handover.value.status !== 'draft' ||
    submitting.value ||
    !summary.value.trim()
  )
    return
  submitting.value = true
  error.value = ''
  try {
    const acceptedTasks = suggestions.value
      .filter((item) => canAccept(item.id))
      .map((item) => ({
        ...accepted.value[item.id],
        due_at: new Date(accepted.value[item.id].due_at).toISOString(),
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
          approve_ai_summary: true,
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
onBeforeUnmount(() => {
  clearTimeout(deadline)
  stream?.getTracks().forEach((track) => track.stop())
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
        @click="load"
      >
        <RefreshCw :size="18" aria-hidden="true" />刷新
      </button>
    </header>
    <p v-if="error" class="handover-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div class="handover-shifts">
      <label
        >交出班次<select v-model="sourceShiftId" :disabled="busy || !!handover">
          <option value="">选择当前班次</option>
          <option
            v-for="row in shifts.filter((item) => item.status === 'open')"
            :key="String(row.id)"
            :value="String(row.id)"
          >
            {{ row.name }} · {{ workspaceDate(row.start_at) }}
          </option>
        </select></label
      >
      <label
        >接入班次<select v-model="targetShiftId" :disabled="busy || !!handover">
          <option value="">选择接班班次</option>
          <option
            v-for="row in targetOptions"
            :key="String(row.id)"
            :value="String(row.id)"
          >
            {{ row.name }} · {{ workspaceDate(row.start_at) }}
          </option>
        </select></label
      >
    </div>
    <section class="handover-tasks" aria-label="待接续任务">
      <h2>待接续任务</h2>
      <p v-if="tasks.isPending.value" role="status">正在载入未完成任务…</p>
      <p v-else-if="!sourceTasks.length">当前班次没有已载入的未完成任务。</p>
      <ul v-else>
        <li v-for="task in sourceTasks" :key="task.id">
          <strong>{{ task.title }}</strong>
          <span
            >{{ task.elderId }} · {{ task.assignee || '责任人未提供' }} ·
            {{ task.status }}</span
          >
          <small
            >任务编号
            {{ task.itemId || task.id }}，提交后沿用原任务，不重复建单。</small
          >
        </li>
      </ul>
    </section>
    <label class="handover-note"
      >交班内容<textarea
        v-model="note"
        rows="5"
        maxlength="5000"
        :disabled="analyzing || submitting"
        placeholder="记录需要接班人员了解的情况和未完成事项。"
      />
    </label>
    <div class="handover-actions">
      <button
        type="button"
        :disabled="busy || analyzing || transcribing"
        @click="toggleRecording"
      >
        <Square v-if="recording" :size="17" aria-hidden="true" />
        <Mic v-else :size="17" aria-hidden="true" />
        {{ recording ? '停止录音' : transcribing ? '正在转写…' : '语音转写' }}
      </button>
      <button
        type="button"
        :disabled="
          analyzing || !note.trim() || !sourceShiftId || !targetShiftId
        "
        @click="analyze"
      >
        {{ analyzing ? '正在分析…' : '分析并核对' }}
      </button>
    </div>
    <section
      v-if="handover?.ai_summary"
      class="handover-analysis"
      aria-label="交班分析结果"
    >
      <h2>交班总结</h2>
      <label
        >摘要<textarea
          v-model="summary"
          rows="4"
          maxlength="5000"
          :disabled="submitting"
        />
      </label>
      <details
        v-for="(point, index) in object(handover.ai_summary).points as Row[]"
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
        :disabled="submitting || handover.status !== 'draft' || !summary.trim()"
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
