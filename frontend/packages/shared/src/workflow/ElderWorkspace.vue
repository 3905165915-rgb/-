<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listAll, type Row } from './model'
import { useWorkspaceScope } from './workspace-scope'
import { workspaceDate } from './workspace-action'
import ElderQuickRecord from './ElderQuickRecord.vue'
import ElderUnderstanding from './ElderUnderstanding.vue'
import ElderAssessment from './ElderAssessment.vue'
import ElderCareAdvice from './ElderCareAdvice.vue'
import ElderAutomation from './ElderAutomation.vue'
import ElderActivity from './ElderActivity.vue'
import './elder-workspace.css'
const props = defineProps<{ elderId: string; mobile?: boolean }>()
const scope = useWorkspaceScope()
const { active, management } = scope
const route = useRoute(),
  router = useRouter()
const tabs = [
  { key: 'today', label: '今日照护' },
  { key: 'understanding', label: '了解这位老人' },
  { key: 'records', label: '记录' },
  { key: 'assessment', label: '评估与安排' },
]
const section = ref('today')
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
  section.value = tabs.some((tab) => tab.key === query) ? query : 'today'
}
function select(value: string) {
  section.value = value
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
        !['completed', 'cancelled', 'not_done'].includes(String(row.status)),
    )
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
        <p v-if="!loading && !error && !tasks.length" class="muted">
          当前没有待办理任务。可记录本次观察，或查看评估与安排。
        </p>
        <ul class="workspace-task-list">
          <li v-for="task in tasks" :key="String(task.id)">
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
        <div class="workspace-actions">
          <button type="button" @click="select('records')">
            记一条本次观察</button
          ><button type="button" @click="select('understanding')">
            查看偏好与沟通方式
          </button>
        </div>
      </section>
      <ElderCareAdvice :key="elderId" :elder-id="elderId" :mobile="mobile" />
    </template>
    <ElderUnderstanding
      v-else-if="section === 'understanding'"
      :key="elderId"
      :elder-id="elderId"
      :record-path="mobile ? '/records/new' : '/workflows/records'"
    />
    <template v-else-if="section === 'records'">
      <ElderQuickRecord :key="elderId" :elder-id="elderId" /><ElderActivity
        :key="elderId"
        :elder-id="elderId"
        mode="api"
        :session="scope.owner"
      />
    </template>
    <template v-else-if="section === 'assessment'">
      <ElderAssessment :key="elderId" :elder-id="elderId" /><ElderAutomation
        v-if="management"
        :key="elderId"
        :elder-id="elderId"
      /><ElderCareAdvice :key="elderId" :elder-id="elderId" :mobile="mobile" />
    </template>
  </section>
  <p v-else role="status">
    照护工作区已关闭，请使用当前授权的工作人员账号重新进入。
  </p>
</template>
