<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Elder } from '../types'
import { useRoute, useRouter } from 'vue-router'
import { listAll, request, type Row } from './model'
import { useWorkspaceScope } from './workspace-scope'
import { localTime } from './workspace-time'
import { workspaceDate } from './workspace-action'
import ElderRecordEntry from './ElderRecordEntry.vue'
import ElderUnderstanding from './ElderUnderstanding.vue'
import ElderAssessment from './ElderAssessment.vue'
import ElderCareAdvice from './ElderCareAdvice.vue'
import ElderAutomation from './ElderAutomation.vue'
import ElderActivity from './ElderActivity.vue'
import CareArrangement from './CareArrangement.vue'
import CareFollowups from './CareFollowups.vue'
import CareGuidance from './CareGuidance.vue'
import { isTaskContent } from './care-arrangement'
import './elder-workspace.css'
const props = defineProps<{ elderId: string; mobile?: boolean; elder?: Elder }>()
const scope = useWorkspaceScope()
const { active, management } = scope
const route = useRoute(),
  router = useRouter()
const tabs = [
  { key: 'today', label: '今日照护' },
  { key: 'understanding', label: '了解他' },
  { key: 'records', label: '最近记录' },
  { key: 'profile', label: '基础资料' },
]
const section = ref('today')
const followupCount = ref<number | null>(null)
const guidanceRevision = ref(0)
function arrangementChanged() {
  guidanceRevision.value++
  void load()
}
const todayTasks = computed(() =>
  tasks.value.filter((task) => {
    const at = String(task.scheduled_at || task.due_at || '')
    return (
      Number.isFinite(Date.parse(at)) &&
      localTime(new Date(at)).slice(0, 10) ===
        localTime(new Date()).slice(0, 10)
    )
  }),
)
const tasks = ref<Row[]>([]),
  loading = ref(false),
  error = ref('')
let epoch = 0
function sync() {
  const query =
    typeof route.query.section === 'string'
      ? route.query.section
      : route.query.impression_id
        ? 'understanding'
        : 'today'
  section.value =
    query === 'assessment'
      ? query
      : tabs.some((tab) => tab.key === query)
        ? query
        : query === 'followups'
          ? 'today'
      : 'today'
}
function select(value: string) {
  void router.replace({ query: { ...route.query, section: value } })
}
async function load() {
  const ticket = ++epoch
  if (!scope.valid()) return
  loading.value = true
  error.value = ''
  try {
    const result = await listAll(
      '/tasks?elder_id=' + encodeURIComponent(props.elderId),
    )
    if (ticket !== epoch || !scope.valid()) return
    tasks.value = result.filter(
      (row) =>
        row.elder_id === props.elderId &&
        isTaskContent(row) &&
        !['completed', 'cancelled', 'not_done'].includes(String(row.status)),
    )
    try {
      const followups = (await request(
        '/followups?elder_id=' + encodeURIComponent(props.elderId),
      )) as { counts: { pending: number; review: number } }
      if (ticket === epoch && scope.valid())
        followupCount.value = followups.counts.pending + followups.counts.review
    } catch {
      if (ticket === epoch) followupCount.value = null
    }
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
watch(() => route.query, sync, { immediate: true })
watch(
  () => props.elderId,
  () => {
    tasks.value = []
    followupCount.value = null
    sync()
    void load()
  },
  { immediate: true },
)
watch(active, (value) => {
  if (!value) {
    epoch++
    tasks.value = []
  }
})
onBeforeUnmount(() => {
  epoch++
})
</script>
<template>
  <section v-if="active" class="elder-workspace" aria-label="老人照护工作区">
    <header class="workspace-actions">
      <span
        >今日待办 {{ loading ? '正在读取' : error ? '暂未读取' : todayTasks.length + ' 项' }} · 需要跟进
        {{ followupCount === null ? '暂未读取' : followupCount + ' 项' }}</span
      ><button v-if="management" type="button" @click="select('assessment')">
        制定安排
      </button>
    </header>
    <nav class="workspace-tabs" aria-label="老人照护栏目">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :aria-current="section === tab.key ? 'page' : undefined"
        :class="{ selected: section === tab.key }"
        @click="select(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>
    <template v-if="section === 'today'">
      <section class="workspace-panel">
        <header>
          <h3>今日照护</h3>
          <button type="button" :disabled="loading" @click="load">
            刷新任务
          </button>
        </header>
        <p>按已批准安排办理；本人当次意愿和执行前提仍须确认。</p>
        <p v-if="error" role="alert" class="workspace-error">
          {{ error }}
        </p>
        <p v-if="loading" role="status">正在读取照护安排…</p>
        <p v-if="!loading && !error && !todayTasks.length" class="muted">
          当前没有待办理任务。可记录本次观察，或查看评估与安排。
        </p>
        <ul class="workspace-task-list">
          <li v-for="task in todayTasks" :key="String(task.id)">
            <RouterLink
              :to="
                mobile
                  ? '/tasks/' + encodeURIComponent(String(task.id))
                  : {
                      path: '/tasks',
                      query: { task: String(task.id), elder: elderId },
                    }
              "
            >
              <strong>{{ task.title }}</strong
              ><span>截止：{{ workspaceDate(task.due_at) }}</span>
            </RouterLink>
            <p v-if="task.condition">执行前提：{{ task.condition }}</p>
            <p v-if="task.completion_criteria">
              完成标准：{{ task.completion_criteria }}
            </p>
          </li>
        </ul>
        <CareGuidance
          :elder-id="elderId"
          :manage="management"
          :refresh-key="guidanceRevision"
        />
        <CareFollowups
          :elder-id="elderId"
          :mobile="mobile"
        />
        <div class="workspace-actions">
          <button type="button" @click="select('records')">
            记一条本次观察</button
          ><button type="button" @click="select('understanding')">
            查看偏好与沟通方式
          </button>
        </div>
      </section>
      <ElderCareAdvice
        :key="elderId"
        :elder-id="elderId"
        :mobile="mobile"
        @changed="arrangementChanged"
      />
    </template>
    <ElderUnderstanding
      v-else-if="section === 'understanding'"
      :key="elderId"
      :elder-id="elderId"
      :record-path="mobile ? '/records/new' : '/workflows/records'"
    />
    <template v-else-if="section === 'records'">
      <ElderRecordEntry :key="elderId" :elder-id="elderId" />
      <details>
        <summary>完整照护过程</summary>
        <ElderActivity
          :key="elderId"
          :elder-id="elderId"
          mode="api"
          :session="scope.owner"
        />
      </details>
    </template>
    <section v-else-if="section === 'profile'" class="workspace-panel">
      <header>
        <div>
          <h3>基础资料</h3>
          <p>仅显示当前账号有权查看的资料；未提供内容保持待补全。</p>
        </div>
      </header>
      <dl v-if="elder" class="workspace-facts">
        <div><dt>姓名</dt><dd>{{ elder.name || '姓名未提供' }}</dd></div>
        <div><dt>床位</dt><dd>{{ elder.bedLabel || '床位未提供' }}</dd></div>
        <div><dt>入住状态</dt><dd>{{ elder.status || '状态待核实' }}</dd></div>
        <div><dt>风险状态</dt><dd>{{ elder.risk || '未提供评估结果' }}</dd></div>
        <div><dt>年龄</dt><dd>{{ elder.age === undefined ? '未提供' : elder.age + '岁' }}</dd></div>
        <div><dt>联系人</dt><dd>{{ elder.contact || '未提供' }}</dd></div>
        <div><dt>护理注意</dt><dd>{{ elder.notes || '未提供护理注意事项' }}</dd></div>
        <div v-if="elder.lastUpdate"><dt>最近更新</dt><dd>{{ workspaceDate(String(elder.lastUpdate)) }}</dd></div>
      </dl>
      <p v-else class="muted">当前资料尚未载入，请返回老人列表重试。</p>
      <slot name="profile-actions" />
    </section>
    <template v-else-if="section === 'assessment'">
      <CareArrangement
        v-if="management"
        :key="elderId"
        :elder-id="elderId"
        :mobile="mobile"
        @changed="arrangementChanged"
      />
      <details>
        <summary>评估与排期设置</summary>
        <ElderAssessment :key="elderId" :elder-id="elderId" /><ElderAutomation
          v-if="management"
          :key="elderId"
          :elder-id="elderId"
        /><ElderCareAdvice
          :key="elderId"
          :elder-id="elderId"
          :mobile="mobile"
          @changed="arrangementChanged"
        />
      </details>
    </template>
  </section>
  <p v-else role="status">
    照护工作区已关闭，请使用当前授权的工作人员账号重新进入。
  </p>
</template>
