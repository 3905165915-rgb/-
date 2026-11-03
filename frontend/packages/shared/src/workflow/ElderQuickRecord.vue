<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  Mic,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  Upload,
} from 'lucide-vue-next'
import { readSession } from '../session'
import { request, listAll, type Row } from './model'
import { toCloudWav } from './audio'
import { useVoiceRecorder } from './voice-recorder'
import { readSpeechResponse, speechErrorMessage } from './speech-response'
import {
  object,
  rows,
  useWorkspaceAction,
  workspaceDate,
  workspaceStorageKey,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { date, localTime } from './workspace-time'
import { careScenes } from './task-care-context'
import {
  buildRecordAnalysisConfirmation,
  validateInlineRecordResponse,
  type InlineRecordResponse,
  type PreferenceInput,
  type TaskInput,
} from './elder-quick-record'
import PhotoObservation from './PhotoObservation.vue'
import CareGuidance from './CareGuidance.vue'

const attributionLabels: Record<string, string> = {
  elder: '老人本人',
  family: '家属',
  staff: '工作人员',
  unknown: '待核实',
}
const props = defineProps<{ elderId: string }>()
const emit = defineEmits<{ saved: [record: Row] }>()
const scope = useWorkspaceScope()
const { active, management } = scope
const elder = ref<Row | null>(null)
const text = ref(''),
  scene = ref('other'),
  shiftId = ref(''),
  happenedAt = ref(localDateTime())
const shifts = ref<Row[]>([]),
  staff = ref<Row[]>([]),
  attachmentIds = ref<string[]>([])
const result = ref<InlineRecordResponse | null>(null)
const preferences = ref<PreferenceInput[]>([]),
  tasks = ref<TaskInput[]>([])
const loading = ref(false),
  error = ref(''),
  notice = ref(''),
  transcribing = ref(false)
const audioInput = ref<HTMLInputElement | null>(null)
const audioFileName = ref('')
const action = useWorkspaceAction(() => props.elderId, 'record')
const confirmation = useWorkspaceAction(
  () => props.elderId,
  'record-analysis-confirm',
)
const { pending, busy, error: saveError } = action
const confirmBusy = confirmation.busy
const analysisBusy = ref(false)
const confirmLocked = computed(
  () =>
    confirmBusy.value ||
    !!confirmation.pending.value ||
    analysis.value?.status === 'confirmed',
)
const receiptKey = computed(() =>
  workspaceStorageKey(scope.owner, props.elderId, 'record-receipt'),
)
let receipt: Row | null = null
const key = computed(() =>
  workspaceStorageKey(scope.owner, props.elderId, 'record-text'),
)
const eligible = computed(
  () => elder.value && ['active', 'out'].includes(String(elder.value.status)),
)
const analysis = computed(() => result.value?.analysis || null)
let epoch = 0
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
let transcription: AbortController | undefined
let pollTimer: ReturnType<typeof setTimeout> | undefined
const analysisKey = computed(() => key.value + ':analysis')
function rememberAnalysis(value: InlineRecordResponse) {
  try {
    sessionStorage.setItem(analysisKey.value, String(value.record.id))
  } catch {
    /* server copy remains */
  }
}
function schedulePoll() {
  clearTimeout(pollTimer)
  if (
    result.value &&
    ['queued', 'processing'].includes(result.value.analysisStatus)
  )
    pollTimer = setTimeout(() => void pollAnalysis(), 2000)
}
async function pollAnalysis(recordId = String(result.value?.record.id || '')) {
  if (
    !recordId ||
    !scope.valid() ||
    confirmBusy.value ||
    confirmation.pending.value
  )
    return
  const ticket = epoch
  const expectedRevision = result.value?.record.revision
  try {
    const raw = await request(
      '/elders/' +
        encodeURIComponent(props.elderId) +
        '/records/' +
        encodeURIComponent(recordId) +
        '/analysis',
    )
    if (
      !alive(ticket) ||
      result.value?.record.id !== recordId ||
      confirmBusy.value ||
      confirmation.pending.value
    )
      return
    const checked = validateInlineRecordResponse(raw, props.elderId)
    if (
      checked.record.id !== recordId ||
      checked.record.revision !== expectedRevision
    )
      throw new Error('整理回执与原记录版本不一致，请先核实服务器记录。')
    const response = validate(raw)
    initDecisions(response)
    error.value = ''
    notice.value =
      response.analysisStatus === 'ready'
        ? `记录已保存。整理出${response.analysis?.preferenceSuggestions.length || 0}条偏好建议、${response.analysis?.taskSuggestions.length || 0}项跟进建议。`
        : response.analysisStatus === 'failed'
          ? '记录已保存，整理暂未完成。可重试整理，或继续人工办理。'
          : '记录已保存。正在后台整理。'
    schedulePoll()
  } catch (failure) {
    if (alive(ticket)) {
      error.value = (failure as Error).message
      if (scope.valid())
        pollTimer = setTimeout(() => void pollAnalysis(recordId), 5000)
    }
  }
}
function localDateTime() {
  return localTime(new Date()).slice(0, 16)
}
function alive(ticket: number) {
  return ticket === epoch && scope.valid()
}
function initDecisions(value: InlineRecordResponse) {
  result.value = value
  preferences.value = (value.analysis?.preferenceSuggestions || []).map(
    (row) => ({
      suggestionId: row.id,
      decision: '',
      content: row.content,
      needsTimeConfirmation: row.applicability?.needsTimeConfirmation,
      expiresAt: row.applicability?.expiresAt
        ? localTime(new Date(row.applicability.expiresAt)).slice(0, 16)
        : '',
    }),
  )
  tasks.value = (value.analysis?.taskSuggestions || []).map((row) => ({
    suggestionId: row.id,
    accepted: false,
    title: row.title,
    shiftId: '',
    assignedTo: '',
    dueAt:
      row.suggestedAt && row.timeSemantics === 'deadline'
        ? localTime(new Date(row.suggestedAt)).slice(0, 16)
        : '',
    scheduledAt:
      row.suggestedAt && row.timeSemantics === 'service_time'
        ? localTime(new Date(row.suggestedAt)).slice(0, 16)
        : '',
    completionCriteria: '',
    timeChangeReason: '',
  }))
}
async function loadContext() {
  const ticket = epoch
  loading.value = true
  error.value = ''
  try {
    const [elderRows, shiftRows, staffRows] = await Promise.all([
      request('/elders').then(rows),
      listAll('/shifts'),
      listAll('/staff'),
    ])
    if (!alive(ticket)) return false
    elder.value = elderRows.find((row) => row.id === props.elderId) || null
    if (!elder.value) throw new Error('当前账号没有这位老人的可用照护资料。')
    shifts.value = shiftRows.filter(
      (row) =>
        row.status === 'open' &&
        Array.isArray(row.caregiver_ids) &&
        (management ||
          (row.caregiver_ids as string[]).includes(
            String(scope.owner?.userId),
          )),
    )
    staff.value = staffRows
    return true
  } catch (failure) {
    if (alive(ticket)) {
      error.value = (failure as Error).message
      elder.value = null
      shifts.value = []
      staff.value = []
    }
    return false
  } finally {
    if (alive(ticket)) loading.value = false
  }
}
function validate(value: unknown) {
  const checked = validateInlineRecordResponse(value, props.elderId)
  // Save the validated receipt before clearing the durable original request.
  sessionStorage.setItem(receiptKey.value, JSON.stringify(value))
  receipt = object(value)
  return checked
}
function saved(value: InlineRecordResponse | null) {
  if (!value || !scope.valid()) return
  initDecisions(value)
  rememberAnalysis(value)
  schedulePoll()
  if (elder.value) elder.value.current_admission_id = value.record.admission_id
  text.value = ''
  notice.value =
    value.analysisStatus === 'failed'
      ? '正式记录已保存，分析失败。可重试同一记录，不要再次保存。'
      : ['queued', 'processing'].includes(value.analysisStatus)
        ? '记录已保存，正在后台整理。你可以继续工作。'
        : '记录已整理，请核对后确认。'
  emit('saved', value.record)
}
async function save() {
  if (recording.value || recordingLocked.value || transcribing.value) return
  if (pending.value) {
    saved(await action.retry(validate))
    return
  }
  if (!text.value.trim() || busy.value || loading.value || !scope.valid())
    return
  if (!(await loadContext()) || !eligible.value) return
  try {
    const occurred = date(happenedAt.value)
    const payload: Row = {
      background: true,
      text: text.value.trim(),
      scene: scene.value,
      happened_at: occurred,
      attachment_ids: [...attachmentIds.value],
    }
    if (shiftId.value) payload.shift_id = shiftId.value
    saved(
      await action.submit(
        '/elders/' + encodeURIComponent(props.elderId) + '/record',
        payload,
        validate,
      ),
    )
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
async function retryAnalysis() {
  if (
    !result.value?.record.id ||
    busy.value ||
    analysisBusy.value ||
    !scope.valid()
  )
    return
  analysisBusy.value = true
  error.value = ''
  const ticket = epoch
  try {
    const raw = await request(
      '/elders/' +
        encodeURIComponent(props.elderId) +
        '/records/' +
        encodeURIComponent(String(result.value.record.id)) +
        '/analyze?background=true',
      'post',
    )
    if (!alive(ticket)) return
    const checked = validateInlineRecordResponse(raw, props.elderId)
    if (
      checked.record.id !== result.value?.record.id ||
      checked.record.revision !== result.value?.record.revision
    )
      throw new Error('分析回执与原记录版本不一致，请先核实服务器记录。')
    const response = validate(raw)
    initDecisions(response)
    schedulePoll()
    notice.value =
      response.analysisStatus === 'failed'
        ? '分析仍未完成；原正式记录保留。'
        : '同一记录的分析已恢复，请核对。'
  } catch (failure) {
    if (alive(ticket)) error.value = (failure as Error).message
  } finally {
    analysisBusy.value = false
  }
}
function validateConfirmation(value: unknown) {
  const row = object(value),
    record = object(row.record)
  if (
    record.id !== result.value?.record.id ||
    !Array.isArray(row.tasks) ||
    !Array.isArray(row.memories)
  )
    throw new Error('确认回执与当前记录不匹配，请核实状态。')
  return row
}
function confirmed(row: Row | null) {
  if (!row || !scope.valid()) return
  notice.value = '本次核对已保存，已确认的喜好会加入个人印象。'
  result.value!.analysis!.status = 'confirmed'
  if (receipt?.analysis) {
    receipt.analysis_status = 'confirmed'
    object(receipt.analysis).status = 'confirmed'
    try {
      sessionStorage.setItem(receiptKey.value, JSON.stringify(receipt))
    } catch {
      error.value = '服务器已确认，但本机回执更新失败。请核实服务器记录。'
    }
  }
}
async function retryConfirmation() {
  confirmed(await confirmation.retry(validateConfirmation))
}
async function confirm() {
  if (!analysis.value || confirmBusy.value || !scope.valid()) return
  try {
    if (confirmation.pending.value) {
      await retryConfirmation()
      return
    }
    const payload = buildRecordAnalysisConfirmation({
      expectedRevision: analysis.value.record_revision,
      preferenceSuggestionIds: analysis.value.preferenceSuggestions.map(
        (item) => item.id,
      ),
      preferences: preferences.value,
      tasks: tasks.value,
    })
    const url =
      '/elders/' +
      encodeURIComponent(props.elderId) +
      '/records/' +
      encodeURIComponent(analysis.value.record_id) +
      '/analysis/' +
      encodeURIComponent(analysis.value.id) +
      '/confirm'
    const row = await confirmation.submit(url, payload, validateConfirmation)
    confirmed(row)
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
async function transcribe(blob: Blob) {
  if (!scope.valid() || transcribing.value) return
  const ticket = epoch
  error.value = ''
  notice.value = ''
  transcribing.value = true
  const controller = new AbortController()
  transcription = controller
  const timeout = setTimeout(() => controller.abort(), 90000)
  try {
    const wav = await toCloudWav(blob)
    if (!alive(ticket) || controller.signal.aborted) return
    const response = await fetch(
      (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '') +
        '/speech/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + readSession()?.accessToken,
          'Content-Type': 'audio/wav',
        },
        body: wav,
        signal: controller.signal,
      },
    )
    const data = await readSpeechResponse(response)
    if (!alive(ticket)) return
    text.value = [text.value, data.text.trim()].filter(Boolean).join('\n')
    notice.value = '转写文本可编辑；核对后再保存正式记录。'
  } catch (failure) {
    if (alive(ticket)) error.value = speechErrorMessage(failure)
  } finally {
    clearTimeout(timeout)
    if (alive(ticket)) transcribing.value = false
  }
}
async function uploadAudio(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  try {
    if (file) {
      audioFileName.value = file.name
      await transcribe(file)
    }
  } finally {
    input.value = ''
  }
}
function toggleRecording() {
  error.value = ''
  notice.value = ''
  void voice.toggle()
}
function cancelAudio() {
  voice.cancel()
  transcription?.abort()
  transcribing.value = false
  audioFileName.value = ''
}
watch(
  () => props.elderId,
  () => {
    epoch++
    cancelAudio()
    clearTimeout(pollTimer)
    result.value = null
    receipt = null
    attachmentIds.value = []
    happenedAt.value = localDateTime()
    scene.value = 'other'
    shiftId.value = ''
    notice.value = ''
    error.value = ''
    try {
      text.value = sessionStorage.getItem(key.value) || ''
      const previous = sessionStorage.getItem(receiptKey.value)
      if (previous) {
        receipt = object(JSON.parse(previous))
        const restored = validateInlineRecordResponse(receipt, props.elderId)
        initDecisions(restored)
        if (['queued', 'processing'].includes(restored.analysisStatus))
          schedulePoll()
        notice.value =
          '已恢复上次服务器回执；当前页面未重新提交原文，最新状态以服务器为准。'
      }
    } catch {
      error.value = '本机草稿无法读取，请先核实服务器记录。'
    }
    if (scope.valid()) void loadContext()
  },
  { immediate: true },
)
watch(
  text,
  (value) => {
    if (!scope.valid()) return
    try {
      if (value) sessionStorage.setItem(key.value, value)
      else sessionStorage.removeItem(key.value)
    } catch {
      error.value = '本机暂存失败，请保留当前文字。'
    }
  },
  { flush: 'sync' },
)
watch(active, (value) => {
  if (!value) {
    epoch++
    cancelAudio()
    result.value = null
    text.value = ''
    attachmentIds.value = []
  }
})
onBeforeUnmount(() => {
  epoch++
  clearTimeout(pollTimer)
  cancelAudio()
})
</script>

<template>
  <section
    v-if="active"
    class="workspace-panel elder-record"
    aria-label="快速照护记录"
  >
    <header>
      <h3>记一条</h3>
      <button type="button" :disabled="loading || busy" @click="loadContext">
        <RefreshCw :size="16" aria-hidden="true" />刷新照护信息
      </button>
    </header>
    <div v-if="elder" class="record-context">
      <strong>{{ elder.name }}</strong>
      <span>{{
        elder.current_admission_id
          ? String(elder.bed_label || '已入住')
          : '服务器未提供当前入住关联'
      }}</span>
      <label
        >班次<select v-model="shiftId" :disabled="busy">
          <option value="">不关联班次</option>
          <option
            v-for="shift in shifts"
            :key="String(shift.id)"
            :value="shift.id"
          >
            {{ shift.name }} · {{ workspaceDate(shift.start_at) }}
          </option>
        </select></label
      >
      <label
        >实际发生时间<input
          v-model="happenedAt"
          type="datetime-local"
          :disabled="busy"
      /></label>
    </div>
    <p>先保存本次观察，稍后核对整理出的偏好和跟进建议。</p>
    <p
      v-if="
        error || saveError || action.error.value || confirmation.error.value
      "
      role="alert"
      class="workspace-error"
    >
      {{ error || saveError || action.error.value || confirmation.error.value }}
    </p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <CareGuidance :elder-id="elderId" :scene="scene" />
    <form @submit.prevent="save">
      <label
        >照护场景<select v-model="scene" :disabled="busy || !!pending">
          <option
            v-for="(label, value) in careScenes"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select></label
      >
      <label
        >本次记录<textarea
          v-model="text"
          rows="4"
          maxlength="5000"
          :disabled="busy || !!pending"
          placeholder="写下实际观察和本人表达，保存前可以编辑语音转写。"
        />
      </label>
      <div class="workspace-actions record-input-actions">
        <button
          type="button"
          :disabled="busy || !!pending || transcribing || recordingLocked"
          @click="toggleRecording"
        >
          <Square v-if="recording" :size="16" aria-hidden="true" />
          <Mic v-else :size="16" aria-hidden="true" />{{
            starting
              ? '正在打开麦克风…'
              : transcribing || finishing
                ? '正在转写…'
                : recording
                  ? `停止录音（${seconds}秒）`
                  : '开始录音（最长60秒）'
          }}
        </button>
        <div class="audio-upload">
          <button
            type="button"
            :disabled="
              busy || !!pending || transcribing || recording || recordingLocked
            "
            @click="audioInput?.click()"
          >
            <Upload :size="16" aria-hidden="true" />导入语音文件
          </button>
          <input
            ref="audioInput"
            type="file"
            class="audio-file-input"
            aria-label="导入语音文件"
            accept="audio/wav,.wav"
            :disabled="
              busy || !!pending || transcribing || recording || recordingLocked
            "
            @change="uploadAudio"
          />
          <span
            v-if="audioFileName"
            class="audio-file-name"
            :title="audioFileName"
            >{{ audioFileName }}</span
          >
        </div>
        <button
          type="submit"
          :disabled="
            busy ||
            loading ||
            transcribing ||
            recording ||
            recordingLocked ||
            (!pending && (!text.trim() || !eligible))
          "
        >
          <Save :size="16" aria-hidden="true" />{{
            busy ? '正在保存…' : pending ? '核实并重试原提交' : '保存记录'
          }}
        </button>
      </div>
      <p v-if="recording" role="status">
        正在录音 {{ seconds }} 秒，请说完后点击“停止录音”。
      </p>
      <span v-if="pending" class="muted"
        >原提交已锁定；重试会复用原请求编号和内容。</span
      >
    </form>
    <PhotoObservation
      :elder-id="props.elderId"
      inline-selection
      v-model="attachmentIds"
    />
    <section v-if="result" class="record-analysis" aria-label="记录分析核对">
      <header>
        <h4>照护记录整理</h4>
        <span class="workspace-badge">{{
          result.analysisStatus === 'failed'
            ? '分析失败'
            : ['queued', 'processing'].includes(result.analysisStatus)
              ? '整理中'
              : analysis?.status === 'confirmed'
                ? '已核对'
                : '待核对'
        }}</span>
      </header>
      <p>
        正式记录已保存 · 登记时间
        {{ workspaceDate(result.record.created_at) }}
      </p>
      <details>
        <summary>记录来源编号</summary>
        {{ result.record.id }}
      </details>
      <p v-if="result.record.happened_at">
        实际发生 {{ workspaceDate(result.record.happened_at) }}
      </p>
      <div v-if="result.analysisStatus === 'failed'" class="workspace-warning">
        <p>
          {{
            result.analysisError?.message ||
            '分析暂未完成，原记录已保存，可重试此记录。'
          }}
        </p>
        <button
          type="button"
          :disabled="busy || analysisBusy"
          @click="retryAnalysis"
        >
          <RefreshCw :size="16" aria-hidden="true" />重试此记录分析
        </button>
      </div>
      <template v-else-if="analysis">
        <p v-if="analysis.scene.value">
          场景：{{
            careScenes[analysis.scene.value as keyof typeof careScenes] ||
            analysis.scene.value
          }}
        </p>
        <blockquote v-if="analysis.scene.citation">
          {{ analysis.scene.citation.quote }}
          <footer>场景依据 · 原文</footer>
        </blockquote>
        <article
          v-for="item in analysis.observations"
          :key="item.id"
          class="record-suggestion"
        >
          <p>{{ item.text }}</p>
          <blockquote>
            {{ item.citation.quote }}
            <footer>原文依据</footer>
          </blockquote>
        </article>
        <h5 v-if="preferences.length">个人印象建议</h5>
        <article
          v-for="(item, index) in preferences"
          :key="item.suggestionId"
          class="record-suggestion"
        >
          <p>{{ item.content }}</p>
          <details>
            <summary>原文核实</summary>
            <blockquote>
              {{ analysis.preferenceSuggestions[index]?.evidenceText }}
            </blockquote>
          </details>
          <p>
            表达者：{{
              attributionLabels[
                analysis.preferenceSuggestions[index]?.attributedTo || 'unknown'
              ] || '待核实'
            }}
          </p>
          <label
            >核对决定<select v-model="item.decision" :disabled="confirmLocked">
              <option value="">请选择</option>
              <option value="adopt">加入个人印象</option>
              <option value="reject">暂不加入</option>
            </select></label
          >
          <label v-if="item.decision === 'adopt'"
            >确认展示的个人特性<input
              v-model="item.content"
              maxlength="1000"
              :disabled="confirmLocked"
          /></label>
          <label v-if="item.decision === 'adopt' && item.needsTimeConfirmation"
            >本次适用到（北京时间）<input
              v-model="item.expiresAt"
              type="datetime-local"
              :disabled="confirmLocked"
              required
          /></label>
        </article>
        <h5 v-if="tasks.length">待办建议</h5>
        <article
          v-for="(item, index) in tasks"
          :key="item.suggestionId"
          class="record-suggestion"
        >
          <label class="workspace-check"
            ><input
              v-model="item.accepted"
              type="checkbox"
              :disabled="confirmLocked"
            />{{ item.title }}</label
          >
          <blockquote>
            {{ analysis.taskSuggestions[index]?.evidenceText }}
            <footer>原文依据</footer>
          </blockquote>
          <p v-if="analysis.taskSuggestions[index]?.condition">
            执行前提：{{ analysis.taskSuggestions[index]?.condition }}
          </p>
          <p v-if="analysis.taskSuggestions[index]?.dueText">
            原文时间：{{ analysis.taskSuggestions[index]?.dueText }}
          </p>
          <p
            v-for="missing in analysis.taskSuggestions[index]?.timeMissing ||
            []"
            :key="missing"
            class="workspace-warning"
          >
            {{ missing }}
          </p>
          <div v-if="item.accepted" class="workspace-form-grid">
            <label
              >任务标题<input
                v-model="item.title"
                maxlength="300"
                :disabled="confirmLocked"
            /></label>
            <label
              >班次<select v-model="item.shiftId" :disabled="confirmLocked">
                <option value="">选择开放班次</option>
                <option
                  v-for="shift in shifts"
                  :key="String(shift.id)"
                  :value="shift.id"
                >
                  {{ shift.name }} · {{ workspaceDate(shift.start_at) }}
                </option>
              </select></label
            >
            <label
              >责任人<select
                v-model="item.assignedTo"
                :disabled="confirmLocked || !item.shiftId"
              >
                <option value="">选择责任人</option>
                <option
                  v-for="person in staff.filter(
                    (person) =>
                      (
                        shifts.find((shift) => shift.id === item.shiftId)
                          ?.caregiver_ids as string[] | undefined
                      )?.includes(String(person.id)) &&
                      (management || person.id === scope.owner?.userId),
                  )"
                  :key="String(person.id)"
                  :value="person.id"
                >
                  {{ person.display_name }}
                </option>
              </select></label
            >
            <label
              >服务时间（如已确定）<input
                v-model="item.scheduledAt"
                type="datetime-local"
                :disabled="confirmBusy"
            /></label>
            <label
              >截止时间<input
                v-model="item.dueAt"
                type="datetime-local"
                :disabled="confirmLocked"
            /></label>
            <label v-if="analysis.taskSuggestions[index]?.suggestedAt"
              >调整时间的说明（如有调整请填写）<input
                v-model="item.timeChangeReason"
                maxlength="1000"
                :disabled="confirmBusy"
            /></label>
            <label
              >完成标准<input
                v-model="item.completionCriteria"
                maxlength="1000"
                :disabled="confirmLocked"
                placeholder="填写可核对的完成结果"
            /></label>
          </div>
        </article>
        <div v-if="analysis.status !== 'confirmed'" class="workspace-actions">
          <button
            v-if="!confirmation.pending.value"
            type="button"
            :disabled="confirmBusy || !!pending || action.busy.value"
            @click="confirm"
          >
            <ShieldCheck :size="16" aria-hidden="true" />{{
              confirmBusy ? '正在提交核对…' : '保存本次核对'
            }}</button
          ><button
            v-if="confirmation.pending.value"
            type="button"
            :disabled="confirmBusy"
            @click="retryConfirmation"
          >
            核实并重试原核对
          </button>
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped>
.elder-record {
  display: grid;
  gap: 10px;
}
.elder-record header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.elder-record header h3,
.elder-record h4 {
  margin: 0 auto 0 0;
}
.record-context {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;
  gap: 8px 14px;
}
.record-context > strong {
  grid-column: 1 / -1;
}
.record-context > span {
  grid-column: 1 / -1;
}
.record-context label,
.elder-record form > label,
.record-suggestion label {
  display: grid;
  gap: 6px;
}
.elder-record input:not([type='checkbox']),
.elder-record select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  min-height: 44px;
  padding: 9px;
  border: 1px solid var(--hl-border, #cbd9cf);
  border-radius: 6px;
  background: white;
  color: inherit;
  font: inherit;
}
.record-input-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
}
.record-input-actions > * {
  min-width: 0;
  max-width: 100%;
}
.record-input-actions button {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  white-space: normal;
}
.audio-upload {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 5px;
}
.audio-upload .audio-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  min-height: 0;
  padding: 0;
  border: 0;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
.audio-file-name {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--hl-muted, #65736b);
}
.record-analysis {
  border-top: 1px solid var(--hl-border, #dce6de);
  padding-top: 14px;
}
.record-suggestion {
  padding-block: 10px;
  border-bottom: 1px solid var(--hl-border, #dce6de);
}
.record-suggestion p {
  margin: 6px 0;
}
.muted {
  color: var(--hl-muted, #65736b);
}
@media (max-width: 560px) {
  .record-input-actions {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  .record-context {
    grid-template-columns: minmax(0, 1fr);
  }
  .audio-upload {
    width: 100%;
    box-sizing: border-box;
  }
}
</style>
