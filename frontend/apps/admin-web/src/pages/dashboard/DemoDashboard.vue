<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { loadDemoState } from '@hulao/shared'
import { RefreshCw } from 'lucide-vue-next'
import { mode, queryKey, session } from '../../services/data'
import {
  buildDemoMetrics,
  demoMetricLabels,
  demoTime,
  type DemoMetricKey,
} from '../../../../../packages/shared/src/demo-metrics'
import QueryFeedback from '../../components/QueryFeedback.vue'
import StatusLabel from '../../components/StatusLabel.vue'

const demo = useQuery({
  queryKey: computed(() => queryKey('demo-preview')),
  enabled: computed(
    () =>
      mode === 'demo' &&
      session.value?.mode === 'demo' &&
      ['admin', 'supervisor'].includes(session.value?.role ?? ''),
  ),
  queryFn: async () => ({
    state: await loadDemoState(),
    capturedAt: Date.now(),
  }),
})
// Cards, trend and details always share one successful snapshot.
const snapshot = computed(() =>
  !demo.error.value ? demo.data.value : undefined,
)
const elderId = ref('')
watch(
  () => snapshot.value?.state.elders,
  (elders) => {
    if (elders && !elders.some((elder) => elder.id === elderId.value))
      elderId.value = elders[0]?.id ?? ''
  },
  { immediate: true },
)
const elder = computed(() =>
  snapshot.value?.state.elders.find((item) => item.id === elderId.value),
)
const metrics = computed(() =>
  buildDemoMetrics(
    snapshot.value?.state,
    elderId.value,
    snapshot.value?.capturedAt,
  ),
)
const selection = ref<{ day: string; metric: DemoMetricKey } | null>(null)
const selectedDay = computed(
  () =>
    metrics.value?.trend.find((day) => day.day === selection.value?.day) ??
    metrics.value?.today,
)
const selectedMetric = computed(() => selection.value?.metric ?? 'scheduled')
const detailRows = computed(
  () => selectedDay.value?.groups[selectedMetric.value] ?? [],
)
watch(elderId, () => {
  selection.value = null
})
const metricKeys = Object.keys(demoMetricLabels) as DemoMetricKey[]
const sources: Record<string, string> = {
  plan: '照护计划',
  record: '护理记录',
  manual: '手工安排',
  demo: '演示安排',
}
</script>
<template>
  <section class="demo-dashboard">
    <div class="page-title-row">
      <h1>{{ session?.role === 'supervisor' ? '照护主管工作台' : '机构管理工作台' }}</h1>
      <el-button
        class="icon-button"
        title="刷新工作台"
        aria-label="刷新工作台"
        :loading="demo.isFetching.value"
        @click="demo.refetch()"
      >
        <RefreshCw
          :size="18"
          aria-hidden="true"
        />
      </el-button>
    </div>
    <p role="status">
      虚构演示数据 · 统计、趋势与明细来自同一次演示快照。
    </p>
    <QueryFeedback
      :loading="demo.isPending.value"
      :error="demo.error.value"
      @retry="demo.refetch()"
    />
    <label class="elder-picker">统计老人
      <select
        v-model="elderId"
        :disabled="!snapshot"
      >
        <option
          v-if="!snapshot?.state.elders.length"
          value=""
        >
          老人未提供
        </option>
        <option
          v-for="item in snapshot?.state.elders"
          :key="item.id"
          :value="item.id"
        >
          {{ item.name }} · {{ item.bedLabel }}
        </option>
      </select>
    </label>
    <p
      v-if="snapshot"
      class="snapshot-note"
    >
      {{ elder?.name || '老人未提供' }} · 北京日期
      {{ metrics?.day || '未提供' }} · 快照版本 {{ snapshot.state.revision }} ·
      {{ demoTime(new Date(snapshot.capturedAt).toISOString()) }}
    </p>
    <div
      class="demo-metrics"
      aria-label="今日任务统计"
    >
      <button
        v-for="key in metricKeys"
        :key="key"
        type="button"
        class="demo-metric"
        :disabled="!metrics"
        :aria-pressed="
          selectedDay?.day === metrics?.day && selectedMetric === key
        "
        @click="selection = metrics ? { day: metrics.day, metric: key } : null"
      >
        <strong>{{ metrics?.today.counts[key] ?? '—' }}</strong><span>今日{{ demoMetricLabels[key] }}</span><small>查看统计依据</small>
      </button>
      <RouterLink
        class="demo-metric"
        to="/notifications"
      >
        <strong>{{ metrics?.reviewCount ?? '未提供' }}</strong><span>待复查</span><small>查看通知与复查</small>
      </RouterLink>
    </div>
    <p class="muted">
      按任务执行日期汇总；已取消不计入应执行。待处理含待处理、进行中、已转交与已逾期；未执行仅计明确标记的任务。未知值显示“—”。
    </p>
    <p
      v-if="metrics?.undated.length"
      role="status"
    >
      {{
        metrics.undated.length
      }}
      条任务执行日期待核实，完整统计暂未提供，下方保留已知任务依据。
    </p>
    <section
      class="demo-section"
      aria-labelledby="demo-trend-title"
    >
      <h2 id="demo-trend-title">
        近 7 天任务趋势
      </h2>
      <p class="muted">
        按真实任务日期汇总当前状态，点击数字核对任务；历史空日表示该快照无对应任务。
      </p>
      <div
        class="trend-head"
        aria-hidden="true"
      >
        <span>日期</span><span
          v-for="key in metricKeys"
          :key="key"
        >{{
          demoMetricLabels[key]
        }}</span>
      </div>
      <div
        v-for="day in metrics?.trend"
        :key="day.day"
        class="trend-row"
      >
        <time :datetime="day.day">{{ day.day.slice(5) }}</time>
        <button
          v-for="key in metricKeys"
          :key="key"
          type="button"
          :aria-label="
            day.day +
              ' ' +
              demoMetricLabels[key] +
              ' ' +
              (day.counts[key] ?? '未知') +
              '，查看任务依据'
          "
          :aria-pressed="selectedDay?.day === day.day && selectedMetric === key"
          @click="selection = { day: day.day, metric: key }"
        >
          {{ day.counts[key] ?? '—' }}
        </button>
      </div>
      <p v-if="!metrics">
        任务趋势未提供。
      </p>
    </section>
    <section
      class="demo-section"
      aria-labelledby="demo-detail-title"
    >
      <h2 id="demo-detail-title">
        {{ selectedDay?.day || '日期未提供' }} ·
        {{ demoMetricLabels[selectedMetric] }}依据
      </h2>
      <p
        v-if="metrics"
        role="status"
      >
        {{ elder?.name }} · 已知任务 {{ detailRows.length }} 条<span
          v-if="selectedDay?.counts[selectedMetric] === null"
        >，完整数量待核实</span>
      </p>
      <p v-if="!detailRows.length">
        {{ metrics ? '当前快照无匹配的已知任务。' : '任务依据未提供。' }}
      </p>
      <article
        v-for="task in detailRows"
        :key="task.id"
        class="task-evidence"
      >
        <h3>{{ task.title }}</h3>
        <StatusLabel :status="task.status" />
        <p>
          {{ elder?.name }} · {{ task.bedSnapshot || '床位快照未提供' }} ·
          {{ task.shiftName || task.shift || '班次未提供' }} ·
          {{ task.assignee || '责任人未提供' }}
        </p>
        <p>
          执行：{{ demoTime(task.executionAt) }}<br>截止：{{
            demoTime(task.deadlineAt || task.dueAt)
          }}
        </p>
        <p>
          来源：{{ sources[task.source ?? ''] || '未提供' }} · 任务编号：{{
            task.id
          }}
        </p>
        <p v-if="task.result">
          结果 / 原因：{{ task.result }}
        </p>
        <div class="evidence-actions">
          <RouterLink
            :to="{ path: '/tasks', query: { task: task.id, elder: elderId } }"
          >
            查看 / 办理任务
          </RouterLink>
          <RouterLink
            v-if="task.itemId"
            :to="'/timeline/' + encodeURIComponent(task.itemId)"
          >
            事项回放
          </RouterLink>
        </div>
      </article>
      <details v-if="metrics?.undated.length">
        <summary>执行日期待核实的任务</summary>
        <p
          v-for="task in metrics.undated"
          :key="task.id"
        >
          <RouterLink
            :to="{ path: '/tasks', query: { task: task.id, elder: elderId } }"
          >
            {{ task.title }}
          </RouterLink>
          · {{ task.id }}
        </p>
      </details>
    </section>
    <section
      class="demo-section"
      aria-labelledby="demo-review-title"
    >
      <h2 id="demo-review-title">
        待复查依据
      </h2>
      <p class="muted">
        仅统计当前老人待提交与待审核的记忆复查；关闭项不计入。
      </p>
      <p v-if="metrics?.reviewCount === null || !metrics">
        复查数据未提供。
      </p>
      <p v-else-if="!metrics.openReviews?.length">
        当前老人无待复查事项。
      </p>
      <article
        v-for="review in metrics?.openReviews"
        :key="review.id"
        class="task-evidence"
      >
        <h3>{{ review.description }}</h3>
        <p>
          {{ review.status === 'pending' ? '待提交' : '待审核' }} · 版本
          {{ review.revision }}
        </p>
        <p>复查编号：{{ review.id }} · 记忆编号：{{ review.memoryId }}</p>
        <div class="evidence-actions">
          <RouterLink to="/notifications">
            处理复查通知
          </RouterLink>
          <RouterLink
            v-if="review.itemId"
            :to="'/timeline/' + encodeURIComponent(review.itemId)"
          >
            事项回放
          </RouterLink>
        </div>
      </article>
    </section>
    <div class="dashboard-notices">
      <h2>演示提醒</h2>
      <el-alert
        v-for="notice in snapshot?.state.notifications"
        :key="notice"
        :title="notice"
        type="info"
        :closable="false"
      />
      <el-button @click="$router.push('/demo')">
        演示数据管理
      </el-button>
    </div>
  </section>
</template>
<style scoped>
.demo-dashboard {
  min-width: 0;
  overflow-wrap: anywhere;
}
.elder-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.elder-picker select {
  max-width: 100%;
  min-height: 40px;
  padding: 6px;
  border: 1px solid var(--hl-border, #dce1e8);
  border-radius: 6px;
  background: white;
  color: inherit;
}
.snapshot-note {
  font-size: 13px;
}
.demo-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
.demo-metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 10px;
  min-width: 0;
  border: 1px solid var(--hl-border, #dce1e8);
  border-radius: 10px;
  color: inherit;
  background: white;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  font: inherit;
}
.demo-metric strong {
  font-size: 26px;
}
.demo-metric small {
  font-size: 12px;
  color: #52657b;
}
[aria-pressed='true'] {
  background: #edf4ff;
  border-color: #1767cf;
}
.demo-section {
  margin: 24px 0;
}
.trend-head,
.trend-row {
  display: grid;
  grid-template-columns: 50px repeat(4, minmax(0, 1fr));
  align-items: center;
  gap: 3px;
  text-align: center;
  font-size: 13px;
}
.trend-row {
  border-bottom: 1px solid var(--hl-border, #dce1e8);
}
.trend-row button {
  min-height: 44px;
  min-width: 0;
  color: inherit;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.trend-row button[aria-pressed='true'] {
  background: #edf4ff;
  border-color: #1767cf;
}
.task-evidence {
  padding: 14px 0;
  border-bottom: 1px solid var(--hl-border, #dce1e8);
}
.task-evidence h3 {
  margin: 0 0 8px;
}
.evidence-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
button:focus-visible,
a:focus-visible,
select:focus-visible {
  outline: 2px solid #1767cf;
  outline-offset: 2px;
}
@media (max-width: 360px) {
  .demo-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
