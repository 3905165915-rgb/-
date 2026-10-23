<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue'
import { readSession } from '../session'
import {
  deleteWorkflowJournal,
  filterWorkflowJournals,
  journalExport,
  journalPreview,
  listWorkflowJournals,
  type JournalPhase,
  type WorkflowJournalEntry,
} from './journal-management'

const entries = shallowRef<WorkflowJournalEntry[]>([])
const account = ref<string | null>(null)
const status = ref<'loading' | 'ready' | 'error' | 'signed-out' | 'api-only'>(
  'loading',
)
const keyword = ref('')
const preview = shallowRef<WorkflowJournalEntry | null>(null)
const loadError = ref(''),
  actionError = ref(''),
  message = ref('')
const busy = ref(false)
let revision = 0
const filtered = computed(() =>
  filterWorkflowJournals(entries.value, keyword.value),
)
const bytes = computed(() =>
  entries.value.reduce((sum, entry) => sum + entry.bytes, 0),
)
const phases: Record<JournalPhase, string> = {
  editing: '编辑中',
  pending: '待确认',
  succeeded: '已成功',
  'unresolved-ai': 'AI 结果待核实',
  malformed: '格式异常',
}
const kinds: Record<WorkflowJournalEntry['kind'], string> = {
  snapshot: '主快照',
  writer: '窗口日志',
  'unresolved-ai': 'AI 核查日志',
  malformed: '异常键名',
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}
function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '时间未知'
}
function clearView() {
  entries.value = []
  preview.value = null
  actionError.value = ''
  message.value = ''
}
async function refresh() {
  const ticket = ++revision
  clearView()
  loadError.value = ''
  const currentSession = readSession()
  if (!currentSession) {
    account.value = null
    status.value = 'signed-out'
    return
  }
  if (currentSession.mode !== 'api') {
    account.value = null
    status.value = 'api-only'
    return
  }
  account.value = currentSession.accountKey
  if (!account.value) {
    status.value = 'signed-out'
    return
  }
  status.value = 'loading'
  await nextTick()
  if (ticket !== revision) return
  try {
    const latestSession = readSession()
    if (
      latestSession?.mode !== 'api' ||
      latestSession.accountKey !== account.value
    ) {
      void refresh()
      return
    }
    entries.value = listWorkflowJournals()
    status.value = 'ready'
  } catch {
    entries.value = []
    loadError.value = '无法读取本机恢复日志，请检查浏览器存储权限后刷新。'
    status.value = 'error'
  }
}
function current(entry: WorkflowJournalEntry) {
  if (
    readSession()?.mode === 'api' &&
    readSession()?.accountKey === account.value &&
    entry.accountKey === account.value
  )
    return true
  void refresh()
  return false
}
function inspect(entry: WorkflowJournalEntry) {
  if (current(entry)) preview.value = entry
}
function download(entry: WorkflowJournalEntry) {
  if (!current(entry)) return
  actionError.value = ''
  let url: string | undefined
  let link: HTMLAnchorElement | undefined
  try {
    url = URL.createObjectURL(
      new Blob([journalExport(entry)], {
        type: 'application/json;charset=utf-8',
      }),
    )
    link = document.createElement('a')
    link.href = url
    link.download = `workflow-journal-${entry.phase}-${Date.now()}.json`
    document.body.append(link)
    link.click()
    message.value = '已导出所选日志。'
  } catch {
    actionError.value = '日志导出失败，请重试。'
  } finally {
    link?.remove()
    if (url) {
      const downloadUrl = url
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    }
  }
}
async function remove(entry: WorkflowJournalEntry) {
  if (busy.value || !current(entry)) return
  busy.value = true
  actionError.value = ''
  message.value = ''
  try {
    const deleted = await deleteWorkflowJournal(entry, (row) =>
      window.confirm(
        `确认删除这一项本机恢复日志？\n${row.group} · ${JSON.stringify(row.context)}\n${phases[row.phase]} · ${formatBytes(row.bytes)}\n删除后无法恢复，服务器内容不受影响。`,
      ),
    )
    if (deleted) {
      await refresh()
      if (account.value === entry.accountKey)
        message.value = '已删除所选本机日志。'
    }
  } catch (failure) {
    await refresh()
    if (account.value === entry.accountKey)
      actionError.value =
        failure instanceof Error ? failure.message : '删除失败，请刷新后重试。'
  } finally {
    busy.value = false
  }
}
function storageChanged(event: StorageEvent) {
  if (
    event.key === null ||
    event.key.startsWith('hulao:workflow:v2:') ||
    event.key === 'hulao:session:v2'
  )
    void refresh()
}
function visibilityChanged() {
  if (document.visibilityState === 'visible') void refresh()
}
function revoke() {
  revision++
  clearView()
  account.value = null
  status.value = 'signed-out'
}
onMounted(() => {
  void refresh()
  window.addEventListener('storage', storageChanged)
  window.addEventListener('focus', refresh)
  window.addEventListener('hulao:unauthorized', revoke)
  document.addEventListener('visibilitychange', visibilityChanged)
})
onBeforeUnmount(() => {
  revision++
  clearView()
  window.removeEventListener('storage', storageChanged)
  window.removeEventListener('focus', refresh)
  window.removeEventListener('hulao:unauthorized', revoke)
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<template>
  <section
    class="workflow-journals"
    aria-label="正式流程恢复日志"
    :aria-busy="status === 'loading' || busy"
  >
    <header class="wj-heading">
      <h2>正式流程恢复日志</h2>
      <button
        type="button"
        :disabled="busy || status === 'loading'"
        @click="refresh"
      >
        刷新
      </button>
    </header>
    <p
      v-if="account"
      class="wj-muted wj-account"
    >
      当前账号：{{ account }}
    </p>
    <label class="wj-search">
      <span>搜索流程组或上下文</span>
      <input
        v-model="keyword"
        type="search"
        placeholder="流程组、任务编号或上下文"
        :disabled="status !== 'ready'"
      >
    </label>
    <p
      v-if="status === 'loading'"
      role="status"
    >
      正在读取恢复日志…
    </p>
    <p
      v-else-if="status === 'error'"
      class="wj-error"
      role="alert"
    >
      {{ loadError }}
    </p>
    <p
      v-else-if="status === 'signed-out'"
      role="status"
    >
      请登录后查看当前账号的恢复日志。
    </p>
    <p
      v-else-if="status === 'api-only'"
      role="status"
    >
      正式流程恢复日志仅在正式 API 环境中读取；演示数据与正式数据相互隔离。
    </p>
    <template v-else>
      <p class="wj-muted">
        {{ filtered.length }} / {{ entries.length }} 项 · 本机估算
        {{ formatBytes(bytes) }}
      </p>
      <p
        v-if="!filtered.length"
        role="status"
      >
        {{
          entries.length
            ? '没有匹配日志，请调整搜索。'
            : '当前账号暂无正式流程恢复日志。'
        }}
      </p>
      <ul
        v-else
        class="wj-list"
      >
        <li
          v-for="entry in filtered"
          :key="entry.key"
          class="wj-row"
        >
          <div class="wj-row-heading">
            <h3>{{ entry.group }}</h3>
            <span :class="{ 'wj-warning': !entry.deletable }">{{
              phases[entry.phase]
            }}</span>
          </div>
          <p class="wj-context">
            {{ JSON.stringify(entry.context) }}
          </p>
          <p
            v-if="entry.operation"
            class="wj-muted"
          >
            操作：{{ entry.operation }}
          </p>
          <p class="wj-muted">
            {{ kinds[entry.kind] }} · {{ formatTime(entry.updatedAt) }} · 估算
            {{ formatBytes(entry.bytes) }}
          </p>
          <p
            v-if="entry.protectionReason"
            class="wj-warning"
          >
            {{ entry.protectionReason }}
          </p>
          <div class="wj-actions">
            <button
              type="button"
              :disabled="busy"
              @click="inspect(entry)"
            >
              预览
            </button>
            <button
              type="button"
              :disabled="busy"
              @click="download(entry)"
            >
              导出
            </button>
            <button
              type="button"
              class="wj-delete"
              :disabled="busy || !entry.deletable"
              :title="entry.protectionReason || '删除这一项本机日志'"
              @click="remove(entry)"
            >
              删除
            </button>
          </div>
        </li>
      </ul>
    </template>
    <p
      v-if="actionError"
      class="wj-error"
      role="alert"
    >
      {{ actionError }}
    </p>
    <p
      v-if="message"
      role="status"
    >
      {{ message }}
    </p>
    <section
      v-if="preview"
      class="wj-preview"
      aria-label="日志预览"
    >
      <header class="wj-heading">
        <h3>日志预览</h3>
        <button
          type="button"
          @click="preview = null"
        >
          关闭预览
        </button>
      </header>
      <p class="wj-context">
        {{ preview.key }}
      </p>
      <pre tabindex="0">{{ journalPreview(preview) }}</pre>
      <button
        type="button"
        :disabled="busy"
        @click="download(preview)"
      >
        导出此日志
      </button>
    </section>
  </section>
</template>

<style scoped>
.workflow-journals {
  color: #222;
  background: #fff;
  padding: 16px;
  min-width: 0;
  font-size: 16px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.workflow-journals *,
.workflow-journals *::before,
.workflow-journals *::after {
  box-sizing: border-box;
}
.wj-heading,
.wj-row-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.wj-heading h2 {
  font-size: 18px;
}
.wj-heading h2,
.wj-heading h3,
.wj-row-heading h3 {
  margin: 0;
  line-height: 1.4;
}
.wj-heading h3,
.wj-row-heading h3 {
  font-size: 16px;
}
.wj-row-heading h3 {
  flex: 1 1 160px;
  min-width: 0;
}
.workflow-journals p {
  margin: 8px 0;
}
.wj-muted {
  color: #555;
}
.wj-error,
.wj-delete {
  color: #a02323;
}
.wj-warning {
  color: #76501b;
}
.wj-search {
  display: grid;
  gap: 6px;
  margin: 16px 0;
}
.workflow-journals input,
.workflow-journals button {
  font: inherit;
  border: 1px solid #b9bfc4;
  border-radius: 6px;
  background: #fff;
  color: inherit;
}
.workflow-journals input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 8px 10px;
}
.workflow-journals button {
  min-height: 44px;
  padding: 8px 14px;
  cursor: pointer;
}
.workflow-journals button.wj-delete {
  color: #a02323;
}
.workflow-journals button:hover:enabled {
  background: #f1f4f3;
  border-color: #658077;
}
.workflow-journals button:disabled {
  cursor: default;
  color: #72777a;
  background: #f4f4f4;
}
.workflow-journals :focus-visible {
  outline: 2px solid #24705a;
  outline-offset: 3px;
}
.wj-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.wj-row {
  padding: 16px 0;
  border-top: 1px solid #d8dcdf;
}
.wj-context {
  white-space: pre-wrap;
  word-break: break-word;
}
.wj-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.wj-preview {
  border-top: 2px solid #658077;
  padding-top: 16px;
  margin-top: 20px;
}
.wj-preview pre {
  margin: 12px 0;
  max-height: 360px;
  max-width: 100%;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 16px;
  line-height: 1.5;
}
@media (max-width: 480px) {
  .workflow-journals {
    padding: 12px;
  }
  .wj-actions button {
    flex: 1 1 72px;
  }
}
</style>
