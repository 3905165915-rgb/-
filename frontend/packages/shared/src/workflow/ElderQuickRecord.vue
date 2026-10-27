<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Mic, RefreshCw, Save, ShieldCheck } from 'lucide-vue-next'
import { readSession } from '../session'
import { request, listAll, type Row } from './model'
import { toCloudWav } from './audio'
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
const action = useWorkspaceAction(() => props.elderId, 'record')
const confirmation = useWorkspaceAction(
  () => props.elderId,
  'record-analysis-confirm',
)
const { pending, busy, error: saveError } = action
const confirmBusy = confirmation.busy
const key = computed(() =>
  workspaceStorageKey(scope.owner, props.elderId, 'record-text'),
)
const eligible = computed(
  () => elder.value && ['active', 'out'].includes(String(elder.value.status)),
)
const analysis = computed(() => result.value?.analysis || null)
let epoch = 0
let recorder: MediaRecorder | undefined
let stream: MediaStream | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
let transcription: AbortController | undefined
function localDateTime() {
  return localTime(new Date()).slice(0, 16)
}
function alive(ticket: number) {
  return ticket === epoch && scope.valid()
}
function initDecisions(value: InlineRecordResponse) {
  result.value = value
  preferences.value = (value.analysis?.preferenceSuggestions || []).map(
    (row) => ({ suggestionId: row.id, decision: '', content: row.content }),
  )
  tasks.value = (value.analysis?.taskSuggestions || []).map((row) => ({
    suggestionId: row.id,
    accepted: false,
    title: row.title,
    shiftId: '',
    assignedTo: '',
    dueAt: '',
    completionCriteria: '',
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
  return validateInlineRecordResponse(value, props.elderId)
}
function saved(value: InlineRecordResponse | null) {
  if (!value || !scope.valid()) return
  initDecisions(value)
  if (elder.value) elder.value.current_admission_id = value.record.admission_id
  text.value = ''
  notice.value =
    value.analysisStatus === 'failed'
      ? '正式记录已保存，分析失败。可重试同一记录，不要再次保存。'
      : '正式记录已保存，请核对引用原文和待办后再作一次确认。'
  emit('saved', value.record)
}
async function save() {
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
  if (!result.value?.record.id || busy.value || !scope.valid()) return
  const ticket = epoch
  try {
    const response = validate(
      await request(
        '/elders/' +
          encodeURIComponent(props.elderId) +
          '/records/' +
          encodeURIComponent(String(result.value.record.id)) +
          '/analyze',
        'post',
      ),
    )
    if (!alive(ticket)) return
    initDecisions(response)
    notice.value =
      response.analysisStatus === 'failed'
        ? '分析仍未完成；原正式记录保留。'
        : '同一记录的分析已恢复，请核对。'
  } catch (failure) {
    if (alive(ticket)) error.value = (failure as Error).message
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
async function confirm() {
  if (!analysis.value || confirmBusy.value || !scope.valid()) return
  try {
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
    if (row) {
      notice.value = '本次核对已保存；正式待办和长期偏好以服务器回执为准。'
      result.value!.analysis!.status = 'confirmed'
    }
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
async function transcribe(blob: Blob) {
  if (!scope.valid()) return
  transcribing.value = true
  transcription = new AbortController()
  const timeout = setTimeout(() => transcription?.abort(), 90000)
  try {
    const wav = await toCloudWav(blob)
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
        signal: transcription.signal,
      },
    )
    const data = await response.json()
    if (!response.ok)
      throw new Error('语音识别失败，可保留当前文字并手工补录。')
    if (typeof data.text !== 'string' || !data.text.trim())
      throw new Error('语音转写没有可核对的文字。')
    text.value = [text.value, data.text.trim()].filter(Boolean).join('\n')
    notice.value = '转写文本可编辑；核对后再保存正式记录。'
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    clearTimeout(timeout)
    transcribing.value = false
  }
}
async function uploadAudio(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  try {
    if (file) await transcribe(file)
  } finally {
    input.value = ''
  }
}
async function toggleRecording() {
  if (recorder?.state === 'recording') {
    recorder.stop()
    return
  }
  error.value = ''
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
      await transcribe(
        new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }),
      )
    }
    recorder.start()
    deadline = setTimeout(() => {
      if (recorder?.state === 'recording') recorder.stop()
    }, 60000)
  } catch {
    stream?.getTracks().forEach((track) => track.stop())
    error.value = '无法使用麦克风，可继续文字录入。'
  }
}
watch(
  () => props.elderId,
  () => {
    epoch++
    result.value = null
    attachmentIds.value = []
    happenedAt.value = localDateTime()
    scene.value = 'other'
    shiftId.value = ''
    notice.value = ''
    error.value = ''
    try {
      text.value = sessionStorage.getItem(key.value) || ''
    } catch {
      error.value = '本机草稿无法读取，请先核实服务器记录。'
    }
    if (scope.valid()) void loadContext()
  },
  { immediate: true },
)
watch(text, (value) => {
  if (!scope.valid()) return
  try {
    if (value) sessionStorage.setItem(key.value, value)
    else sessionStorage.removeItem(key.value)
  } catch {
    error.value = '本机暂存失败，请保留当前文字。'
  }
})
watch(active, (value) => {
  if (!value) {
    epoch++
    result.value = null
    text.value = ''
    attachmentIds.value = []
  }
})
onBeforeUnmount(() => {
  epoch++
  transcription?.abort()
  clearTimeout(deadline)
  if (recorder?.state === 'recording') recorder.stop()
  stream?.getTracks().forEach((track) => track.stop())
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
          ? '当前入住：' + elder.current_admission_id
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
    <p>记录保存后会即时整理为待核对建议；建议不会自动生效。</p>
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
          :disabled="busy || !!pending || transcribing"
          @click="toggleRecording"
        >
          <Mic :size="16" aria-hidden="true" />{{
            transcribing ? '正在转写…' : '录音（最长60秒）'
          }}
        </button>
        <label class="audio-upload"
          >导入 WAV<input
            type="file"
            accept="audio/wav,.wav"
            :disabled="busy || !!pending || transcribing"
            @change="uploadAudio"
        /></label>
        <button
          type="submit"
          :disabled="
            busy || loading || (!pending && (!text.trim() || !eligible))
          "
        >
          <Save :size="16" aria-hidden="true" />{{
            busy ? '正在核实保存…' : pending ? '核实并重试原提交' : '保存并分析'
          }}
        </button>
      </div>
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
        <h4>即时分析</h4>
        <span class="workspace-badge">{{
          result.analysisStatus === 'failed'
            ? '分析失败'
            : analysis?.status === 'confirmed'
              ? '已核对'
              : '待核对'
        }}</span>
      </header>
      <p>
        正式记录 {{ result.record.id }} · 登记时间
        {{ workspaceDate(result.record.created_at) }}
      </p>
      <p v-if="result.record.happened_at">
        实际发生 {{ workspaceDate(result.record.happened_at) }}
      </p>
      <div v-if="result.analysisStatus === 'failed'" class="workspace-warning">
        <p>分析失败，已保存的原始记录仍在服务器。</p>
        <button type="button" :disabled="busy" @click="retryAnalysis">
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
        <h5 v-if="preferences.length">长期偏好建议</h5>
        <article
          v-for="(item, index) in preferences"
          :key="item.suggestionId"
          class="record-suggestion"
        >
          <p>{{ item.content }}</p>
          <blockquote>
            {{ analysis.preferenceSuggestions[index]?.evidenceText }}
          </blockquote>
          <p>
            频率：{{
              analysis.preferenceSuggestions[index]?.frequency === 'explicit'
                ? '原文明确重复规律'
                : analysis.preferenceSuggestions[index]?.frequency ===
                    'one_time'
                  ? '单次意愿'
                  : '频率不明确'
            }}
            · 表达者：{{ ({ elder: '老人本人', family: '家属', staff: '工作人员', unknown: '待核实' } as Record<string, string>)[analysis.preferenceSuggestions[index]?.attributedTo || 'unknown'] || '待核实' }}
          </p>
          <label
            >核对决定<select
              v-model="item.decision"
              :disabled="analysis.status === 'confirmed' || confirmBusy"
            >
              <option value="">请选择</option>
              <option
                value="adopt"
                :disabled="
                  analysis.preferenceSuggestions[index]?.frequency !==
                  'explicit'
                "
              >
                采纳为长期偏好
              </option>
              <option value="reject">不采纳</option>
            </select></label
          >
          <label v-if="item.decision === 'adopt'"
            >核对后的偏好内容<input
              v-model="item.content"
              maxlength="1000"
              :disabled="confirmBusy"
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
              :disabled="analysis.status === 'confirmed' || confirmBusy"
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
          <div v-if="item.accepted" class="workspace-form-grid">
            <label
              >任务标题<input
                v-model="item.title"
                maxlength="300"
                :disabled="confirmBusy"
            /></label>
            <label
              >班次<select v-model="item.shiftId" :disabled="confirmBusy">
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
                :disabled="confirmBusy || !item.shiftId"
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
              >截止时间<input
                v-model="item.dueAt"
                type="datetime-local"
                :disabled="confirmBusy"
            /></label>
            <label
              >完成标准<input
                v-model="item.completionCriteria"
                maxlength="1000"
                :disabled="confirmBusy"
                placeholder="填写可核对的完成结果"
            /></label>
          </div>
        </article>
        <div v-if="analysis.status !== 'confirmed'" class="workspace-actions">
          <button
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
            @click="confirmation.retry(validateConfirmation)"
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
  align-items: center;
}
.audio-upload {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--hl-border, #cbd9cf);
  border-radius: 6px;
}
.audio-upload input {
  width: min(155px, 45vw);
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
  .record-context {
    grid-template-columns: minmax(0, 1fr);
  }
  .audio-upload {
    width: 100%;
    box-sizing: border-box;
  }
}
</style>
