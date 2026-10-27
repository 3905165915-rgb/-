<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import {
  ArrowLeft,
  ChevronRight,
  History,
  ListPlus,
  PenLine,
  ShieldAlert,
} from 'lucide-vue-next'
import {
  formatBusinessTime,
  isBusinessToday,
  loadDemoState,
  taskStatusLabels,
} from '@hulao/shared'
import ElderWorkspace from '../../../../../packages/shared/src/workflow/ElderWorkspace.vue'
import { demoFollowups as buildDemoFollowups } from '../../../../../packages/shared/src/workflow/pending-work'
import DemoUnderstanding from '../../../../../packages/shared/src/workflow/DemoUnderstanding.vue'
import { mode, queryKey, useElders, useTasks } from '../../services/data'
import FeedbackState from '../../components/FeedbackState.vue'

const route = useRoute()
const elders = useElders()
const tasks = useTasks()
const elder = computed(() =>
  elders.data.value?.find((row) => row.id === route.params.id),
)
const ready = computed(() => !elders.isPending.value && !elders.error.value)
const tasksReady = computed(() => !tasks.isPending.value && !tasks.error.value)
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
  const tasks = state.tasks.filter((task) => task.elderId === elder.value!.id)
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
    true,
  ).filter((item) => item.category !== 'processed')
})
function time(value: string, full = false) {
  return formatBusinessTime(value, full)
}
const related = computed(() =>
  elder.value && ready.value && tasksReady.value
    ? (tasks.data.value ?? []).filter(
        (task) => task.elderId === elder.value!.id,
      )
    : [],
)
const todayTasks = computed(() =>
  related.value.filter((task) =>
    isBusinessToday(task.executionAt || task.dueAt),
  ),
)
const demoRecordCount = computed(
  () =>
    demo.data.value?.records.filter(
      (record) => record.elderId === elder.value?.id,
    ).length,
)
</script>

<template>
  <section class="elder-detail-page">
    <RouterLink to="/elders" class="back-link">
      <ArrowLeft :size="18" aria-hidden="true" />老人列表
    </RouterLink>
    <FeedbackState
      :loading="elders.isPending.value"
      :error="elders.error.value"
      :empty="ready && !elder"
      empty-text="未找到可查看的老人档案"
      @retry="elders.refetch()"
    />
    <template v-if="ready && elder">
      <header class="page-title-row">
        <h1>{{ elder.name || '姓名未提供' }}</h1>
        <span class="muted">{{ elder.status }}</span>
      </header>
      <p class="elder-bed">
        {{ elder.bedLabel || '床位未提供' }}
      </p>
      <dl
        v-if="mode === 'demo'"
        class="elder-summary"
        aria-label="老人工作摘要"
      >
        <div>
          <dt>今日安排</dt>
          <dd>
            {{
              related.filter((task) =>
                isBusinessToday(task.executionAt || task.dueAt),
              ).length
            }}
          </dd>
        </div>
        <div>
          <dt>待跟进</dt>
          <dd>{{ demoFollowups.length }}</dd>
        </div>
        <div>
          <dt>最近记录</dt>
          <dd>{{ demoRecordCount ?? '—' }}</dd>
        </div>
      </dl>
      <RouterLink
        :to="{ path: '/records/new', query: { elder: elder.id } }"
        class="record-link"
      >
        <PenLine :size="18" aria-hidden="true" />记一条
        <ChevronRight :size="18" aria-hidden="true" />
      </RouterLink>

      <RouterLink
        :to="{ path: '/tasks/new', query: { elder: elder.id } }"
        class="create-task-link"
      >
        <ListPlus :size="18" aria-hidden="true" />新建任务
        <ChevronRight :size="18" aria-hidden="true" />
      </RouterLink>

      <RouterLink
        :to="{ path: '/safety', query: { report: '1', elder: elder.id } }"
        class="safety-report-link"
      >
        <ShieldAlert :size="18" aria-hidden="true" />照护安全与事件上报
        <ChevronRight :size="18" aria-hidden="true" />
      </RouterLink>

      <DemoUnderstanding
        v-if="mode === 'demo'"
        :key="elder.id"
        :elder-id="elder.id"
      />
      <ElderWorkspace v-else :key="elder.id" :elder-id="elder.id" mobile />
      <section class="profile-section" aria-labelledby="elder-profile-title">
        <h2 id="elder-profile-title">基本资料</h2>
        <dl class="elder-facts">
          <div>
            <dt>年龄</dt>
            <dd>{{ elder.age === undefined ? '未提供' : elder.age + '岁' }}</dd>
          </div>
          <div v-if="elder.risk">
            <dt>风险</dt>
            <dd>{{ elder.risk }}</dd>
          </div>
          <div v-if="elder.contact">
            <dt>联系人</dt>
            <dd>{{ elder.contact }}</dd>
          </div>
          <div v-if="elder.lastUpdate">
            <dt>最近更新</dt>
            <dd>{{ time(elder.lastUpdate) }}</dd>
          </div>
        </dl>
        <template v-if="elder.notes">
          <h3>护理注意</h3>
          <p class="elder-notes">
            {{ elder.notes }}
          </p>
        </template>
      </section>

      <section
        v-if="mode === 'demo'"
        class="profile-section"
        aria-labelledby="elder-tasks-title"
      >
        <div class="page-title-row">
          <h2 id="elder-tasks-title">今日安排</h2>
          <RouterLink :to="{ path: '/caregiver', query: { elder: elder.id } }">
            查看全部<ChevronRight :size="16" aria-hidden="true" />
          </RouterLink>
        </div>
        <FeedbackState
          :loading="tasks.isPending.value"
          :error="tasks.error.value"
          :empty="tasksReady && !todayTasks.length"
          empty-text="暂无可查看的相关任务"
          @retry="tasks.refetch()"
        />
        <ul v-if="todayTasks.length" class="elder-tasks" aria-label="今日安排">
          <li v-for="task in todayTasks" :key="task.id">
            <RouterLink
              :to="'/tasks/' + encodeURIComponent(task.id)"
              class="task-link"
            >
              <strong>{{ task.title }}</strong>
              <ChevronRight :size="18" aria-hidden="true" />
            </RouterLink>
            <p class="muted">
              {{ taskStatusLabels[task.status] || '状态待核实' }} ·
              {{
                task.assigneeName ||
                (mode === 'demo' ? task.assignee : '') ||
                '负责人未提供'
              }}
            </p>
            <p class="muted">到期：{{ time(task.dueAt) }}</p>
            <RouterLink
              v-if="task.itemId"
              :to="'/timeline/' + encodeURIComponent(task.itemId)"
              class="timeline-link"
            >
              <History :size="17" aria-hidden="true" />事项回放
            </RouterLink>
          </li>
        </ul>
      </section>

      <section
        v-if="mode === 'demo'"
        class="profile-section"
        aria-labelledby="recent-record-title"
      >
        <div class="page-title-row">
          <h2 id="recent-record-title">最近记录</h2>
          <RouterLink :to="{ path: '/records/new', query: { elder: elder.id } }"
            >写一条 <ChevronRight :size="16" aria-hidden="true"
          /></RouterLink>
        </div>
        <ol class="demo-record-list">
          <li v-for="record in demoRecords" :key="record.id">
            <strong>{{ record.title }}</strong>
            <p>{{ record.content }}</p>
            <span class="muted"
              >{{ record.category }} · {{ time(record.happenedAt) }}</span
            >
          </li>
        </ol>
      </section>

      <section
        v-if="mode === 'demo'"
        class="profile-section"
        aria-labelledby="followup-title"
      >
        <div class="page-title-row">
          <h2 id="followup-title">需要跟进</h2>
          <span class="muted">{{ demoFollowups.length }}项</span>
        </div>
        <p v-if="!demoFollowups.length" class="muted">当前没有待跟进事项。</p>
        <ul v-else class="demo-task-list">
          <li v-for="item in demoFollowups" :key="item.id">
            <RouterLink :to="item.location"
              ><strong>{{ item.title }}</strong
              ><ChevronRight :size="16" aria-hidden="true"
            /></RouterLink>
            <p class="muted">
              {{ item.detail }} ·
              {{
                item.category === 'review'
                  ? '下一步：独立复查'
                  : '下一步：进入办理'
              }}
            </p>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.back-link,
.record-link,
.create-task-link,
.safety-report-link,
.task-link,
.timeline-link {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.elder-bed {
  margin-bottom: 4px;
  font-size: 18px;
  font-weight: 600;
}
.elder-id {
  margin-top: 0;
}
.elder-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0;
}
.elder-summary > div {
  padding: 12px;
  background: var(--hl-primary-soft);
  border-radius: 8px;
}
.elder-summary dt {
  color: var(--hl-muted);
  font-size: 13px;
}
.elder-summary dd {
  margin: 4px 0 0;
  font-size: 22px;
  font-weight: 700;
}
.known-section {
  margin: 20px 0;
  padding: 16px;
  border: 1px solid var(--hl-border);
  border-radius: 8px;
  background: var(--hl-surface);
}
.known-grid {
  display: grid;
  gap: 12px;
}
.known-grid article {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--hl-border);
}
.known-grid h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.known-grid p,
.known-section details p {
  margin: 4px 0;
  line-height: 1.55;
}
.demo-task-list,
.demo-record-list {
  padding: 0;
  margin: 0;
  list-style: none;
}
.demo-task-list li,
.demo-record-list li {
  padding: 12px 0;
  border-bottom: 1px solid var(--hl-border);
}
.demo-task-list a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--hl-ink);
}
.demo-task-list p,
.demo-record-list p {
  margin: 5px 0;
  line-height: 1.5;
}
.demo-record-list strong {
  display: block;
}
@media (max-width: 360px) {
  .elder-summary {
    gap: 4px;
  }
  .elder-summary > div {
    padding: 8px 6px;
  }
  .elder-summary dd {
    font-size: 19px;
  }
}
.record-link,
.create-task-link {
  padding: 12px;
  margin: 16px 0;
  color: var(--hl-primary);
  background: var(--hl-primary-soft);
  border-radius: 6px;
}
.safety-report-link {
  color: var(--hl-primary);
  margin: 12px 0 20px;
}
.safety-report-link svg:last-child {
  margin-left: auto;
}
.record-link svg:last-child,
.create-task-link svg:last-child,
.task-link svg {
  margin-left: auto;
}
.profile-section {
  padding: 4px 0 16px;
  border-top: 1px solid var(--hl-border);
}
.elder-facts {
  margin: 0;
}
.elder-facts > div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 12px;
  padding: 8px 0;
}
.elder-facts dt {
  color: var(--hl-muted);
}
.elder-facts dd {
  margin: 0;
}
.elder-notes {
  white-space: pre-wrap;
}
.elder-tasks {
  padding: 0;
  margin: 0;
  list-style: none;
}
.elder-tasks li {
  padding: 12px 0;
  border-bottom: 1px solid var(--hl-border);
}
.elder-tasks p {
  margin: 4px 0;
  font-size: 14px;
}
.task-link {
  justify-content: space-between;
  color: var(--hl-ink);
}
</style>
