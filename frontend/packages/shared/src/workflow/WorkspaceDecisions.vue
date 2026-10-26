<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { request, type Row } from './model'
import { object, rows } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import './elder-workspace.css'
const scope = useWorkspaceScope(),
  { active, management } = scope
const items = ref<Row[]>([]),
  error = ref(''),
  loading = ref(false)
let epoch = 0
const sections: Record<string, string> = {
  assessment: 'assessment',
  memory: 'understanding',
  understanding: 'understanding',
  care_advice: 'assessment',
  organising: 'records',
  followup: 'records',
  plan: 'assessment',
  task: 'today',
}
function location(item: Row) {
  return {
    path: '/elders/' + encodeURIComponent(String(item.elder_id)),
    query: {
      section: sections[String(item.kind)] || 'today',
      decision: String(item.object_id),
    },
  }
}
async function load() {
  const ticket = ++epoch
  if (!scope.valid() || !management) return
  loading.value = true
  error.value = ''
  try {
    const result = object(await request('/decisions/me'))
    if (ticket !== epoch || !scope.valid()) return
    const decisions = rows(result.items)
    if (
      decisions.some(
        (row) =>
          typeof row.elder_id !== 'string' ||
          typeof row.reason !== 'string' ||
          !Object.hasOwn(sections, String(row.kind)),
      )
    )
      throw new Error('主管待办字段异常，请刷新核对。')
    items.value = decisions
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
watch(active, (value) => {
  if (!value) {
    epoch++
    items.value = []
  }
})
onMounted(() => {
  void load()
  window.addEventListener('focus', load)
})
onBeforeUnmount(() => {
  epoch++
  window.removeEventListener('focus', load)
})
</script>
<template>
  <section
    v-if="active && management"
    class="elder-workspace"
  >
    <div class="workspace-panel">
      <header>
        <h3>需要我判断</h3>
        <button
          type="button"
          :disabled="loading"
          @click="load"
        >
          刷新判断事项
        </button>
      </header>
      <p>按具体事实核对老人资料、评估、反馈或记录安排。</p>
      <p
        v-if="error"
        role="alert"
        class="workspace-error"
      >
        {{ error }}
      </p>
      <p
        v-if="loading"
        role="status"
      >
        正在读取主管待办…
      </p>
      <p
        v-if="!loading && !error && !items.length"
        class="muted"
      >
        当前没有待判断事项。
      </p>
      <ul class="workspace-task-list">
        <li
          v-for="(item, index) in items"
          :key="String(item.kind) + String(item.object_id) + index"
        >
          <RouterLink :to="location(item)">
            <strong>{{ item.elder_name || item.elder_id }}</strong><span>进入关联栏目</span>
          </RouterLink>
          <p>{{ item.reason }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>
