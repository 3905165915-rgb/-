<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import WorkflowPanel from './WorkflowPanel.vue'
import { listAll, request, type Row } from './model'
import {
  object,
  rows,
  useWorkspaceAction,
  workspaceDate,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import {
  changeReason,
  changeStatus,
  nextChangeAction,
  recentChangeTitle,
} from './change-center'

const props = withDefaults(defineProps<{ context?: Row }>(), {
  context: () => ({}),
})
const scope = useWorkspaceScope()
const elderId = ref('')
const tab = ref('open')
const cases = ref<Row[]>([]),
  elders = ref<Row[]>([]),
  tasks = ref<Row[]>([]),
  events = ref<Row[]>([])
const selected = ref<Row | null>(null)
const actionPath = ref('')
const detailPanel = ref<HTMLElement>()
const loading = ref(false),
  detailLoading = ref(false),
  error = ref(''),
  notice = ref('')
const scan = useWorkspaceAction(elderId, 'care-change-scan', '/change-reviews/')
const reading = useWorkspaceAction(
  elderId,
  'care-change-read',
  '/insights/changes',
)
const unread = ref(0)
let epoch = 0,
  detailEpoch = 0
const filtered = computed(() =>
  cases.value.filter(
    (row) =>
      (!elderId.value || row.elder_id === elderId.value) &&
      (tab.value === 'closed'
        ? row.status === 'closed'
        : row.status !== 'closed'),
  ),
)
const openCount = computed(
  () =>
    cases.value.filter(
      (row) =>
        row.status !== 'closed' &&
        (!elderId.value || row.elder_id === elderId.value),
    ).length,
)
const next = computed(() =>
  selected.value
    ? nextChangeAction(
        selected.value,
        scope.owner?.userId || '',
        scope.management,
      )
    : null,
)
const formContext = computed(() =>
  selected.value
    ? {
        case_id: selected.value.id,
        elder_id: selected.value.elder_id,
        expected_revision: selected.value.revision,
        expected_fingerprint: selected.value.fingerprint,
      }
    : {},
)
const relatedTask = computed(() =>
  tasks.value.find((row) => row.id === selected.value?.task_id),
)
const oldHint = computed(() => {
  const initial = selected.value?.initial_snapshot as Row | undefined
  const ref = initial?.reference as Row | undefined
  return String(
    (ref?.snapshot as Row | undefined)?.content ||
      '展开原文与历史可查看当时采用的提示。',
  )
})
function elderName(id: unknown) {
  return String(elders.value.find((row) => row.id === id)?.name || '相关老人')
}
function taskName(id: unknown) {
  return String(
    tasks.value.find((row) => row.id === id)?.title || '相关服务任务',
  )
}
async function load() {
  const ticket = ++epoch
  if (!scope.valid()) return
  loading.value = true
  error.value = ''
  try {
    const result = await Promise.all([
      listAll('/change-reviews'),
      listAll('/elders'),
      listAll('/tasks'),
    ])
    if (ticket !== epoch || !scope.valid()) return
    cases.value = result[0]
    elders.value = result[1]
    tasks.value = result[2]
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
async function loadRecent() {
  const ticket = ++epoch
  if (!scope.valid() || !scope.management) return
  loading.value = true
  error.value = ''
  try {
    const result = object(
      await request(
        '/insights/changes?limit=50' +
          (elderId.value
            ? '&elder_id=' + encodeURIComponent(elderId.value)
            : ''),
      ),
    )
    if (ticket !== epoch || !scope.valid()) return
    events.value = rows(result.events)
    unread.value = Number(result.total_events || events.value.length)
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
async function openCase(id: string) {
  const ticket = ++detailEpoch
  if (!scope.valid()) return
  detailLoading.value = true
  error.value = ''
  actionPath.value = ''
  selected.value = null
  try {
    const row = object(
      await request('/change-reviews/' + encodeURIComponent(id)),
    )
    if (ticket !== detailEpoch || !scope.valid()) return
    if (row.id !== id) throw new Error('核对事项与当前选择不一致，请刷新。')
    selected.value = row
    await nextTick()
    if (ticket === detailEpoch && scope.valid())
      detailPanel.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  } catch (failure) {
    if (ticket === detailEpoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === detailEpoch) detailLoading.value = false
  }
}
function close() {
  detailEpoch++
  selected.value = null
  actionPath.value = ''
  detailLoading.value = false
}
async function refresh() {
  if (tab.value === 'recent') await loadRecent()
  else await load()
}
async function changed() {
  const id = String(selected.value?.id || '')
  await load()
  if (id && scope.valid()) await openCase(id)
}
async function scanChanges() {
  if (!scope.management || !scope.valid()) return
  const result = await scan.submit(
    '/change-reviews/scan',
    elderId.value ? { elder_id: elderId.value } : {},
    (value) => {
      const row = object(value)
      if (!Array.isArray(row.created_ids) || !Array.isArray(row.updated_ids))
        throw new Error('检查回执待核实，请重试原提交。')
      return row
    },
  )
  if (result && scope.valid()) {
    notice.value = '已检查当前任务引用的照护提示。'
    await load()
  }
}
async function markRead(id: string) {
  if (!scope.management || !scope.valid()) return
  const receipt = await reading.submit(
    '/insights/changes/acknowledge',
    { event_ids: [id] },
    (value) => {
      const row = object(value)
      if (row.acknowledged !== true || row.task_status_changed !== false)
        throw new Error('已读结果待核实，请重试。')
      return row
    },
  )
  if (receipt && scope.valid()) await loadRecent()
}
watch([tab, elderId], () => {
  close()
  if (tab.value === 'recent') void loadRecent()
})
watch(
  () => props.context.case_id || props.context.change_review_id,
  (value) => {
    if (typeof value === 'string' && value) void openCase(value)
  },
  { immediate: true },
)
watch(scope.active, (value) => {
  if (!value) {
    epoch++
    close()
    cases.value = []
    elders.value = []
    tasks.value = []
    events.value = []
  }
})
void load()
onBeforeUnmount(() => {
  epoch++
  detailEpoch++
})
</script>
<template>
  <section
    v-if="scope.active.value"
    class="change-centre"
    aria-label="照护变化"
  >
    <header class="change-heading">
      <div>
        <h1>照护变化</h1>
        <p>看看哪里变了，核对相关服务，再确认处理。</p>
      </div>
      <button type="button" :disabled="loading" @click="refresh">刷新</button>
    </header>
    <div class="change-filters">
      <label
        >老人<select v-model="elderId">
          <option value="">全部老人</option>
          <option
            v-for="elder in elders"
            :key="String(elder.id)"
            :value="String(elder.id)"
          >
            {{ elder.name }}
          </option>
        </select></label
      >
      <div class="change-tabs" aria-label="变化分类">
        <button
          type="button"
          :aria-pressed="tab === 'open'"
          @click="tab = 'open'"
        >
          需要处理（{{ openCount }}）</button
        ><button
          type="button"
          :aria-pressed="tab === 'closed'"
          @click="tab = 'closed'"
        >
          已处理</button
        ><button
          v-if="scope.management"
          type="button"
          :aria-pressed="tab === 'recent'"
          @click="tab = 'recent'"
        >
          最近变化
        </button>
      </div>
    </div>
    <p
      v-if="error || scan.error.value || reading.error.value"
      role="alert"
      class="change-error"
    >
      {{ error || scan.error.value || reading.error.value }}
    </p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loading" role="status">正在查看照护变化…</p>
    <template v-if="tab !== 'recent'">
      <div v-if="!loading && !filtered.length" class="change-empty">
        <strong>{{
          tab === 'closed' ? '暂时没有已处理事项' : '当前没有需要处理的变化'
        }}</strong>
        <p>记录和个人印象更新后，相关服务如需核对，会显示在这里。</p>
      </div>
      <article
        v-for="row in filtered"
        :key="String(row.id)"
        class="change-card"
      >
        <div class="change-card-heading">
          <strong
            >{{ elderName(row.elder_id) }} · {{ taskName(row.task_id) }}</strong
          ><span>{{ changeStatus(row.status) }}</span>
        </div>
        <p>{{ changeReason(row) }}</p>
        <div class="change-card-footer">
          <small>{{ workspaceDate(row.updated_at) }}</small
          ><button
            type="button"
            :disabled="detailLoading"
            @click="openCase(String(row.id))"
          >
            {{ row.status === 'closed' ? '查看处理经过' : '查看并处理' }}
          </button>
        </div>
      </article>
      <details v-if="scope.management" class="change-more">
        <summary>没看到刚发生的变化？</summary>
        <p>检查任务采用的提示是否更新或到期，不会自动修改任务。</p>
        <button
          type="button"
          :disabled="loading || scan.busy.value || !!scan.pending.value"
          @click="scanChanges"
        >
          检查最新变化</button
        ><button
          v-if="scan.pending.value"
          type="button"
          :disabled="scan.busy.value"
          @click="scanChanges"
        >
          重试原检查
        </button>
      </details>
    </template>
    <section v-else aria-label="最近变化">
      <p>
        最近一天共 {{ unread }} 条动态；这里展示最新 50
        条。查看动态不会完成相关任务。
      </p>
      <p v-if="!loading && !events.length" class="change-empty">
        最近没有新的照护动态。
      </p>
      <article
        v-for="event in events"
        :key="String(event.id)"
        class="change-card"
      >
        <div class="change-card-heading">
          <strong
            >{{ elderName(event.elder_id) }} ·
            {{ recentChangeTitle(event) }}</strong
          ><small>{{ workspaceDate(event.created_at) }}</small>
        </div>
        <p>{{ event.detail || recentChangeTitle(event) }}</p>
        <small v-if="event.acknowledged">已读</small>
        <button
          v-else
          type="button"
          :disabled="reading.busy.value || !!reading.pending.value"
          @click="markRead(String(event.id))"
        >
          标记已读
        </button>
      </article>
      <button
        v-if="reading.pending.value"
        type="button"
        :disabled="reading.busy.value"
        @click="markRead('')"
      >
        重试原已读操作
      </button>
    </section>
    <section
      v-if="detailLoading || selected"
      ref="detailPanel"
      class="change-detail"
      aria-label="核对这次变化"
    >
      <header class="change-heading">
        <h2>核对这次变化</h2>
        <button type="button" @click="close">收起</button>
      </header>
      <p v-if="detailLoading">正在读取当前情况…</p>
      <template v-if="selected"
        ><h3>
          {{ elderName(selected.elder_id) }} · {{ taskName(selected.task_id) }}
        </h3>
        <p>{{ changeReason(selected) }}</p>
        <ol class="change-steps">
          <li>查看变化</li>
          <li>核对相关服务</li>
          <li>确认处理</li>
        </ol>
        <div class="change-hint">
          <strong>原来采用的提示</strong>
          <p>{{ oldHint }}</p>
        </div>
        <p v-if="relatedTask">
          相关服务：{{ relatedTask.title }}。请先核实这项服务是否需要调整。
        </p>
        <RouterLink
          v-if="selected.task_id"
          :to="'/tasks?task=' + encodeURIComponent(String(selected.task_id))"
          >打开相关任务</RouterLink
        >
        <p v-if="selected.status === 'awaiting_review' && !next">
          处理结果已提交，请由另一位负责人复查。
        </p>
        <p v-else-if="selected.status === 'assigned' && !next">
          已交给处理人核对，完成后会在这里更新。
        </p>
        <button
          v-if="next && !actionPath"
          type="button"
          class="change-primary"
          @click="actionPath = next.path"
        >
          {{ next.label }}
        </button>
        <WorkflowPanel
          v-if="actionPath"
          :key="String(selected.id) + actionPath"
          group="changes"
          :title="next?.label || '处理这次变化'"
          :initial-action="actionPath"
          :context="formContext"
          focused
          @changed="changed"
        />
        <details class="change-more">
          <summary>原文、影响与处理历史</summary>
          <WorkflowPanel
            :key="String(selected.id) + '-evidence'"
            group="changes"
            title="核实依据"
            initial-action="/change-reviews/{case_id}"
            :context="formContext"
            focused
            auto-read
          />
        </details>
      </template>
    </section>
  </section>
</template>
<style scoped>
.change-centre {
  max-width: 1120px;
  margin: 0 auto;
  min-width: 0;
}
.change-heading,
.change-card-heading,
.change-card-footer,
.change-filters,
.change-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h1 {
  margin: 0;
  font-size: 28px;
}
h2 {
  font-size: 20px;
}
h3 {
  font-size: 17px;
}
p {
  line-height: 1.7;
  color: var(--hl-muted, #586778);
}
small {
  color: var(--hl-muted, #586778);
}
.change-filters {
  justify-content: flex-start;
  margin-block: 22px;
}
label {
  display: flex;
  align-items: center;
  gap: 8px;
}
select,
button {
  min-height: 42px;
  padding: 8px 14px;
  border: 1px solid var(--hl-border, #dce3eb);
  border-radius: 12px;
  font: inherit;
  background: rgba(255, 255, 255, 0.72);
  color: var(--hl-text, #243446);
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.55;
}
button:hover:not(:disabled) {
  border-color: var(--hl-primary, #6f5bc8);
}
.change-tabs button[aria-pressed='true'],
.change-primary {
  background: var(--hl-primary, #6f5bc8);
  color: white;
}
.change-card,
.change-detail,
.change-empty {
  padding: 20px;
  margin-block: 14px;
  border: 1px solid rgba(210, 218, 233, 0.75);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.73);
  backdrop-filter: blur(12px);
  overflow-wrap: anywhere;
}
.change-card {
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}
.change-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 7px 18px rgba(39, 45, 74, 0.06);
}
.change-card-heading span {
  font-size: 13px;
  padding: 5px 10px;
  border-radius: 20px;
  background: #f0edf9;
  color: #6551ac;
}
.change-empty {
  text-align: center;
  padding: 36px 18px;
}
.change-more {
  margin-top: 20px;
}
.change-more summary {
  cursor: pointer;
  min-height: 40px;
  line-height: 40px;
  color: var(--hl-primary, #6f5bc8);
}
.change-detail {
  border-color: var(--hl-primary, #6f5bc8);
  scroll-margin-top: 90px;
}
.change-steps {
  display: flex;
  gap: 30px;
  flex-wrap: wrap;
  padding-left: 22px;
  color: #6c58ad;
}
.change-hint {
  padding: 15px;
  background: #f5f3fb;
  border-radius: 12px;
}
.change-primary {
  display: block;
  margin-top: 18px;
}
.change-error {
  color: #b42318;
}
@media (max-width: 600px) {
  .change-card,
  .change-detail {
    padding: 16px;
  }
  .change-tabs {
    width: 100%;
    gap: 6px;
  }
  .change-tabs button {
    flex: 1;
    padding-inline: 8px;
    font-size: 13px;
  }
  h1 {
    font-size: 24px;
  }
  .change-steps {
    gap: 22px;
    font-size: 13px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .change-card {
    transition: none;
  }
  .change-card:hover {
    transform: none;
  }
}
</style>
