<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import ElderWorkspace from '../../../../../packages/shared/src/workflow/ElderWorkspace.vue'
import { demoFollowups as buildDemoFollowups } from '../../../../../packages/shared/src/workflow/pending-work'
import DemoUnderstanding from '../../../../../packages/shared/src/workflow/DemoUnderstanding.vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import {
  formatBusinessTime,
  isFollowupTask,
  isBusinessToday,
  loadDemoState,
} from '@hulao/shared'
import { mode, queryKey, useElders, useTasks } from '../../services/data'
import {
  ArrowLeft,
  ArrowUpRight,
  ContactRound,
  History,
  ListChecks,
  ShieldCheck,
} from 'lucide-vue-next'
import StatusLabel from '../../components/StatusLabel.vue'
import QueryFeedback from '../../components/QueryFeedback.vue'
const route = useRoute()
const elders = useElders()
const tasks = useTasks()
const elder = computed(() =>
  elders.data.value?.find((item) => item.id === route.params.id),
)
const related = computed(
  () =>
    tasks.data.value?.filter(
      (item) => item.elderId === elder.value?.id && isFollowupTask(item),
    ) ?? [],
)
const demo = useQuery({
  queryKey: computed(() =>
    queryKey('demo-elder', String(route.params.id || '')),
  ),
  queryFn: loadDemoState,
  enabled: mode === 'demo',
})
const demoRecords = computed(
  () =>
    demo.data.value?.records
      .filter((record) => record.elderId === elder.value?.id)
      .sort((a, b) => Date.parse(b.happenedAt) - Date.parse(a.happenedAt))
      .slice(0, 5) ?? [],
)
const demoFollowups = computed(() => {
  const state = demo.data.value
  if (!state || !elder.value) return []
  const tasks = state.tasks.filter(
    (task) => task.elderId === elder.value!.id && isFollowupTask(task),
  )
  return buildDemoFollowups(
    {
      tasks,
      elders: state.elders,
      handover: state.handover.filter((item) =>
        tasks.some((task) => task.itemId === item.itemId),
      ),
      memoryReviews: state.memoryReviews.filter(
        (item) => item.elderId === elder.value!.id,
      ),
    },
    false,
  ).filter((item) => item.category !== 'processed')
})
const demoTodayCount = computed(
  () =>
    related.value.filter((task) =>
      isBusinessToday(task.executionAt || task.dueAt),
    ).length,
)
const demoRecordCount = computed(
  () =>
    demo.data.value?.records.filter((row) => row.elderId === elder.value?.id)
      .length ?? 0,
)
function time(value: string) {
  return formatBusinessTime(value)
}
const todayTasks = computed(() =>
  related.value.filter((task) =>
    isBusinessToday(task.executionAt || task.dueAt),
  ),
)
</script>
<template>
  <section class="elder-detail-page">
    <el-button link class="back-link" @click="$router.push('/elders')">
      <ArrowLeft :size="16" aria-hidden="true" />返回档案列表 </el-button
    ><QueryFeedback
      :loading="elders.isPending.value"
      :error="elders.error.value"
      :empty="!elders.isPending.value && !elders.error.value && !elder"
      empty-text="未找到老人档案"
      @retry="elders.refetch()"
    /><template v-if="elder && !elders.error.value">
      <div class="page-title-row">
        <h1>{{ elder.name }}</h1>
        <el-button
          type="primary"
          @click="
            $router.push({
              path: '/tasks',
              query: { create: '1', elder: elder.id },
            })
          "
          >新建任务</el-button
        >
        <span
          class="status-label"
          :class="elder.status === '入住' ? 'status-success' : 'status-neutral'"
          ><span class="status-dot" aria-hidden="true" />{{
            elder.status
          }}</span
        >
      </div>
      <div class="action-row">
        <RouterLink
          :to="{
            path: '/workflows/records',
            query: { elder_id: elder.id, action: '/records/context-extract' },
          }"
          >写记录</RouterLink
        >
        <RouterLink :to="{ path: '/care-plan', query: { elder: elder.id } }"
          >制定安排</RouterLink
        >
      </div>
      <div class="elder-summary">
        <div class="elder-identification">
          <span class="person-avatar"
            ><ContactRound :size="28" aria-hidden="true"
          /></span>
          <div>
            <strong>{{ elder.bedLabel || '床位未提供' }}</strong
            ><span>当前照护对象</span>
          </div>
        </div>
        <div class="elder-fact">
          <span>年龄</span
          ><strong>{{
            elder.age === undefined ? '未提供' : elder.age + '岁'
          }}</strong>
        </div>
        <div v-if="elder.risk" class="elder-fact">
          <span>风险</span
          ><strong
            :class="{
              'warning-text': elder.risk === '中',
              'danger-text': elder.risk === '高',
            }"
            >{{ elder.risk }}</strong
          >
        </div>
        <div v-if="elder.lastUpdate" class="elder-fact">
          <span>最近更新</span><strong>{{ time(elder.lastUpdate) }}</strong>
        </div>
        <el-button
          @click="$router.push({ path: '/tasks', query: { elder: elder.id } })"
        >
          <ListChecks :size="17" aria-hidden="true" />查看全部任务
        </el-button>
      </div>
      <dl v-if="mode === 'demo'" class="work-summary" aria-label="今日照护概况">
        <div>
          <dt>今日安排</dt>
          <dd>{{ demoTodayCount }}</dd>
        </div>
        <div>
          <dt>待跟进</dt>
          <dd>{{ demoFollowups.length }}</dd>
        </div>
        <div>
          <dt>最近记录</dt>
          <dd>{{ demo.data.value ? demoRecordCount : '—' }}</dd>
        </div>
      </dl>
      <DemoUnderstanding
        v-if="mode === 'demo'"
        :key="elder.id"
        :elder-id="elder.id"
      />
      <ElderWorkspace v-else :key="elder.id" :elder-id="elder.id" />
      <div class="data-section">
        <div class="profile-section">
          <div class="section-title">
            <h2>基本资料</h2>
            <span class="muted">{{
              mode === 'demo' ? '演示资料' : '按权限显示'
            }}</span>
          </div>
          <dl class="details-grid">
            <div>
              <dt>姓名</dt>
              <dd>{{ elder.name }}</dd>
            </div>
            <div>
              <dt>床位</dt>
              <dd>{{ elder.bedLabel || '未提供' }}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{{ elder.status }}</dd>
            </div>
            <div v-if="elder.contact">
              <dt>联系人</dt>
              <dd>{{ elder.contact }}</dd>
            </div>
          </dl>
        </div>
        <div class="profile-section care-section">
          <div class="section-title">
            <h2>护理注意</h2>
            <ShieldCheck :size="18" aria-hidden="true" />
          </div>
          <p>{{ elder.notes || '未提供护理注意事项' }}</p>
        </div>
        <div v-if="mode === 'demo'" class="section-title related-heading">
          <h2>今日安排</h2>
          <span
            v-if="!tasks.isPending.value && !tasks.error.value"
            class="muted"
            >{{ todayTasks.length }} 项</span
          >
        </div>
        <QueryFeedback
          v-if="mode === 'demo'"
          :loading="tasks.isPending.value"
          :error="tasks.error.value"
          :empty="
            !tasks.isPending.value && !tasks.error.value && !todayTasks.length
          "
          @retry="tasks.refetch()"
        /><el-table
          v-if="
            mode === 'demo' &&
            !tasks.isPending.value &&
            !tasks.error.value &&
            todayTasks.length
          "
          :data="todayTasks"
        >
          <el-table-column
            prop="title"
            label="任务"
            min-width="200"
          /><el-table-column label="状态">
            <template #default="{ row }">
              <StatusLabel :status="row.status" />
            </template> </el-table-column
          ><el-table-column label="截止时间" min-width="160"
            ><template #default="{ row }">{{
              time(row.dueAt)
            }}</template></el-table-column
          ><el-table-column label="操作" width="128" fixed="right">
            <template #default="{ row }">
              <el-button
                link
                class="icon-button"
                title="处理此任务"
                aria-label="处理此任务"
                @click="
                  $router.push({
                    path: '/tasks',
                    query: { elder: elder.id, task: row.id },
                  })
                "
              >
                <ArrowUpRight :size="18" aria-hidden="true" /> </el-button
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
      </div>
      <template v-if="mode === 'demo'">
        <section
          class="demo-detail-section"
          aria-labelledby="demo-records-title"
        >
          <div class="section-title">
            <h2 id="demo-records-title">最近记录</h2>
            <el-button
              link
              @click="
                $router.push({
                  path: '/workflows/records',
                  query: { elder_id: elder.id },
                })
              "
              >查看记录</el-button
            >
          </div>
          <ul>
            <li v-for="record in demoRecords" :key="record.id">
              <strong>{{ record.title }}</strong>
              <p>{{ record.content }}</p>
              <span>{{ record.category }} · {{ time(record.happenedAt) }}</span>
            </li>
          </ul>
        </section>
        <section
          class="demo-detail-section"
          aria-labelledby="demo-followups-title"
        >
          <div class="section-title">
            <h2 id="demo-followups-title">需要跟进</h2>
            <span class="muted">{{ demoFollowups.length }}项</span>
          </div>
          <ul>
            <li v-for="item in demoFollowups" :key="item.id">
              <RouterLink :to="item.location"
                ><strong>{{ item.title }}</strong></RouterLink
              >
              <p>
                {{ item.detail }} ·
                {{
                  item.category === 'review'
                    ? '下一步：独立复查'
                    : '下一步：进入办理'
                }}
              </p>
            </li>
            <li v-if="!demoFollowups.length">当前没有待跟进事项。</li>
          </ul>
        </section>
      </template>
    </template>
    <WorkflowPanel
      v-if="mode === 'api'"
      group="elders"
      title="老人资料修订"
      :context="{ elder_id: String(route.params.id) }"
    />
  </section>
</template>
<style scoped>
.work-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 16px;
}
.work-summary > div {
  padding: 12px;
  background: var(--hl-primary-soft);
  border-radius: 6px;
}
.work-summary dt {
  color: var(--hl-muted);
  font-size: 13px;
}
.work-summary dd {
  margin: 4px 0 0;
  font-size: 22px;
  font-weight: 700;
}
.known-section,
.demo-detail-section {
  padding: 16px 0;
  border-top: 1px solid var(--hl-border);
}
.known-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.known-grid article {
  min-width: 0;
  padding: 12px;
  background: var(--hl-surface);
  border: 1px solid var(--hl-border);
  border-radius: 6px;
}
.known-grid h3 {
  margin: 0 0 8px;
}
.demo-detail-section ul {
  padding: 0;
  list-style: none;
}
.demo-detail-section li {
  padding: 10px 0;
  border-bottom: 1px solid var(--hl-border);
}
.demo-detail-section p {
  margin: 5px 0;
  color: var(--hl-muted);
}
.demo-detail-section li > span {
  float: right;
  color: var(--hl-muted);
}
@media (max-width: 760px) {
  .known-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
