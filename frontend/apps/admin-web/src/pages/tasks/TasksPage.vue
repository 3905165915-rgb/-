<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import DemoTaskCreate from '../../../../../packages/shared/src/workflow/DemoTaskCreate.vue'
import { mode } from '../../services/data'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  History,
  RefreshCw,
  RotateCcw,
  Search,
  SquarePen,
  Plus,
} from 'lucide-vue-next'
import { useTasks, useElders } from '../../services/data'
import {
  useTaskFilters,
  taskStatusLabels,
} from '../../composables/useTaskFilters'
import TaskActionDialog from '../../components/TaskActionDialog.vue'
import QueryFeedback from '../../components/QueryFeedback.vue'
import StatusLabel from '../../components/StatusLabel.vue'
import { taskPrimaryLabel, taskTime } from '../../composables/task-presentation'
const tasks = useTasks()
const elders = useElders()
const elderMap = computed(
  () => new Map((elders.data.value ?? []).map((elder) => [elder.id, elder])),
)
const counts = computed(() => {
  const rows = tasks.data.value ?? []
  return [
    { label: '已载入任务', value: rows.length, tone: '' },
    {
      label: '待处理',
      value: rows.filter((task) => task.status === 'pending').length,
      tone: 'warning',
    },
    {
      label: '已逾期',
      value: rows.filter((task) => task.status === 'overdue').length,
      tone: 'danger',
    },
    {
      label: '进行中',
      value: rows.filter((task) => task.status === 'in_progress').length,
      tone: 'info',
    },
    {
      label: '已完成',
      value: rows.filter((task) => task.status === 'completed').length,
      tone: 'success',
    },
  ]
})
const statusTabs = [
  { label: '全部', value: '' },
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
]
function selectStatus(value: string) {
  filters.value.status = value
  sync()
}
const { filters, filtered, shifts, assignees, sync, reset } = useTaskFilters(
  () => tasks.data.value ?? [],
  () => elders.data.value ?? [],
)
const selectedId = ref<string | null>(null)
const selected = computed(() => tasks.data.value?.find(task => task.id === selectedId.value) ?? null)
const route = useRoute()
const router = useRouter()
const creating = computed(() => route.query.create === '1')
const createContext = computed(() => typeof route.query.elder === 'string' ? { elder_id: route.query.elder } : {})
function closeTask() {
  selectedId.value = null
  if (route.query.task || route.query.draft) {
    const query = { ...route.query }
    delete query.task
    delete query.draft
    void router.replace({ query })
  }
}
const page = ref(1)
const pageSize = ref(25)
const paged = computed(() =>
  filtered.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
)
watch([filtered, pageSize], () => {
  page.value = 1
})
watch(
  () => [route.query.task, route.query.draft, tasks.data.value],
  () => {
    if (typeof route.query.task === 'string')
      selectedId.value = route.query.task
  },
  { immediate: true },
)
</script>
<template>
  <section class="tasks-page">
    <div class="page-title-row">
      <h1>任务管理</h1>
      <el-button type="primary" @click="router.push({ query: { ...route.query, create: '1' } })"><Plus :size="16" aria-hidden="true" />新建任务</el-button>
    </div>
    <section v-if="creating" aria-label="新建照护任务">
      <el-button link @click="router.push({ query: {} })">返回任务列表</el-button>
      <DemoTaskCreate v-if="mode === 'demo'" :key="String(route.query.elder || '')" :elder-id="typeof route.query.elder === 'string' ? route.query.elder : undefined" @saved="tasks.refetch()" />
      <WorkflowPanel v-else group="tasks" title="新建照护任务" initial-action="/tasks" :context="createContext" task-creation @changed="tasks.refetch()" />
    </section>
    <template v-else>
    <div class="page-title-row">
      <h2>每日任务</h2>
      <el-button
        class="icon-button"
        title="刷新任务"
        aria-label="刷新任务"
        :loading="tasks.isFetching.value"
        @click="tasks.refetch()"
      >
        <RefreshCw :size="18" aria-hidden="true" />
      </el-button>
    </div>
    <div class="task-metrics" aria-label="已载入任务统计">
      <div
        v-for="metric in counts"
        :key="metric.label"
        :class="'metric-' + metric.tone"
      >
        <span>{{ metric.label }}</span
        ><strong>{{
          tasks.isPending.value || tasks.error.value ? '未提供' : metric.value
        }}</strong>
      </div>
    </div>
    <div class="data-section">
      <div class="section-tabs" role="group" aria-label="任务状态视图">
        <button
          v-for="tab in statusTabs"
          :key="tab.value"
          type="button"
          :aria-pressed="filters.status === tab.value"
          @click="selectStatus(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
      <el-form inline class="filter-bar task-filters">
        <el-form-item label="搜索" class="task-search">
          <el-input
            v-model="filters.q"
            placeholder="已载入任务、老人、床位"
            clearable
            @input="sync"
          >
            <template #prefix>
              <Search :size="16" aria-hidden="true" />
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="排序">
          <el-select v-model="filters.sort" @change="sync">
            <el-option label="原始顺序" value="source" /><el-option
              label="截止时间从早到晚"
              value="due_asc"
            /><el-option label="截止时间从晚到早" value="due_desc" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button
            class="icon-button"
            title="重置筛选"
            aria-label="重置筛选"
            @click="reset"
          >
            <RotateCcw :size="17" aria-hidden="true" />
          </el-button>
        </el-form-item>
        <el-form-item label="老人">
          <el-select
            v-model="filters.elder"
            placeholder="全部老人"
            clearable
            @change="sync"
          >
            <el-option
              v-for="item in elders.data.value"
              :key="item.id"
              :label="item.name + ' · ' + item.bedLabel"
              :value="item.id"
            />
          </el-select> </el-form-item
        ><el-form-item label="班次">
          <el-select
            v-model="filters.shift"
            placeholder="全部班次"
            clearable
            @change="sync"
          >
            <el-option
              v-for="item in shifts"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select> </el-form-item
        ><el-form-item label="责任人">
          <el-select
            v-model="filters.assignee"
            placeholder="全部责任人"
            clearable
            @change="sync"
          >
            <el-option
              v-for="item in assignees"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select> </el-form-item
        ><el-form-item label="状态">
          <el-select
            v-model="filters.status"
            placeholder="全部状态"
            clearable
            @change="sync"
          >
            <el-option
              v-for="(label, key) in taskStatusLabels"
              :key="key"
              :label="label"
              :value="key"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <QueryFeedback
        :loading="tasks.isPending.value"
        :error="tasks.error.value"
        @retry="
          () => {
            tasks.refetch()
            elders.refetch()
          }
        "
      />
      <QueryFeedback :error="elders.error.value" @retry="elders.refetch()" />
      <el-table
        v-if="!tasks.isPending.value && !tasks.error.value"
        :data="paged"
        :empty-text="
          tasks.data.value?.length ? '暂无匹配任务，请调整筛选条件' : '暂无任务'
        "
      >
        <el-table-column label="护理任务" min-width="220">
          <template #default="{ row }">
            <div class="table-primary">
              {{ row.title }}
            </div>
          </template> </el-table-column
        ><el-table-column label="老人 / 床位" min-width="180">
          <template #default="{ row }">
            <RouterLink
              v-if="row.elderId"
              class="elder-table-link"
              :to="'/elders/' + encodeURIComponent(row.elderId)"
            >
              <span class="bed-label">{{
                row.bedSnapshot || elderMap.get(row.elderId)?.bedLabel || '床位未提供'
              }}</span>
              <span
                ><span class="table-primary">{{
                  row.nameSnapshot || elderMap.get(row.elderId)?.name || '姓名未提供'
                }}</span
                ></span
              >
            </RouterLink>
            <span v-else class="muted"
              >{{ row.elderId }} ·
              {{
                elders.isPending.value ? '档案加载中' : '姓名及床位未提供'
              }}</span
            >
          </template> </el-table-column
        ><el-table-column label="班次 · 责任人" min-width="140">
          <template #default="{ row }">
            <div class="table-primary">
              {{ row.assignee || '责任人未提供' }}
            </div>
            <div class="table-secondary">
              {{ row.shiftName || row.shift || '班次未提供' }}
            </div>
          </template> </el-table-column
        ><el-table-column label="执行时间 / 截止时间" min-width="190">
          <template #default="{ row }">
            <div class="table-primary">执行：{{ taskTime(row.executionAt) }}</div>
            <div class="table-secondary">截止：{{ taskTime(row.deadlineAt || row.dueAt) }}</div>
          </template>
        </el-table-column><el-table-column label="状态" min-width="100">
          <template #default="{ row }">
            <StatusLabel :status="row.status" />
          </template> </el-table-column
        ><el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :title="taskPrimaryLabel(row)"
              :aria-label="row.title + '：' + taskPrimaryLabel(row)"
              @click="selectedId = row.id"
            >
              <SquarePen :size="18" aria-hidden="true" />{{ taskPrimaryLabel(row) }} </el-button
            ><el-button
              v-if="row.itemId"
              link
              class="icon-button"
              title="事项回放"
              aria-label="事项回放"
              @click="
                $router.push('/timeline/' + encodeURIComponent(row.itemId))
              "
            >
              <History :size="18" aria-hidden="true" />
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div
        v-if="!tasks.isPending.value && !tasks.error.value"
        class="list-summary table-footer"
      >
        <span role="status"
          >当前 {{ filtered.length }} 项 · 已载入
          {{ tasks.data.value?.length ?? 0 }} 项</span
        ><el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 25, 50]"
          :total="filtered.length"
          layout="sizes, prev, pager, next"
          :pager-count="5"
        />
      </div>
    </div>
    <TaskActionDialog
      :task="selected"
      :elder="selected ? elderMap.get(selected.elderId) : undefined"
      :assignees="assignees"
      @close="closeTask"
    />
    <WorkflowPanel
      group="tasks"
      title="任务办理与依据核验"
      @changed="tasks.refetch()"
    />
    </template>
  </section>
</template>
