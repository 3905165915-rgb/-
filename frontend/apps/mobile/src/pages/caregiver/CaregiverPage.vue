<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronRight,
  Clock3,
  History,
  RefreshCw,
  SlidersHorizontal,
  X,
  Plus,
  ShieldAlert,
} from 'lucide-vue-next'
import {
  formatBusinessTime,
  resolveStatus,
  taskStatusMeta,
} from '@hulao/shared'
import { mode, useCareWorklist, useTasks, useElders } from '../../services/data'
import {
  useTaskFilters,
  taskStatusLabels,
} from '../../composables/useTaskFilters'
import FeedbackState from '../../components/FeedbackState.vue'
import { elderWorkbench } from './elder-workbench'
import { taskPrimaryLabel, taskTime } from '../../composables/task-presentation'
const tasks = useTasks()
const elders = useElders()
const worklist = useCareWorklist()
const route = useRoute()
const router = useRouter()
const { filters, filtered, shifts, assignees, sync, reset } = useTaskFilters(
  () => tasks.data.value ?? [],
  () => elders.data.value ?? [],
)
const filterOpen = ref(false)
const limit = ref(30)
const elderLimit = ref(12)
const elderCards = computed(() => {
  if (!ready.value) return []
  if (mode === 'demo')
    return elderWorkbench(elders.data.value ?? [], tasks.data.value ?? []).map(
      (card) => ({ ...card, scopeReasons: [] as string[] }),
    )
  const byId = new Map(
    (elders.data.value ?? []).map((elder) => [elder.id, elder]),
  )
  return (worklist.data.value?.items ?? []).map((item) => ({
    elder: byId.get(item.elder.id) ?? {
      id: item.elder.id,
      name: item.elder.name,
      bedLabel: '床位信息未提供',
      status: item.elder.status,
      notes: undefined,
      lastUpdate: undefined,
    },
    tasks: item.open_tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
    })),
    pending: item.pending_count,
    inProgress: item.open_tasks.filter((task) => task.status === 'in_progress')
      .length,
    overdue: item.overdue_count,
    scopeReasons: item.scope_reasons,
  }))
})
const scopeReasonLabels: Record<string, string> = {
  explicit_assignment: '明确分配',
  temporary_support: '临时支援',
  explicit_task_assignment: '明确任务分配',
  open_shift_membership: '开放班次待办',
  management_access: '管理范围',
}
const visible = computed(() => filtered.value.slice(0, limit.value))
const pending = computed(
  () =>
    tasks.isPending.value ||
    elders.isPending.value ||
    (mode === 'api' && worklist.isPending.value),
)
const queryError = computed(
  () =>
    tasks.error.value ||
    elders.error.value ||
    (mode === 'api' ? worklist.error.value : null),
)
const ready = computed(() => !pending.value && !queryError.value)
const elderMap = computed(
  () => new Map(elders.data.value?.map((elder) => [elder.id, elder])),
)
const selectedElder = computed(() => {
  const elderId = filters.value.elder
  return elderId ? elderMap.value.get(elderId) : undefined
})
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
  if (mode === 'api') void worklist.refetch()
}
async function scrollToTasks() {
  await nextTick()
  const heading = document.getElementById('care-task-list')
  heading?.focus({ preventScroll: true })
  heading?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth',
    block: 'start',
  })
}
async function focusElderTasks(elderId: string) {
  // The shortcut means all tasks for this elder, regardless of earlier filters.
  await router.push({ path: '/caregiver', query: { elder: elderId } })
  await scrollToTasks()
}
watch(filtered, () => {
  limit.value = 30
})
watch(
  [() => route.query.elder, ready],
  () => {
    if (route.query.elder && ready.value) void scrollToTasks()
  },
  { immediate: true },
)
</script>
<template>
  <section class="workbench-page">
    <div class="workbench-heading surface-band">
      <div class="page-title-row">
        <h1>护理工作台</h1>
        <RouterLink to="/tasks/new" class="task-create-link"
          ><Plus :size="18" aria-hidden="true" />新建任务</RouterLink
        >
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
      <RouterLink
        :to="{ path: '/safety', query: { report: '1' } }"
        class="workbench-safety-link"
      >
        <ShieldAlert :size="18" aria-hidden="true" />照护安全与事件上报
        <ChevronRight :size="18" aria-hidden="true" />
      </RouterLink>
      <p class="scope-label">已载入任务统计</p>
      <dl class="work-summary" aria-label="已载入任务统计">
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
      <section class="elder-workbench" aria-labelledby="workbench-elders-title">
        <h2 id="workbench-elders-title">先看老人</h2>
        <p class="scope-label">
          {{
            mode === 'api'
              ? worklist.data.value?.scope_rule || '照护范围由服务器核定。'
              : '今天需要照护的老人和待办都在这里。'
          }}
          任务筛选仅影响下方列表。
        </p>
        <FeedbackState
          :loading="pending"
          :error="queryError"
          :empty="ready && !elderCards.length"
          :empty-text="
            mode === 'api'
              ? '当前没有授权照护的老人，请联系主管安排照护范围。'
              : '暂无已载入任务关联的老人'
          "
          @retry="refresh"
        />
        <ul
          v-if="ready && elderCards.length"
          class="elder-card-list"
          aria-label="任务关联老人"
        >
          <li
            v-for="card in elderCards.slice(0, elderLimit)"
            :key="card.elder.id"
            class="elder-work-card"
          >
            <RouterLink
              :to="'/elders/' + encodeURIComponent(card.elder.id)"
              class="elder-card-title"
            >
              <strong>{{ card.elder.name || '姓名未提供' }}</strong>
              <span>{{ card.elder.bedLabel || '床位未提供' }}</span>
              <ChevronRight :size="18" aria-hidden="true" />
            </RouterLink>
            <p class="elder-card-counts">
              待处理 {{ card.pending }} · 进行中 {{ card.inProgress }} ·
              <span :class="{ 'elder-card-overdue': card.overdue }"
                >已逾期 {{ card.overdue }}</span
              >
            </p>
            <p v-if="card.scopeReasons.length" class="scope-label">
              范围依据：{{
                card.scopeReasons
                  .map((reason) => scopeReasonLabels[reason] || '其他授权范围')
                  .join('、')
              }}
            </p>
            <p v-if="card.elder.notes?.trim()" class="elder-card-note">
              档案注意事项：{{ card.elder.notes }}
            </p>
            <p v-if="card.elder.lastUpdate?.trim()" class="scope-label">
              档案最近更新：{{ formatBusinessTime(card.elder.lastUpdate) }}
            </p>
            <ul class="elder-card-tasks" aria-label="关联任务预览">
              <li v-for="task in card.tasks.slice(0, 2)" :key="task.id">
                <RouterLink :to="'/tasks/' + encodeURIComponent(task.id)">
                  {{ task.title }} ·
                  {{ taskStatusLabels[task.status] || '未知状态' }}
                </RouterLink>
              </li>
            </ul>
            <nav
              class="elder-card-actions"
              :aria-label="card.elder.name + '的快捷操作'"
            >
              <RouterLink
                :to="{ path: '/records/new', query: { elder: card.elder.id } }"
                >记一条</RouterLink
              >
              <RouterLink
                :to="{ path: '/tasks/new', query: { elder: card.elder.id } }"
                >新建任务</RouterLink
              >
              <button
                type="button"
                :aria-label="`查看${card.elder.name || '该老人'}的相关任务`"
                :aria-pressed="filters.elder === card.elder.id"
                @click="focusElderTasks(card.elder.id)"
              >
                相关任务
              </button>
              <RouterLink :to="'/elders/' + encodeURIComponent(card.elder.id)"
                >档案与动态</RouterLink
              >
            </nav>
          </li>
        </ul>
        <button
          v-if="ready && elderCards.length > elderLimit"
          type="button"
          class="text-button"
          @click="elderLimit += 12"
        >
          显示更多老人
        </button>
      </section>
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
          <SlidersHorizontal :size="20" aria-hidden="true" /><span
            v-if="filterCount"
            class="filter-count"
            >{{ filterCount }}</span
          >
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
    <div id="care-task-list" class="list-heading" tabindex="-1">
      <span role="status">{{
        ready && selectedElder
          ? `${selectedElder.name}的相关任务 · 当前 ${filtered.length} 项`
          : ready
            ? '当前 ' + filtered.length + ' 项'
            : '任务列表'
      }}</span
      ><button type="button" class="text-button" @click="reset">
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
    <div v-if="ready && visible.length" class="task-list">
      <RouterLink
        v-for="task in visible"
        :key="task.id"
        :to="'/tasks/' + encodeURIComponent(task.id)"
        class="task-row"
        :class="{ 'overdue-task': task.status === 'overdue' }"
      >
        <div class="task-bed">
          <span>床位</span
          ><strong>{{
            task.bedSnapshot || elderMap.get(task.elderId)?.bedLabel || '未提供'
          }}</strong>
        </div>
        <div class="task-content">
          <div class="row-person">
            <strong>{{
              task.nameSnapshot ||
              elderMap.get(task.elderId)?.name ||
              '老人信息未提供'
            }}</strong
            ><span
              class="status-label"
              :data-tone="resolveStatus(taskStatusMeta, task.status).tone"
              >{{ taskStatusLabels[task.status] }}</span
            >
          </div>
          <h2>{{ task.title }}</h2>
          <p class="task-deadline">执行：{{ taskTime(task.executionAt) }}</p>
          <p class="task-deadline">
            <Clock3 :size="14" aria-hidden="true" /><span>{{
              '截止：' + taskTime(task.deadlineAt || task.dueAt)
            }}</span>
          </p>
          <p class="task-assignee">
            {{
              task.assigneeName ||
              (mode === 'demo' ? task.assignee : '') ||
              '责任人未提供'
            }}
            ·
            {{
              task.shiftName ||
              (mode === 'demo' ? task.shift : '') ||
              '班次未提供'
            }}
          </p>
          <span class="task-primary-action">{{ taskPrimaryLabel(task) }}</span>
        </div>
        <ChevronRight :size="18" class="row-arrow" aria-hidden="true" />
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
    <RouterLink to="/timeline" class="secondary-link">
      <History :size="17" aria-hidden="true" />过程回放<ChevronRight
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
          <X :size="20" aria-hidden="true" />
        </button>
      </header>
      <div class="sheet-body">
        <div class="filter-grid">
          <label class="select-field"
            >老人<select
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
            </select></label
          >
          <label class="select-field"
            >班次<select
              v-model="filters.shift"
              aria-label="班次"
              @change="sync"
            >
              <option value="">全部班次</option>
              <option v-for="item in shifts" :key="item">{{ item }}</option>
            </select></label
          >
          <label class="select-field"
            >责任人<select
              v-model="filters.assignee"
              aria-label="责任人"
              @change="sync"
            >
              <option value="">全部责任人</option>
              <option v-for="item in assignees" :key="item">{{ item }}</option>
            </select></label
          >
          <label class="select-field"
            >状态<select
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
            </select></label
          >
        </div>
        <label class="select-field"
          >排序<select v-model="filters.sort" aria-label="排序" @change="sync">
            <option value="source">原始顺序</option>
            <option value="due_asc">截止时间从早到晚</option>
            <option value="due_desc">截止时间从晚到早</option>
          </select></label
        >
      </div>
      <footer class="sheet-footer">
        <van-button plain icon="replay" aria-label="重置" @click="reset">
          重置 </van-button
        ><van-button type="primary" @click="filterOpen = false">
          显示任务
        </van-button>
      </footer>
    </van-popup>
  </section>
</template>
<style scoped>
.task-primary-action {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--hl-primary);
  font-weight: 600;
}
.task-create-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  font-size: 14px;
  color: #1767cf;
  white-space: nowrap;
}
.workbench-safety-link {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  color: var(--hl-primary);
}
.workbench-safety-link svg:last-child {
  margin-left: auto;
}
.elder-workbench {
  margin: 20px 0;
}
.elder-workbench h2 {
  margin-bottom: 6px;
  font-size: 18px;
}
.elder-card-list,
.elder-card-tasks {
  list-style: none;
  margin: 0;
  padding: 0;
}
.elder-card-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}
.elder-work-card {
  border: 1px solid var(--hl-border);
  border-radius: 12px;
  padding: 12px;
  background: var(--hl-surface, #fff);
  color: var(--hl-ink);
  overflow-wrap: anywhere;
}
.elder-card-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 44px;
  color: var(--hl-ink);
}
.elder-card-title strong {
  font-size: 18px;
}
.elder-card-title svg {
  margin-left: auto;
}
.elder-card-title span,
.elder-card-counts {
  font-size: 14px;
}
.elder-card-overdue {
  color: #a52a32;
  font-weight: 600;
}
.elder-card-note {
  white-space: pre-wrap;
  line-height: 1.6;
}
.elder-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  border-top: 1px solid var(--hl-border);
}
.elder-card-actions a,
.elder-card-actions button,
.elder-card-tasks a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--hl-primary);
}
.elder-card-actions button {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
}
.elder-card-actions button[aria-pressed='true'] {
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.elder-workbench a:focus-visible,
.elder-workbench button:focus-visible {
  outline: 3px solid var(--hl-primary);
  outline-offset: 2px;
}
#care-task-list {
  scroll-margin-top: 86px;
}
#care-task-list:focus-visible {
  outline: 2px solid var(--hl-primary);
  outline-offset: 4px;
  border-radius: 4px;
}
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .elder-work-card {
    transition: box-shadow 120ms ease;
  }
  .elder-work-card:hover {
    box-shadow: 0 2px 8px rgb(23 44 69 / 10%);
  }
}
</style>
