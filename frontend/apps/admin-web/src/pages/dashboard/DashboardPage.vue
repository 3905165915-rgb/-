<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { readSession } from '@hulao/shared'
import { request, listAll } from '../../../../../packages/shared/src/workflow/model'
import { RefreshCw } from 'lucide-vue-next'
import { mode, session } from '../../services/data'
import DemoDashboard from './DemoDashboard.vue'
import {
  buildBreakdown, chartGroups, createRequestGuard, defaultWindow, formatTime,
  metricLabels, mismatches, validateMetrics, validateWindow,
  type Breakdown, type Metrics, type MetricKey,
} from './dashboard'

const initial = defaultWindow()
const start = ref(initial.start), end = ref(initial.end)
const pending = ref(false), error = ref(''), detailError = ref(''), rangeError = ref('')
const metrics = shallowRef<Metrics | null>(null)
const breakdown = shallowRef<Breakdown | null>(null)
const selected = ref<MetricKey>('plan'), page = ref(1)
const pageSize = 20
let disposed = false
function currentScope(): string | null {
  const current = readSession()
  if (mode !== 'api' || current?.mode !== 'api' || !current.accessToken || !['admin', 'supervisor'].includes(current.role || '')) return null
  return JSON.stringify([current.accountKey, current.userId, current.role, current.accessToken])
}
const guard = createRequestGuard(currentScope)
const owner = ref<string | null>(null)
// Also re-read tab credentials at commit time, including token changes for the same account.
const visible = computed(() => Boolean(session.value && owner.value && owner.value === currentScope()))
const shownMetrics = computed(() => visible.value ? metrics.value : null)
const groups = computed(() => shownMetrics.value ? chartGroups(shownMetrics.value) : [])
const selectedMetric = computed(() => groups.value.flatMap((g) => g.items).find((m) => m.key === selected.value))
const selectedGroup = computed(() => groups.value.find((g) => g.items.some((m) => m.key === selected.value)))
const selectedRows = computed(() => visible.value ? breakdown.value?.[selected.value] ?? [] : [])
const displayedRows = computed(() => selectedRows.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const discrepancies = computed(() => shownMetrics.value && breakdown.value ? mismatches(shownMetrics.value, breakdown.value) : [])
const discrepancyText = computed(() => discrepancies.value.map((m) => `${m.label}（服务器 ${m.count} / 可见 ${breakdown.value?.[m.key].length}）`).join('；'))
watch(selected, () => { page.value = 1 })
function choose(key: MetricKey) { selected.value = key; page.value = 1 }
function message(reason: unknown): string { return reason instanceof Error ? reason.message : '加载失败，请重试。' }
async function refresh() {
  if (mode !== 'api' || disposed) return
  const window = { start: start.value, end: end.value }
  rangeError.value = validateWindow(window) || ''
  if (rangeError.value) return
  const accepts = guard.begin()
  metrics.value = null; breakdown.value = null; error.value = ''; detailError.value = ''; page.value = 1
  owner.value = currentScope()
  if (!owner.value) { error.value = '请使用主管或管理员服务器账号登录。'; pending.value = false; return }
  pending.value = true
  const [summary, sources] = await Promise.allSettled([
    request('/reports/metrics?' + new URLSearchParams(window)),
    Promise.all([listAll('/tasks'), listAll('/handovers'), listAll('/incidents'), listAll('/family/cases?kind=feedback')]),
  ])
  if (disposed) return
  if (!accepts()) { if (owner.value !== currentScope()) clear(); return }
  pending.value = false
  if (summary.status === 'rejected') { error.value = message(summary.reason); return }
  try { metrics.value = validateMetrics(summary.value, window) }
  catch (reason) { error.value = message(reason); return }
  if (sources.status === 'rejected') { detailError.value = message(sources.reason); return }
  try {
    const [tasks, handovers, incidents, feedback] = sources.value
    breakdown.value = buildBreakdown(metrics.value, { tasks, handovers, incidents, feedback })
  } catch (reason) { detailError.value = message(reason) }
}
function clear() {
  guard.invalidate()
  metrics.value = null; breakdown.value = null; owner.value = null; pending.value = false
  error.value = ''; detailError.value = ''
}
function checkSession() { if (owner.value !== currentScope()) clear() }
watch(session, () => {
  clear()
  if (currentScope()) void refresh()
}, { immediate: true, flush: 'sync' })
onMounted(() => {
  window.addEventListener('focus', checkSession)
  window.addEventListener('storage', checkSession)
  window.addEventListener('hulao:unauthorized', clear)
})
onBeforeUnmount(() => {
  disposed = true; guard.invalidate()
  window.removeEventListener('focus', checkSession)
  window.removeEventListener('storage', checkSession)
  window.removeEventListener('hulao:unauthorized', clear)
})
function barWidth(count: number, counts: number[]) {
  const max = Math.max(...counts)
  return max ? `${count / max * 100}%` : '0%'
}
const statusLabels: Record<string, string> = {
  completed: '已完成', cancelled: '已取消', not_done: '登记未完成', pending: '待处理', overdue: '逾期',
  received: '已接收', clarifying: '澄清中', submitted: '已提交', closed: '已关闭', open: '处理中',
  reported: '已上报', rectifying: '整改中', pending_review: '待复查', assigned: '已指派',
  awaiting_review: '待复查',
}
</script>

<template>
  <DemoDashboard v-if="mode === 'demo'" />
  <section v-else class="management-dashboard" aria-labelledby="dashboard-title" :aria-busy="pending">
    <div class="page-title-row">
      <div><h1 id="dashboard-title">管理看板</h1><p class="intro">按业务批次核对当前状态与来源对象</p></div>
      <el-button aria-label="刷新全部看板数据" :loading="pending" @click="refresh">
        <RefreshCw :size="16" aria-hidden="true" />刷新全部
      </el-button>
    </div>
    <form class="window-controls" @submit.prevent="refresh">
      <label for="dashboard-start">开始日期（含）<input id="dashboard-start" v-model="start" type="date" required aria-describedby="window-help window-error" /></label>
      <label for="dashboard-end">结束日期（不含）<input id="dashboard-end" v-model="end" type="date" required aria-describedby="window-help window-error" /></label>
      <el-button native-type="submit" type="primary" :loading="pending">应用统计窗口</el-button>
      <p id="window-help">北京时间 Asia/Shanghai · 1–366 天。例如 25 日至 26 日仅统计 25 日。修改日期后需应用。</p>
      <p v-if="rangeError" id="window-error" class="error" role="alert">{{ rangeError }}</p>
    </form>
    <p v-if="pending" role="status">正在刷新全部汇总和授权来源，完成后统一显示…</p>
    <div v-if="error" class="error-feedback" role="alert"><p>{{ error }}</p><el-button @click="refresh">重试全部数据</el-button></div>
    <template v-if="shownMetrics">
      <div class="snapshot-meta">
        <p><strong>服务器快照</strong> {{ formatTime(shownMetrics.as_of) }}（{{ shownMetrics.timezone }}）</p>
        <p>实际窗口：[{{ formatTime(shownMetrics.window.start_inclusive) }}，{{ formatTime(shownMetrics.window.end_exclusive) }}）</p>
        <p>{{ shownMetrics.interpretation }}</p>
      </div>
      <p class="chart-help">点击或用键盘选择任一条形查看来源；条长仅在本组内按数量比较，各行可能重叠，不可相加。悬停或聚焦可查看数值。</p>
      <div class="chart-grid">
        <section v-for="(group, index) in groups" :key="group.title" class="aggregate-section" :aria-labelledby="`chart-title-${index}`">
          <h2 :id="`chart-title-${index}`">{{ group.title }}</h2>
          <p class="chart-summary">{{ group.summary }}</p>
          <div class="bars">
            <button v-for="item in group.items" :key="item.key" type="button" class="bar-button"
              :class="{ selected: selected === item.key }" :aria-pressed="selected === item.key" aria-controls="dashboard-drilldown"
              :aria-label="`${item.label}：${item.count}；查看授权明细`" :title="`${item.label}：${item.count}；${group.definition}`"
              @click="choose(item.key)">
              <span class="bar-label">{{ item.label }}</span><strong>{{ item.count }}</strong>
              <span class="bar-track" aria-hidden="true"><span :style="{ width: barWidth(item.count, group.items.map((i) => i.count)) }" /></span>
              <span class="focus-tooltip">{{ item.label }}：{{ item.count }}</span>
            </button>
          </div>
          <p class="definition">{{ group.definition }}</p>
        </section>
      </div>
      <p class="unavailable">暂未提供：日期趋势、类别分布、环比、记忆和简报统计。当前接口未提供这些维度，不能据此推算。</p>
      <section id="dashboard-drilldown" class="drilldown" aria-labelledby="drilldown-title">
        <h2 id="drilldown-title">{{ metricLabels[selected] }} · 来源核对</h2>
        <p>{{ selectedGroup?.definition }}</p>
        <p>汇总与授权列表分别读取，未共享服务器事务快照；数量一致也不代表对象状态在读取期间完全未变。</p>
        <div v-if="detailError" class="error-feedback" role="alert"><p>来源明细不可用：{{ detailError }}</p><el-button @click="refresh">重新核对全部数据</el-button></div>
        <template v-else-if="breakdown">
          <p v-if="discrepancies.length" role="alert" class="mismatch">
            汇总与可见来源存在差异：{{ discrepancyText }}。
            可能是权限范围、分页期间变更或快照时间不同。以下仅列出实际可见对象，不能视为完整服务器明细。
            <el-button @click="refresh">刷新并重新核对</el-button>
          </p>
          <p class="counts" aria-live="polite">服务器 {{ selectedMetric?.count }} · 可见同口径对象 {{ selectedRows.length }}</p>
          <p v-if="!selectedRows.length">当前可见来源无符合该口径的对象。</p>
          <ul v-else class="source-list">
            <li v-for="row in displayedRows" :key="row.id">
              <div class="source-heading"><strong>{{ row.id }}</strong><span>{{ statusLabels[row.status] || '状态待核实' }}</span></div>
              <p>老人编号：{{ row.elder }} · {{ formatTime(row.at) }}</p>
              <p v-if="row.note">{{ row.note }}</p>
              <RouterLink :to="row.to">{{ selected === 'feedback' || selected === 'replied' ? '打开家属沟通列表' : '查看来源对象' }}<span class="sr-only"> {{ row.id }}</span></RouterLink>
              <details v-if="selected === 'feedback' || selected === 'replied'"><summary>查看该反馈原文</summary><p>{{ row.source.subject || '未提供主题' }}</p><p>{{ row.source.content || row.source.description || row.source.text || '未提供正文' }}</p><p>回复：{{ row.source.reply || '未提供' }}</p></details>
            </li>
          </ul>
          <nav v-if="selectedRows.length > pageSize" class="pagination" aria-label="来源明细分页">
            <el-button :disabled="page === 1" @click="page--">上一页</el-button>
            <span aria-live="polite">{{ page }} / {{ Math.ceil(selectedRows.length / pageSize) }}</span>
            <el-button :disabled="page * pageSize >= selectedRows.length" @click="page++">下一页</el-button>
          </nav>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.management-dashboard { min-width: 0; color: #24364a; overflow-wrap: anywhere; }
h1 { margin-bottom: 4px; }
.intro { margin: 0; color: #4e6072; }
.window-controls { display: flex; flex-wrap: wrap; gap: 14px; align-items: end; padding: 18px 0; border-bottom: 1px solid #bac8d6; }
.window-controls label { display: grid; gap: 6px; font-weight: 600; }
.window-controls input { min-height: 42px; max-width: 100%; padding: 8px 10px; border: 1px solid #8295aa; border-radius: 6px; color: #24364a; background: #fff; font: inherit; }
.window-controls p { flex-basis: 100%; margin: 0; font-size: 13px; }
.snapshot-meta { padding: 14px 0; }
.snapshot-meta p { margin: 6px 0; }
.chart-help, .definition, .unavailable { color: #4b5c70; font-size: 13px; line-height: 1.65; }
.chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.aggregate-section { padding: 20px; border: 1px solid #c4d0dc; border-radius: 12px; background: rgba(255,255,255,.86); box-shadow: 0 5px 18px rgba(32,54,78,.04); min-width: 0; }
.aggregate-section h2, .drilldown h2 { font-size: 18px; margin: 0 0 8px; color: #20334b; }
.chart-summary { line-height: 1.6; margin: 0 0 16px; }
.bars { display: grid; gap: 5px; }
.bar-button { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; width: 100%; min-height: 52px; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 5px; color: #233952; background: transparent; cursor: pointer; font: inherit; }
.bar-button strong { font-variant-numeric: tabular-nums; }
.bar-track { grid-column: 1 / -1; height: 8px; background: #e4eaf0; border-radius: 4px; overflow: hidden; }
.bar-track > span { display: block; height: 100%; border-radius: 4px; background: #256488; }
.bar-button:hover, .bar-button.selected { border-color: #437294; background: #edf4f9; }
.bar-button:active { background: #dae9f4; }
.bar-button:focus-visible, a:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #124b79; outline-offset: 3px; }
.focus-tooltip { display: none; position: absolute; z-index: 2; bottom: 100%; left: 0; padding: 6px 10px; border-radius: 4px; color: #fff; background: #20334b; pointer-events: none; }
.bar-button:focus-visible .focus-tooltip { display: block; }
.definition { margin-bottom: 0; }
.drilldown { margin-top: 22px; padding-top: 20px; border-top: 1px solid #b6c7d6; }
.drilldown > p { line-height: 1.65; }
.counts { font-weight: 700; }
.source-list { list-style: none; padding: 0; margin: 0; }
.source-list li { padding: 16px 0; border-bottom: 1px solid #c4d0dc; }
.source-heading { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; }
.source-list p { margin: 7px 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
.source-list a { display: inline-block; padding: 10px 0; color: #155a8b; text-decoration: underline; }
.source-list summary { padding: 8px 0; cursor: pointer; }
.pagination { display: flex; gap: 16px; align-items: center; justify-content: center; padding: 20px 0; }
.error, .error-feedback { color: #9d2525; }
.error-feedback, .mismatch { padding: 12px; border-left: 4px solid #9d481d; background: #fff4e6; color: #733713; line-height: 1.7; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 700px) { .chart-grid { grid-template-columns: minmax(0, 1fr); } .window-controls label { width: 100%; } .aggregate-section { padding: 14px; } }
@media (prefers-reduced-transparency: reduce) { .aggregate-section { background: #fff; box-shadow: none; } }
@media (prefers-reduced-motion: reduce) { .management-dashboard :deep(*) { transition: none !important; animation: none !important; } }
</style>
