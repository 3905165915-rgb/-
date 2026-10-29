<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { readSession } from '@hulao/shared'
import { request } from '../../../../../packages/shared/src/workflow/model'
import { RefreshCw } from 'lucide-vue-next'
import { mode, session } from '../../services/data'
import DemoDashboard from './DemoDashboard.vue'
import {
  captureDashboardRequest,
  createRequestGuard,
  dashboardGroupLabel,
  dashboardLabels,
  dashboardLocation,
  dashboardRowKey,
  defaultWindow,
  formatRatio,
  formatTime,
  loadDashboardDirectory,
  selectedDashboardRows,
  statusLabels,
  statusOptions,
  validateDashboard,
  validateWindow,
  taskArrangementSeries,
  taskStatusSegments,
  type DashboardSnapshot,
  type DashboardSelection,
  type DateWindow,
  type Row,
} from './dashboard'

function resetFilters() {
  elderId.value = ''
  shiftId.value = ''
  status.value = ''
  start.value = dates.start
  end.value = dates.end
  void refresh()
}
const dates = defaultWindow(Date.now(), 7)
const start = ref(dates.start),
  end = ref(dates.end)
const elderId = ref(''),
  shiftId = ref(''),
  status = ref('')
const elders = ref<Row[]>([]),
  shifts = ref<Row[]>([])
const loading = ref(false),
  catalogError = ref(''),
  error = ref(''),
  rangeError = ref('')
const snapshot = shallowRef<DashboardSnapshot | null>(null)
const selection = ref<DashboardSelection>({ kind: 'pending' })
const drilldown = ref<HTMLElement>()
const page = ref(1),
  pageSize = 20
let disposed = false
function currentScope(): string | null {
  const current = readSession()
  return mode === 'api' &&
    current?.mode === 'api' &&
    !!current.accessToken &&
    ['admin', 'supervisor'].includes(current.role || '')
    ? JSON.stringify([
        current.accountKey,
        current.userId,
        current.role,
        current.accessToken,
      ])
    : null
}
const guard = createRequestGuard(currentScope)
const directoryGuard = createRequestGuard(currentScope)
const owner = ref<string | null>(null)
const visible = computed(
  () => !!session.value && !!owner.value && owner.value === currentScope(),
)
const shown = computed(() => (visible.value ? snapshot.value : null))
const selectedRows = computed(() =>
  shown.value ? selectedDashboardRows(shown.value, selection.value) : [],
)
const displayedRows = computed(() =>
  selectedRows.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)
const pages = computed(() =>
  Math.max(1, Math.ceil(selectedRows.value.length / pageSize)),
)
const selectedTitle = computed(() =>
  selection.value.kind === 'pending'
    ? '待处理事项 · 详情'
    : selection.value.kind === 'card' || selection.value.kind === 'comparison'
      ? dashboardLabels[selection.value.key || ''] || '工作事项'
      : selection.value.kind === 'trend'
        ? `${selection.value.key || ''} · 计划服务`
        : selection.value.kind === 'activity'
          ? `${selection.value.key || ''} · 任务安排`
          : `${dashboardLabels[selection.value.section || ''] || '分类'} · ${dashboardGroupLabel(selection.value.section || '', selection.value.key || '')}`,
)
const taskSeries = computed(() =>
  shown.value ? taskArrangementSeries(shown.value) : [],
)
const taskSummary = computed(() =>
  shown.value ? taskStatusSegments(shown.value) : { total: 0, groups: [] },
)
const taskPeak = computed(() =>
  Math.max(1, ...taskSeries.value.map((point) => point.count)),
)
const hasPlanTrend = computed(() =>
  shown.value?.task_trend.some((point) => Number(point.count) > 0),
)
const statusColor = (status: string) =>
  ({
    completed: '#209b7b',
    pending: '#7c68ce',
    in_progress: '#419fc6',
    overdue: '#d06562',
    not_done: '#c39441',
    cancelled: '#a4a8b5',
  })[status] || '#8596af'
function elderNameFallback(row: Row) {
  return typeof row.elder_id === 'string' ? '老人信息' : '未关联老人'
}
const distributionPanels = computed(() => {
  const data = shown.value?.distributions || {}
  return Object.entries(data)
    .filter(([, groups]) => groups.length)
    .map(([key, groups]) => ({
      key,
      label: dashboardLabels[key] || key,
      groups,
    }))
})
function message(reason: unknown) {
  return reason instanceof Error ? reason.message : '加载失败，请重试。'
}
async function loadDirectories() {
  const accepts = directoryGuard.begin()
  catalogError.value = ''
  const [elderResult, shiftResult] = await Promise.allSettled([
    loadDashboardDirectory(request, '/elders', accepts),
    loadDashboardDirectory(request, '/shifts', accepts),
  ])
  if (disposed || !accepts()) return
  if (elderResult.status === 'fulfilled' && elderResult.value)
    elders.value = elderResult.value
  else catalogError.value = '老人目录暂未载入，仍可查看不按老人筛选的看板。'
  if (shiftResult.status === 'fulfilled' && shiftResult.value)
    shifts.value = shiftResult.value
  else catalogError.value = '班次目录暂未载入，仍可查看不按班次筛选的看板。'
}
async function refresh() {
  if (mode !== 'api' || disposed) return
  const window: DateWindow = { start: start.value, end: end.value }
  rangeError.value = validateWindow(window) || ''
  if (rangeError.value) return
  const accepts = guard.begin()
  snapshot.value = null
  error.value = ''
  page.value = 1
  selection.value = { kind: 'pending' }
  owner.value = currentScope()
  if (!owner.value) {
    error.value = '请使用主管或管理员服务器账号登录。'
    loading.value = false
    return
  }
  loading.value = true
  const captured = captureDashboardRequest(window, {
    elder_id: elderId.value,
    shift_id: shiftId.value,
    status: status.value,
  })
  try {
    const response = await request(captured.path)
    if (disposed) return
    if (!accepts()) {
      if (owner.value !== currentScope()) clear()
      return
    }
    snapshot.value = validateDashboard(
      response,
      captured.window,
      captured.filters,
    )
  } catch (failure) {
    if (!disposed && accepts()) error.value = message(failure)
  } finally {
    if (!disposed && accepts()) loading.value = false
  }
}
async function choose(next: DashboardSelection) {
  selection.value = next
  page.value = 1
  await nextTick()
  drilldown.value?.focus({ preventScroll: true })
  drilldown.value?.scrollIntoView({
    block: 'start',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth',
  })
}
function barWidth(value: number, values: number[]) {
  const max = Math.max(1, ...values)
  return `${Math.max(value ? 4 : 0, (value / max) * 100)}%`
}
function clear() {
  guard.invalidate()
  directoryGuard.invalidate()
  snapshot.value = null
  owner.value = null
  elders.value = []
  shifts.value = []
  catalogError.value = ''
  loading.value = false
  error.value = ''
}
function checkSession() {
  if (owner.value !== currentScope()) clear()
}
watch(
  session,
  () => {
    clear()
    if (currentScope()) {
      void loadDirectories()
      void refresh()
    }
  },
  { immediate: true, flush: 'sync' },
)
onMounted(() => {
  window.addEventListener('storage', checkSession)
  window.addEventListener('focus', checkSession)
  window.addEventListener('hulao:unauthorized', clear)
})
onBeforeUnmount(() => {
  disposed = true
  clear()
  window.removeEventListener('storage', checkSession)
  window.removeEventListener('focus', checkSession)
  window.removeEventListener('hulao:unauthorized', clear)
})
</script>

<template>
  <DemoDashboard v-if="mode === 'demo'" />
  <main v-else class="dashboard-page">
    <header class="dashboard-header">
      <div>
        <h1>{{ session?.role === 'supervisor' ? '照护主管工作台' : '机构管理看板' }}</h1>
        <p>{{ session?.role === 'supervisor' ? '今日照护、风险提醒、任务接续和质量跟进' : '机构运营、照护任务、人员与服务质量，一处掌握' }}</p>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="刷新完整看板"
        title="刷新完整看板"
        :disabled="loading"
        @click="refresh"
      >
        <RefreshCw :size="18" aria-hidden="true" />
      </button>
    </header>
    <form class="filters" @submit.prevent="refresh">
      <label
        >开始日期（含）<input v-model="start" type="date" required
      /></label>
      <label
        >结束日期（不含）<input v-model="end" type="date" required
      /></label>
      <label
        >老人<select v-model="elderId" aria-label="老人">
          <option value="">全部授权老人</option>
          <option
            v-for="elder in elders"
            :key="String(elder.id)"
            :value="String(elder.id)"
          >
            {{ elder.name
            }}<template v-if="elder.bed_label">
              · {{ elder.bed_label }}</template
            >
          </option>
        </select></label
      >
      <label
        >班次<select v-model="shiftId">
          <option value="">所有班次</option>
          <option
            v-for="shift in shifts"
            :key="String(shift.id)"
            :value="String(shift.id)"
          >
            {{ shift.name }}
          </option>
        </select></label
      >
      <label
        >状态<select v-model="status">
          <option value="">全部状态</option>
          <option v-for="value in statusOptions" :key="value" :value="value">
            {{ statusLabels[value] || '状态待核实' }}
          </option>
        </select></label
      >
      <button type="submit" :disabled="loading">应用筛选</button>
      <button
        type="button"
        class="secondary"
        :disabled="loading"
        @click="resetFilters"
      >
        重置筛选
      </button>
      <p class="filter-note">按北京时间统计，更改条件后点击应用筛选。</p>
      <p v-if="rangeError" class="error" role="alert">{{ rangeError }}</p>
      <p v-if="catalogError" class="muted" role="status">{{ catalogError }}</p>
    </form>
    <p v-if="loading" role="status">正在更新看板…</p>
    <div v-if="error" class="error-state" role="alert">
      <p>{{ error }}</p>
      <button type="button" @click="refresh">重试</button>
    </div>
    <template v-if="shown">
      <section class="snapshot-meta">
        <p>
          <strong>更新于</strong> · {{ formatTime(shown.as_of) }}（北京时间）
        </p>
        <p>展示当前待办与照护进展，点击指标可查看明细。</p>
      </section>
      <section class="metric-grid" aria-label="待处理统计">
        <button
          v-for="(card, key) in shown.cards"
          :key="key"
          type="button"
          class="metric"
          :class="{
            selected: selection.kind === 'card' && selection.key === key,
          }"
          @click="choose({ kind: 'card', key })"
        >
          <span>{{ dashboardLabels[key] || key }}</span
          ><strong>{{ card.count }}</strong
          ><small
            >上期 {{ card.previous_count }} · {{ card.change > 0 ? '+' : ''
            }}{{ card.change }} ·
            {{
              card.change_ratio === null
                ? '暂无可计算数据'
                : new Intl.NumberFormat('zh-CN', {
                    style: 'percent',
                    maximumFractionDigits: 1,
                  }).format(card.change_ratio)
            }}</small
          >
        </button>
      </section>
      <div class="overview-charts">
        <section class="chart-section" aria-labelledby="task-summary-title">
          <h2 id="task-summary-title">任务状态总览</h2>
          <p>来自当前筛选范围，点击状态查看对应任务。</p>
          <div v-if="taskSummary.total" class="task-summary-visual">
            <svg
              viewBox="0 0 120 120"
              class="task-donut"
              role="img"
              :aria-label="`任务状态分布，共${taskSummary.total}项`"
            >
              <circle
                cx="60"
                cy="60"
                r="44"
                fill="none"
                stroke="#e9e6f2"
                stroke-width="13"
              />
              <circle
                v-for="group in taskSummary.groups"
                :key="group.key"
                cx="60"
                cy="60"
                r="44"
                fill="none"
                :stroke="statusColor(group.key)"
                stroke-width="13"
                pathLength="100"
                :stroke-dasharray="`${group.fraction * 100} ${100 - group.fraction * 100}`"
                :stroke-dashoffset="-group.offset * 100"
                transform="rotate(-90 60 60)"
              />
              <text x="60" y="59" text-anchor="middle" class="donut-total">
                {{ taskSummary.total }}
              </text>
              <text x="60" y="77" text-anchor="middle" class="donut-caption">
                项任务
              </text>
            </svg>
            <div class="task-legend">
              <button
                v-for="group in taskSummary.groups"
                :key="group.key"
                type="button"
                class="legend-button"
                @click="
                  choose({
                    kind: 'distribution',
                    section: 'tasks',
                    key: group.key,
                  })
                "
              >
                <span
                  class="legend-dot"
                  :style="{ background: statusColor(group.key) }"
                />{{ statusLabels[group.key] || '状态待核实'
                }}<strong>{{ group.count }} 项</strong>
              </button>
            </div>
          </div>
          <p v-else class="chart-empty">
            当前范围还没有任务，可调整日期或先安排照护任务。
          </p>
        </section>
        <section class="chart-section" aria-labelledby="activity-title">
          <h2 id="activity-title">每日任务安排</h2>
          <p>
            包含人工与计划任务，按服务时间或截止时间统计；颜色展示当前状态。
          </p>
          <div
            v-if="taskSummary.total"
            class="activity-chart"
            :class="{ 'compact-week': taskSeries.length <= 7 }"
          >
            <button
              v-for="point in taskSeries"
              :key="point.date"
              type="button"
              class="activity-point"
              :disabled="!point.count"
              :aria-label="`${point.date}：${point.count}项任务，其中已完成${point.completed}项、逾期${point.overdue}项，查看明细`"
              @click="choose({ kind: 'activity', key: point.date })"
            >
              <strong>{{ point.count }}</strong
              ><span
                class="activity-bar"
                :style="{
                  height: `${point.count ? Math.max(10, (point.count / taskPeak) * 110) : 2}px`,
                }"
                ><span
                  class="activity-complete"
                  :style="{
                    height: `${point.count ? (point.completed / point.count) * 100 : 0}%`,
                  }" /><span
                  class="activity-overdue"
                  :style="{
                    height: `${point.count ? (point.overdue / point.count) * 100 : 0}%`,
                  }" /></span
              ><small>{{ point.date.slice(5).replace('-', '/') }}</small>
            </button>
          </div>
          <p v-else class="chart-empty">暂无任务安排，建立任务后会自动统计。</p>
          <p class="chart-legend">
            <span class="legend-dot" style="background: #209b7b" />已完成
            <span class="legend-dot" style="background: #d06562" />逾期
            <span class="legend-dot" style="background: #7c68ce" />其他安排
          </p>
        </section>
      </div>
      <details class="chart-section plan-trend">
        <summary>计划服务完成率（专项）</summary>
        <p>仅统计已到服务时间的计划任务，人工任务不计入此完成率。</p>
        <div v-if="hasPlanTrend" class="trend-chart">
          <button
            v-for="point in shown.task_trend"
            :key="String(point.date)"
            type="button"
            class="trend-point"
            :disabled="!point.count"
            :class="{
              selected:
                selection.kind === 'trend' && selection.key === point.date,
            }"
            :aria-label="`${point.date}：完成${formatRatio(point.completion)}，${point.count}项；查看明细`"
            @click="choose({ kind: 'trend', key: String(point.date) })"
          >
            <span class="trend-bar"
              ><span
                :style="{
                  height: `${(point.completion as Row).ratio === null ? 0 : Number((point.completion as Row).ratio) * 100}%`,
                }" /></span
            ><strong>{{ formatRatio(point.completion) }}</strong
            ><small>{{ point.date }}</small
            ><small>{{ point.count }}项</small>
          </button>
        </div>
        <p v-else class="muted">
          当前范围没有到服务时间的计划任务，暂无可计算的计划完成率；上方仍展示人工任务安排。
        </p>
      </details>
      <details class="chart-section">
        <summary>查看上一周期对比</summary>
        <div class="filters">
          <button
            v-for="(card, key) in shown.comparison.cards"
            :key="key"
            type="button"
            class="secondary"
            @click="choose({ kind: 'comparison', key })"
          >
            {{ dashboardLabels[key] }} · {{ card.count }}项
          </button>
        </div>
      </details>
      <section
        v-for="panel in distributionPanels"
        :key="panel.key"
        class="chart-section"
      >
        <h2>{{ panel.label }}</h2>
        <div class="distribution-list">
          <button
            v-for="group in panel.groups"
            :key="group.key"
            type="button"
            class="distribution"
            :class="{
              selected:
                selection.kind === 'distribution' &&
                selection.section === panel.key &&
                selection.key === group.key,
            }"
            :aria-pressed="
              selection.kind === 'distribution' &&
              selection.section === panel.key &&
              selection.key === group.key
            "
            @click="
              choose({
                kind: 'distribution',
                section: panel.key,
                key: group.key,
              })
            "
          >
            <span>{{ dashboardGroupLabel(panel.key, group.key) }}</span
            ><strong>{{ group.count }}</strong
            ><span class="distribution-track"
              ><span
                :style="{
                  width: barWidth(
                    group.count,
                    panel.groups.map((item) => item.count),
                  ),
                }" /></span
            ><small>查看 {{ group.ids.length }} 项</small>
          </button>
        </div>
      </section>
      <section class="pending-section">
        <div class="section-heading">
          <div>
            <h2>优先待处理</h2>
            <p>优先关注待分级事件、人工标记的高风险事项和临近期限的任务。</p>
          </div>
          <button
            type="button"
            class="secondary"
            @click="choose({ kind: 'pending' })"
          >
            查看全部 {{ shown.pending_work.items.length }} 项
          </button>
        </div>
        <ul>
          <li
            v-for="item in shown.pending_work.items.slice(0, 5)"
            :key="String(item.kind) + ':' + String(item.id)"
          >
            <div>
              <strong
                >{{ item.elder_name || '老人信息暂不可用' }} ·
                {{ item.title }}</strong
              >
              <p>
                {{ statusLabels[String(item.status)] || '状态待核实' }} ·
                {{ item.priority_reason || '按业务状态办理'
                }}<span v-if="item.assigned_name">
                  · {{ item.assigned_name }}</span
                >
              </p>
            </div>
            <RouterLink :to="dashboardLocation(item)">进入办理</RouterLink>
          </li>
        </ul>
        <p v-if="!shown.pending_work.items.length" role="status">
          当前筛选下暂无待处理事项。
        </p>
      </section>
      <section
        ref="drilldown"
        class="drilldown"
        tabindex="-1"
        aria-label="指标明细"
        aria-live="polite"
      >
        <div class="section-heading">
          <div>
            <h2>{{ selectedTitle }}</h2>
            <p>进入对应事项，查看来源并跟进处理。</p>
          </div>
          <span>{{ selectedRows.length }} 项</span>
        </div>
        <ul>
          <li v-for="row in displayedRows" :key="dashboardRowKey(row)">
            <div>
              <strong
                >{{ row.elder_name || elderNameFallback(row) }} ·
                {{
                  row.title || dashboardLabels[String(row.kind)] || '业务事项'
                }}</strong
              >
              <p>
                {{ statusLabels[String(row.status)] || '状态待核实' }} ·
                {{ formatTime(row.metric_at || row.created_at)
                }}<span v-if="row.assigned_name">
                  · 负责人：{{ row.assigned_name }}</span
                >
              </p>
              <details>
                <summary>查看编号与来源</summary>
                <p>
                  {{ row.id
                  }}<span v-if="row.source_id"> · 来源 {{ row.source_id }}</span
                  ><span v-if="row.due_at">
                    · 截止 {{ formatTime(row.due_at) }}</span
                  >
                </p>
              </details>
            </div>
            <RouterLink :to="dashboardLocation(row)">查看对象</RouterLink>
          </li>
        </ul>
        <p v-if="!displayedRows.length" class="muted">当前指标暂无相关明细。</p>
        <nav v-if="selectedRows.length > pageSize" class="pagination">
          <button
            type="button"
            class="secondary"
            :disabled="page <= 1"
            @click="page--"
          >
            上一页</button
          ><span>第 {{ page }} / {{ pages }} 页</span
          ><button
            type="button"
            class="secondary"
            :disabled="page >= pages"
            @click="page++"
          >
            下一页
          </button>
        </nav>
      </section>
      <details class="definitions">
        <summary>统计口径与排除项</summary>
        <dl>
          <template v-for="(value, key) in shown.definitions" :key="key"
            ><dt>{{ dashboardLabels[String(key)] || key }}</dt>
            <dd>
              {{ String(value).replaceAll('null', '暂无可计算数据') }}
            </dd></template
          >
        </dl>
        <p v-for="(value, key) in shown.excluded" :key="key">
          {{
            key === 'future_trend_task_rows'
              ? '排除的未来任务行'
              : '无效任务时间行'
          }}：{{ value }}
        </p>
        <p>
          同比或环比不能替代服务质量判断；上一周期比较采用当前处理状态，不还原历史时点。
        </p>
      </details>
    </template>
  </main>
</template>

<style scoped>
.dashboard-page {
  min-width: 0;
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px;
  color: var(--hl-ink, #20282e);
  overflow-wrap: anywhere;
}
.dashboard-header,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.dashboard-header {
  position: static;
}
h1 {
  margin: 0;
  font-size: 24px;
}
h2 {
  margin: 0 0 8px;
  font-size: 18px;
}
p {
  color: var(--hl-muted, #5f6b73);
  line-height: 1.55;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  padding-block: 14px;
  border-block: 1px solid var(--hl-border, #dce3e7);
}
.filters label {
  display: grid;
  gap: 6px;
  min-width: 150px;
}
input,
select {
  min-height: 42px;
  max-width: 100%;
  padding: 8px;
  color: var(--hl-ink, #20282e);
  background: #fff;
  border: 1px solid var(--hl-border, #dce3e7);
  border-radius: 6px;
}
button {
  min-height: 40px;
  padding: 8px 12px;
  color: white;
  background: var(--hl-primary, #1767cf);
  border: 1px solid var(--hl-primary, #1767cf);
  border-radius: 6px;
}
.icon-button {
  display: inline-grid;
  place-items: center;
  width: 44px;
  padding: 0;
}
.secondary {
  color: var(--hl-ink, #20282e);
  background: white;
  border-color: var(--hl-border, #dce3e7);
}
.filter-note {
  flex-basis: 100%;
  margin: 0;
  font-size: 14px;
}
.snapshot-meta {
  padding: 10px 0;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.metric {
  display: grid;
  min-height: 112px;
  gap: 5px;
  justify-items: start;
  color: var(--hl-ink, #20282e);
  text-align: left;
  background: #fff;
  border-color: var(--hl-border, #dce3e7);
}
.metric {
  border-radius: 14px;
  padding: 18px;
  background: var(--hl-glass-bg);
  box-shadow: 0 5px 20px rgb(52 42 87 / 4%);
}
.metric strong {
  font-size: 26px;
}
.metric small {
  color: var(--hl-muted, #5f6b73);
}
.selected {
  outline: 2px solid var(--hl-primary, #1767cf);
  outline-offset: 1px;
}
.chart-section,
.pending-section,
.drilldown,
.definitions {
  padding-block: 16px;
  border-bottom: 1px solid var(--hl-border, #dce3e7);
}
.chart-section,
.pending-section,
.drilldown {
  margin-top: 18px;
  padding: 20px;
  border: 1px solid var(--hl-border);
  border-radius: 16px;
  background: var(--hl-glass-bg);
}
.trend-chart {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(58px, 1fr));
  align-items: end;
  gap: 8px;
  min-height: 170px;
  overflow-x: auto;
}
.trend-point {
  display: grid;
  justify-items: center;
  gap: 4px;
  min-width: 54px;
  min-height: 154px;
  padding: 6px 2px;
  color: var(--hl-ink, #20282e);
  background: transparent;
  border: 0;
}
.trend-point strong,
.trend-point small {
  font-size: 12px;
}
.trend-bar {
  display: flex;
  align-items: end;
  width: min(28px, 80%);
  height: 80px;
  background: #edf1f3;
  border-radius: 3px;
  overflow: hidden;
}
.trend-bar > span {
  width: 100%;
  background: #19876b;
  transition: height 120ms ease;
}
.distribution-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.distribution {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) auto;
  align-items: center;
  gap: 5px 10px;
  width: min(100%, 280px);
  min-height: 78px;
  color: var(--hl-ink, #20282e);
  text-align: left;
  background: #fff;
  border-color: var(--hl-border, #dce3e7);
}
.distribution-track {
  grid-column: 1 / -1;
  height: 8px;
  background: #edf1f3;
  border-radius: 4px;
  overflow: hidden;
}
.distribution-track > span {
  display: block;
  height: 100%;
  background: var(--hl-primary);
}
.distribution small {
  grid-column: 1 / -1;
  color: var(--hl-muted, #5f6b73);
}
.overview-charts {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 16px;
}
.overview-charts > section {
  min-width: 0;
}
.task-summary-visual {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.task-donut {
  width: 156px;
  height: 156px;
  flex-shrink: 0;
}
.donut-total {
  fill: var(--hl-ink);
  font-size: 24px;
  font-weight: 700;
}
.donut-caption {
  fill: var(--hl-muted);
  font-size: 10px;
}
.task-legend {
  display: grid;
  gap: 6px;
  flex: 1;
  min-width: 110px;
}
.legend-button {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hl-ink);
  background: transparent;
  border: 1px solid var(--hl-border);
  text-align: left;
}
.legend-button strong {
  margin-left: auto;
}
.legend-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: 50%;
}
.activity-chart {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 8px;
  height: 170px;
  overflow-x: auto;
  padding: 8px 0;
}
.activity-point {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: end;
  gap: 5px;
  min-width: 40px;
  height: 100%;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--hl-ink);
}
.activity-chart.compact-week {
  gap: 4px;
}
.compact-week .activity-point {
  min-width: 0;
  padding-inline: 0;
}
.compact-week .activity-point small {
  font-size: 11px;
  white-space: nowrap;
}
.compact-week .activity-bar {
  width: min(24px, 80%);
}
.activity-point:disabled {
  opacity: 0.6;
  cursor: default;
}
.activity-bar {
  display: flex;
  flex-direction: column;
  justify-content: end;
  width: 28px;
  flex-shrink: 0;
  background: #7c68ce;
  border-radius: 5px 5px 0 0;
  overflow: hidden;
}
.activity-complete {
  background: #209b7b;
}
.activity-overdue {
  background: #d06562;
}
.chart-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  font-size: 12px;
}
.chart-empty {
  padding: 20px 0;
  margin: 0;
}
.plan-trend > summary,
.chart-section > summary {
  cursor: pointer;
  font-weight: 600;
}
.drilldown {
  scroll-margin-top: 90px;
}
.drilldown:focus {
  outline: 2px solid var(--hl-primary);
  outline-offset: 3px;
}
@media (max-width: 900px) {
  .overview-charts {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
ul {
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-block: 12px;
  border-bottom: 1px solid var(--hl-border, #dce3e7);
}
li > div {
  min-width: 0;
}
li p {
  margin: 5px 0;
  font-size: 14px;
}
li a {
  display: inline-flex;
  align-items: center;
  min-height: 42px;
  color: var(--hl-primary, #1767cf);
  white-space: nowrap;
}
details summary {
  min-height: 40px;
  cursor: pointer;
}
details p {
  overflow-wrap: anywhere;
}
dl {
  display: grid;
  grid-template-columns: minmax(120px, 220px) minmax(0, 1fr);
  gap: 8px 16px;
}
dd {
  margin: 0;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 12px;
}
.error,
.error-state {
  color: var(--hl-danger, #b52d38);
}
.muted {
  color: var(--hl-muted, #5f6b73);
}
@media (max-width: 600px) {
  .dashboard-page {
    padding: 12px;
  }
  .filters label {
    flex: 1 1 140px;
  }
  li {
    flex-direction: column;
    gap: 4px;
  }
  li a {
    white-space: normal;
  }
}
@media (max-width: 900px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 360px) {
  .metric-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (prefers-reduced-motion: reduce) {
  .trend-bar > span {
    transition: none;
  }
}
</style>
