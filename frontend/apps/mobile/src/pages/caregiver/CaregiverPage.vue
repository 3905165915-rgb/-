<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ChevronRight,
  Clock3,
  History,
  RefreshCw,
  SlidersHorizontal,
  X,
  Plus,
} from 'lucide-vue-next'
import { resolveStatus, taskStatusMeta } from '@hulao/shared'
import { useTasks, useElders } from '../../services/data'
import {
  useTaskFilters,
  taskStatusLabels,
} from '../../composables/useTaskFilters'
import FeedbackState from '../../components/FeedbackState.vue'
const tasks = useTasks()
const elders = useElders()
const { filters, filtered, shifts, assignees, sync, reset } = useTaskFilters(
  () => tasks.data.value ?? [],
  () => elders.data.value ?? [],
)
const filterOpen = ref(false)
const limit = ref(30)
const visible = computed(() => filtered.value.slice(0, limit.value))
const pending = computed(() => tasks.isPending.value || elders.isPending.value)
const queryError = computed(() => tasks.error.value || elders.error.value)
const ready = computed(() => !pending.value && !queryError.value)
const elderMap = computed(
  () => new Map(elders.data.value?.map((elder) => [elder.id, elder])),
)
const statistics = computed(() => {
  const rows = tasks.data.value ?? []
  return {
    total: rows.length,
    overdue: rows.filter((task) => task.status === 'overdue').length,
    completed: rows.filter((task) => task.status === 'completed').length,
  }
})
const filterCount = computed(
  () =>
    [
      filters.value.elder,
      filters.value.shift,
      filters.value.assignee,
      filters.value.sort === 'source' ? '' : filters.value.sort,
    ].filter(Boolean).length,
)
const tabs = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
]
function setStatus(tab: { name: string | number }) {
  if (tab.name === 'custom') return
  filters.value.status = String(tab.name)
  sync()
}
function refresh() {
  void tasks.refetch()
  void elders.refetch()
}
watch(filtered, () => {
  limit.value = 30
})
</script>
<template>
  <section class="workbench-page">
    <div class="workbench-heading surface-band">
      <div class="page-title-row">
        <h1>护理工作台</h1>
        <RouterLink to="/tasks/new" class="task-create-link"><Plus :size="18" aria-hidden="true" />新建任务</RouterLink>
        <button
          type="button"
          class="icon-button"
          title="刷新任务与老人"
          aria-label="刷新任务与老人"
          :disabled="tasks.isFetching.value || elders.isFetching.value"
          @click="refresh"
        >
          <RefreshCw
            :size="20"
            :class="{
              'is-spinning': tasks.isFetching.value || elders.isFetching.value,
            }"
            aria-hidden="true"
          />
        </button>
      </div>
      <p class="scope-label">
        已载入任务统计
      </p>
      <dl
        class="work-summary"
        aria-label="已载入任务统计"
      >
        <div>
          <dd>{{ ready ? statistics.total : '—' }}</dd>
          <dt>全部任务</dt>
        </div>
        <div class="summary-danger">
          <dd>{{ ready ? statistics.overdue : '—' }}</dd>
          <dt>已逾期</dt>
        </div>
        <div class="summary-success">
          <dd>{{ ready ? statistics.completed : '—' }}</dd>
          <dt>已完成</dt>
        </div>
      </dl>
      <div class="search-tools">
        <van-search
          v-model="filters.q"
          aria-label="搜索任务、老人或床位"
          placeholder="搜索任务、老人或床位"
          @update:model-value="sync"
        />
        <button
          type="button"
          class="icon-button filter-trigger"
          title="高级筛选"
          aria-label="高级筛选"
          aria-haspopup="dialog"
          :aria-expanded="filterOpen"
          @click="filterOpen = true"
        >
          <SlidersHorizontal
            :size="20"
            aria-hidden="true"
          /><span
            v-if="filterCount"
            class="filter-count"
          >{{ filterCount }}</span>
        </button>
      </div>
      <van-tabs
        :active="
          tabs.some((tab) => tab.value === filters.status)
            ? filters.status
            : 'custom'
        "
        @click-tab="setStatus"
      >
        <van-tab
          v-for="tab in tabs"
          :key="tab.value"
          :name="tab.value"
          :title="tab.label"
        />
        <van-tab
          v-if="!tabs.some((tab) => tab.value === filters.status)"
          name="custom"
          :title="taskStatusLabels[filters.status]"
        />
      </van-tabs>
    </div>
    <div class="list-heading">
      <span role="status">{{
        ready ? '当前 ' + filtered.length + ' 项' : '任务列表'
      }}</span><button
        type="button"
        class="text-button"
        @click="reset"
      >
        重置筛选
      </button>
    </div>
    <FeedbackState
      :loading="pending"
      :error="queryError"
      :empty="ready && !filtered.length"
      :empty-text="statistics.total ? '没有匹配任务，请调整筛选' : '暂无任务'"
      @retry="refresh"
    />
    <div
      v-if="ready && visible.length"
      class="task-list"
    >
      <RouterLink
        v-for="task in visible"
        :key="task.id"
        :to="'/tasks/' + encodeURIComponent(task.id)"
        class="task-row"
        :class="{ 'overdue-task': task.status === 'overdue' }"
      >
        <div class="task-bed">
          <span>床位</span><strong>{{
            elderMap.get(task.elderId)?.bedLabel || '未提供'
          }}</strong>
        </div>
        <div class="task-content">
          <div class="row-person">
            <strong>{{
              elderMap.get(task.elderId)?.name || '老人信息未提供'
            }}</strong><span
              class="status-label"
              :data-tone="resolveStatus(taskStatusMeta, task.status).tone"
            >{{ taskStatusLabels[task.status] }}</span>
          </div>
          <h2>{{ task.title }}</h2>
          <p class="task-deadline">
            <Clock3
              :size="14"
              aria-hidden="true"
            /><span>{{
              task.dueAt || '截止时间未提供'
            }}</span>
          </p>
          <p class="task-assignee">
            {{ task.assignee || '责任人未提供'
            }}<span v-if="task.shift"> · {{ task.shift }}</span>
          </p>
        </div>
        <ChevronRight
          :size="18"
          class="row-arrow"
          aria-hidden="true"
        />
      </RouterLink>
    </div>
    <van-button
      v-if="ready && visible.length < filtered.length"
      block
      plain
      icon="arrow-down"
      class="mobile-action"
      @click="limit += 30"
    >
      显示更多
    </van-button>
    <RouterLink
      to="/timeline"
      class="secondary-link"
    >
      <History
        :size="17"
        aria-hidden="true"
      />过程回放<ChevronRight
        :size="16"
        aria-hidden="true"
      />
    </RouterLink>
    <van-popup
      v-model:show="filterOpen"
      position="bottom"
      class="mobile-sheet hl-glass"
      aria-label="筛选任务"
      close-on-popstate
    >
      <header class="sheet-heading">
        <h2>筛选任务</h2>
        <button
          type="button"
          class="icon-button"
          title="关闭筛选"
          aria-label="关闭筛选"
          @click="filterOpen = false"
        >
          <X
            :size="20"
            aria-hidden="true"
          />
        </button>
      </header>
      <div class="sheet-body">
        <div class="filter-grid">
          <label class="select-field">老人<select
            v-model="filters.elder"
            aria-label="老人"
            @change="sync"
          >
            <option value="">全部老人</option>
            <option
              v-for="item in elders.data.value"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }} · {{ item.bedLabel }}
            </option>
          </select></label>
          <label class="select-field">班次<select
            v-model="filters.shift"
            aria-label="班次"
            @change="sync"
          >
            <option value="">全部班次</option>
            <option
              v-for="item in shifts"
              :key="item"
            >{{ item }}</option>
          </select></label>
          <label class="select-field">责任人<select
            v-model="filters.assignee"
            aria-label="责任人"
            @change="sync"
          >
            <option value="">全部责任人</option>
            <option
              v-for="item in assignees"
              :key="item"
            >{{ item }}</option>
          </select></label>
          <label class="select-field">状态<select
            v-model="filters.status"
            aria-label="状态"
            @change="sync"
          >
            <option value="">全部状态</option>
            <option
              v-for="(label, key) in taskStatusLabels"
              :key="key"
              :value="key"
            >
              {{ label }}
            </option>
          </select></label>
        </div>
        <label class="select-field">排序<select
          v-model="filters.sort"
          aria-label="排序"
          @change="sync"
        >
          <option value="source">原始顺序</option>
          <option value="due_asc">截止时间从早到晚</option>
          <option value="due_desc">截止时间从晚到早</option>
        </select></label>
      </div>
      <footer class="sheet-footer">
        <van-button
          plain
          icon="replay"
          aria-label="重置"
          @click="reset"
        >
          重置
        </van-button><van-button
          type="primary"
          @click="filterOpen = false"
        >
          显示任务
        </van-button>
      </footer>
    </van-popup>
  </section>
</template>
<style scoped>
.task-create-link { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; font-size: 14px; color: #1767cf; white-space: nowrap; }
</style>
