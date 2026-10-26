<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { request, type Row } from './model'
import {
  object,
  rows,
  useWorkspaceAction,
  workspaceDate,
  workspaceStorageKey,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
const props = defineProps<{ elderId: string }>()
const emit = defineEmits<{ saved: [record: Row] }>()
const scope = useWorkspaceScope()
const { active, management } = scope
const elder = ref<Row | null>(null)
const text = ref('')
const jobs = ref<Row[]>([])
const loading = ref(false)
const error = ref('')
const jobError = ref('')
const notice = ref('')
const action = useWorkspaceAction(() => props.elderId, 'record')
const { pending, busy, error: saveError } = action
const key = computed(() =>
  workspaceStorageKey(scope.owner, props.elderId, 'record-text'),
)
const working = computed(() =>
  jobs.value.some((job) =>
    ['queued', 'processing'].includes(String(job.status)),
  ),
)
const eligible = computed(
  () => elder.value && ['active', 'out'].includes(String(elder.value.status)),
)
let epoch = 0
let jobEpoch = 0
let timer: ReturnType<typeof setTimeout> | undefined
function alive(ticket: number) {
  return ticket === epoch && scope.valid()
}
function cancel() {
  clearTimeout(timer)
  timer = undefined
}
async function loadContext() {
  const ticket = epoch
  loading.value = true
  error.value = ''
  try {
    const available = rows(await request('/elders'))
    if (!alive(ticket)) return false
    elder.value = available.find((row) => row.id === props.elderId) || null
    if (!elder.value) throw new Error('当前账号没有这位老人的可用照护资料。')
    return true
  } catch (failure) {
    if (alive(ticket)) {
      elder.value = null
      error.value = (failure as Error).message
    }
    return false
  } finally {
    if (alive(ticket)) loading.value = false
  }
}
async function loadJobs() {
  cancel()
  const ticket = epoch
  const jobTicket = ++jobEpoch
  if (!scope.valid()) return
  try {
    const response = object(
      await request(
        '/elders/' + encodeURIComponent(props.elderId) + '/organising',
      ),
    )
    if (!alive(ticket) || jobTicket !== jobEpoch) return
    if (response.elder_id !== props.elderId)
      throw new Error('整理结果与当前老人不匹配。')
    const result = rows(response.items)
    if (
      result.some(
        (row) =>
          typeof row.id !== 'string' ||
          !['queued', 'processing', 'completed', 'failed', 'skipped'].includes(
            String(row.status),
          ),
      )
    )
      throw new Error('整理状态暂不能确认。')
    jobs.value = result
    jobError.value = ''
    if (working.value)
      timer = setTimeout(() => {
        void loadJobs()
      }, 3500)
  } catch (failure) {
    if (alive(ticket))
      jobError.value =
        '记录保存状态与整理状态分开。整理状态暂不可读：' +
        (failure as Error).message
  }
}
function validate(value: unknown) {
  const result = object(value)
  const record = object(result.record)
  if (
    record.elder_id !== props.elderId ||
    typeof record.id !== 'string' ||
    !['confirmed', 'corrected'].includes(String(record.status)) ||
    typeof record.raw_text !== 'string'
  )
    throw new Error('正式记录回执异常，请重试原提交核实。')
  return record
}
function saved(record: Row | null) {
  if (!record || !scope.valid()) return
  text.value = ''
  notice.value =
    '记录已保存；入住关联以服务器本次保存的上下文为准。系统在后台整理，不影响原始记录。'
  if (elder.value) elder.value.current_admission_id = record.admission_id
  emit('saved', record)
  void loadJobs()
}
async function save() {
  if (pending.value) {
    saved(await action.retry(validate))
    return
  }
  if (!text.value.trim() || busy.value || !scope.valid()) return
  if (!(await loadContext()) || !eligible.value) return
  notice.value = ''
  saved(
    await action.submit(
      '/elders/' + encodeURIComponent(props.elderId) + '/record',
      { text: text.value.trim() },
      validate,
    ),
  )
}
async function retryJob(job: Row) {
  if (!scope.valid() || busy.value) return
  try {
    const result = object(
      await request(
        '/elders/' +
          encodeURIComponent(props.elderId) +
          '/organising/' +
          encodeURIComponent(String(job.id)) +
          '/retry',
        'post',
      ),
    )
    if (!scope.valid()) return
    if (
      result.id !== job.id ||
      result.elder_id !== props.elderId ||
      result.status !== 'queued'
    )
      throw new Error('重试回执异常，请刷新核对。')
    await loadJobs()
  } catch (failure) {
    if (scope.valid()) jobError.value = (failure as Error).message
  }
}
async function resolveJob(job: Row) {
  const reason =
    typeof job.resolution_note === 'string' ? job.resolution_note.trim() : ''
  if (!reason || !management || !scope.valid()) return
  try {
    const result = object(
      await request(
        '/elders/' +
          encodeURIComponent(props.elderId) +
          '/organising/' +
          encodeURIComponent(String(job.id)) +
          '/resolve-followups',
        'post',
        { reason },
      ),
    )
    if (!scope.valid()) return
    if (result.id !== job.id) throw new Error('办理回执异常，请刷新核对。')
    await loadJobs()
  } catch (failure) {
    if (scope.valid()) jobError.value = (failure as Error).message
  }
}
function unresolved(job: Row) {
  return (
    job.result &&
    typeof job.result === 'object' &&
    Number(object(job.result).unresolved_followups) > 0 &&
    !job.followup_reviewed_at
  )
}
const states: Record<string, string> = {
  queued: '后台待整理',
  processing: '后台整理中',
  completed: '整理完成',
  failed: '整理失败，原始记录已保留',
  skipped: '本次无需新增整理',
}
watch(
  () => props.elderId,
  () => {
    epoch++
    cancel()
    elder.value = null
    jobs.value = []
    text.value = ''
    notice.value = ''
    jobError.value = ''
    if (!scope.valid()) return
    try {
      text.value = sessionStorage.getItem(key.value) || ''
    } catch {
      error.value = '本机文字暂不可恢复，请核对已保存记录。'
    }
    void loadContext()
    void loadJobs()
  },
  { immediate: true },
)
watch(text, (value) => {
  if (scope.valid())
    try {
      if (value) sessionStorage.setItem(key.value, value)
      else sessionStorage.removeItem(key.value)
    } catch {
      error.value = '本机自动暂存失败，请保留文字并尽快保存。'
    }
})
watch(active, (value) => {
  if (!value) {
    epoch++
    cancel()
    elder.value = null
    jobs.value = []
    text.value = ''
  }
})
onBeforeUnmount(() => {
  epoch++
  cancel()
})
</script>
<template>
  <section
    v-if="active"
    class="workspace-panel"
    aria-label="快速照护记录"
  >
    <header>
      <h3>记一条</h3>
      <button
        type="button"
        :disabled="loading || busy"
        @click="loadContext"
      >
        刷新当前入住
      </button>
    </header>
    <p v-if="elder">
      <strong>{{ elder.name }}</strong> ·
      {{
        elder.current_admission_id
          ? '当前入住：' + elder.current_admission_id
          : '服务器当前未提供入住单关联'
      }}
    </p>
    <p>如实写下本次观察和本人表达。保存即形成正式记录，不等待 AI。</p>
    <p
      v-if="error || saveError"
      role="alert"
      class="workspace-error"
    >
      {{ error || saveError }}
    </p>
    <p
      v-if="notice"
      role="status"
    >
      {{ notice }}
    </p>
    <form @submit.prevent="save">
      <label>本次记录<textarea
        v-model="text"
        rows="4"
        maxlength="5000"
        :disabled="busy || !!pending"
        placeholder="例如：下午询问活动意愿，老人表示今天想休息。只记实际发生的情况。"
      />
      </label>
      <div class="workspace-actions">
        <button
          type="submit"
          :disabled="
            busy || loading || (!pending && (!text.trim() || !eligible))
          "
        >
          {{
            busy ? '正在核实保存…' : pending ? '核实并重试原提交' : '保存记录'
          }}
        </button><span v-if="pending">原提交内容已锁定，重试保持原请求编号。</span>
      </div>
    </form>
    <details
      v-if="jobs.length || jobError"
      :open="working || !!jobError"
    >
      <summary>记录的后台整理{{ working ? '（进行中）' : '' }}</summary>
      <p
        v-if="jobError"
        role="alert"
        class="workspace-error"
      >
        {{ jobError
        }}<button
          type="button"
          @click="loadJobs"
        >
          重新读取状态
        </button>
      </p>
      <article
        v-for="job in jobs"
        :key="String(job.id)"
        class="workspace-job"
      >
        <strong>{{ states[String(job.status)] || '状态待核实' }}</strong>
        <p>
          {{ workspaceDate(job.updated_at) }} · 正式记录 {{ job.record_id }}
        </p>
        <button
          v-if="job.status === 'failed'"
          type="button"
          @click="retryJob(job)"
        >
          重新整理
        </button>
        <div v-if="unresolved(job)">
          <p class="workspace-warning">
            原文中的跟进安排尚需人工核对责任人、班次或授权。
          </p>
          <template v-if="management">
            <label>人工办理说明<input
              v-model="job.resolution_note"
              maxlength="1000"
              placeholder="说明已核实并如何办理"
            ></label><button
              type="button"
              :disabled="!job.resolution_note"
              @click="resolveJob(job)"
            >
              已人工办理
            </button>
          </template>
        </div>
      </article>
    </details>
  </section>
</template>
