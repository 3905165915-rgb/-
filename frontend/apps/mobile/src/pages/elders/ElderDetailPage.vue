<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, ChevronRight, History, ListPlus, PenLine } from 'lucide-vue-next'
import { taskStatusLabels } from '@hulao/shared'
import { useElders, useTasks } from '../../services/data'
import FeedbackState from '../../components/FeedbackState.vue'

const route = useRoute()
const elders = useElders()
const tasks = useTasks()
const elder = computed(() =>
  elders.data.value?.find((row) => row.id === route.params.id),
)
const ready = computed(() => !elders.isPending.value && !elders.error.value)
const tasksReady = computed(() => !tasks.isPending.value && !tasks.error.value)
const related = computed(() =>
  elder.value && ready.value && tasksReady.value
    ? (tasks.data.value ?? []).filter(
        (task) => task.elderId === elder.value!.id,
      )
    : [],
)
</script>

<template>
  <section class="elder-detail-page">
    <RouterLink
      to="/elders"
      class="back-link"
    >
      <ArrowLeft
        :size="18"
        aria-hidden="true"
      />老人列表
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
      <p class="muted elder-id">
        编号：{{ elder.id }}
      </p>
      <RouterLink
        :to="{ path: '/records/new', query: { elder: elder.id } }"
        class="record-link"
      >
        <PenLine
          :size="18"
          aria-hidden="true"
        />新建记录
        <ChevronRight
          :size="18"
          aria-hidden="true"
        />
      </RouterLink>

      <RouterLink
        :to="{ path: '/tasks/new', query: { elder: elder.id } }"
        class="create-task-link"
      >
        <ListPlus
          :size="18"
          aria-hidden="true"
        />新建任务
        <ChevronRight
          :size="18"
          aria-hidden="true"
        />
      </RouterLink>

      <section
        class="profile-section"
        aria-labelledby="elder-profile-title"
      >
        <h2 id="elder-profile-title">
          基本资料
        </h2>
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
            <dd>{{ elder.lastUpdate }}</dd>
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
        class="profile-section"
        aria-labelledby="elder-tasks-title"
      >
        <div class="page-title-row">
          <h2 id="elder-tasks-title">
            相关任务
          </h2>
          <RouterLink :to="{ path: '/caregiver', query: { elder: elder.id } }">
            查看全部<ChevronRight
              :size="16"
              aria-hidden="true"
            />
          </RouterLink>
        </div>
        <FeedbackState
          :loading="tasks.isPending.value"
          :error="tasks.error.value"
          :empty="tasksReady && !related.length"
          empty-text="暂无可查看的相关任务"
          @retry="tasks.refetch()"
        />
        <ul
          v-if="related.length"
          class="elder-tasks"
          aria-label="相关任务"
        >
          <li
            v-for="task in related"
            :key="task.id"
          >
            <RouterLink
              :to="'/tasks/' + encodeURIComponent(task.id)"
              class="task-link"
            >
              <strong>{{ task.title }}</strong>
              <ChevronRight
                :size="18"
                aria-hidden="true"
              />
            </RouterLink>
            <p class="muted">
              {{ taskStatusLabels[task.status] || '未知状态' }} ·
              {{ task.assignee || '负责人未提供' }}
            </p>
            <p class="muted">
              到期：{{ task.dueAt || '未提供' }}
            </p>
            <RouterLink
              v-if="task.itemId"
              :to="'/timeline/' + encodeURIComponent(task.itemId)"
              class="timeline-link"
            >
              <History
                :size="17"
                aria-hidden="true"
              />事项回放
            </RouterLink>
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
.record-link,
.create-task-link {
  padding: 12px;
  margin: 16px 0;
  color: var(--hl-primary);
  background: var(--hl-primary-soft);
  border-radius: 6px;
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
