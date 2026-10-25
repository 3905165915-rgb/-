<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { loadDemoState } from '@hulao/shared'
import { ArrowUpRight, RefreshCw } from 'lucide-vue-next'
import { useElders, useTasks, mode, queryKey } from '../../services/data'
import QueryFeedback from '../../components/QueryFeedback.vue'
const elders = useElders()
const tasks = useTasks()
const demo = useQuery({
  queryKey: computed(() => queryKey('demo-preview')),
  queryFn: loadDemoState,
  enabled: mode === 'demo',
})
const pending = computed(
  () =>
    tasks.data.value?.filter(
      (task) => !['completed', 'not_done', 'cancelled'].includes(task.status),
    ).length ?? 0,
)
const overdue = computed(
  () =>
    tasks.data.value?.filter((task) => task.status === 'overdue').length ?? 0,
)
</script>
<template>
  <section>
    <div class="page-title-row">
      <h1>工作台</h1>
      <el-button
        class="icon-button"
        title="刷新工作台"
        aria-label="刷新工作台"
        :loading="elders.isFetching.value || tasks.isFetching.value"
        @click="
          () => {
            elders.refetch()
            tasks.refetch()
            if (mode === 'demo') demo.refetch()
          }
        "
      >
        <RefreshCw :size="18" aria-hidden="true" />
      </el-button>
    </div>
    <p role="status">虚构演示数据 · 以下快照和提醒仅用于演示，不代表服务器运营统计。</p>
    <QueryFeedback
      :loading="elders.isPending.value || tasks.isPending.value"
      :error="elders.error.value || tasks.error.value"
      @retry="
        () => {
          elders.refetch()
          tasks.refetch()
        }
      "
    />
    <div class="dashboard-metrics">
      <button
        type="button"
        class="metric-card"
        @click="$router.push('/elders')"
      >
        <b>{{
          elders.error.value || elders.isPending.value
            ? '—'
            : (elders.data.value?.filter((elder) => elder.status === '入住')
                .length ?? 0)
        }}</b
        ><span>在住老人</span></button
      ><button
        type="button"
        class="metric-card metric-info"
        @click="$router.push('/tasks')"
      >
        <b>{{ tasks.error.value || tasks.isPending.value ? '—' : pending }}</b
        ><span>待处理任务</span></button
      ><button
        type="button"
        class="metric-card metric-danger"
        @click="$router.push('/tasks?status=overdue')"
      >
        <b>{{ tasks.error.value || tasks.isPending.value ? '—' : overdue }}</b
        ><span>逾期任务</span>
      </button>
    </div>
    <template v-if="mode === 'demo'">
      <div class="dashboard-notices">
        <h2>演示提醒</h2>
        <QueryFeedback
          :loading="demo.isPending.value"
          :error="demo.error.value"
          @retry="demo.refetch()"
        /><el-alert
          v-for="notice in demo.data.value?.notifications"
          :key="notice"
          :title="notice"
          type="info"
          :closable="false"
        />
        <p>
          待核对演示草稿：{{
            demo.data.value?.drafts.filter(
              (draft) => draft.status === 'pending_review',
            ).length ?? '未提供'
          }}
        </p>
        <p>
          待接收演示交班：{{
            demo.data.value?.handover.filter((item) => item.status === '待接收')
              .length ?? '未提供'
          }}
        </p>
        <el-button @click="$router.push('/demo')">
          演示数据管理<ArrowUpRight :size="16" aria-hidden="true" />
        </el-button>
      </div>
    </template>
  </section>
</template>
