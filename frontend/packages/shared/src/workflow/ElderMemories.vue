<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { readSession } from '../session'
import { listAll, display } from './model'
import { sameCareSession, careScenes } from './task-care-context'
import {
  parseElderMemories,
  parseMemoryHistory,
  memoryGroup,
  memoryCategories,
  memoryStates,
  expressors,
  type ElderMemory,
  type MemoryChange,
} from './elder-memories'
import WorkflowPanel from './WorkflowPanel.vue'
const props = defineProps<{ elderId: string; recordPath: string }>()
const memories = ref<ElderMemory[]>([])
const loading = ref(false),
  error = ref(''),
  query = ref(''),
  scene = ref('')
const history = ref<Record<string, MemoryChange[]>>({}),
  historyError = ref<Record<string, string>>({}),
  historyBusy = ref<Record<string, boolean>>({})
const editor = ref<{ id: string; action: string }>()
const editorPanel = ref<InstanceType<typeof WorkflowPanel>>()
const session = readSession()
const api =
  session?.mode === 'api' &&
  ['admin', 'supervisor', 'caregiver'].includes(session.role || '')
const management = ['admin', 'supervisor'].includes(session?.role || '')
let epoch = 0
function revoke() {
  epoch++
  memories.value = []
  history.value = {}
  historyError.value = {}
  historyBusy.value = {}
  editor.value = undefined
  loading.value = false
  error.value = '登录或权限已变化，请重新登录后查看。'
}
function checkSession() {
  if (!sameCareSession(session, readSession())) revoke()
}
function resetFilters() {
  query.value = ''
  scene.value = ''
}
async function load() {
  if (!api || !sameCareSession(session, readSession())) return
  const ticket = ++epoch,
    elder = props.elderId
  memories.value = []
  history.value = {}
  historyError.value = {}
  historyBusy.value = {}
  loading.value = true
  error.value = ''
  try {
    const value = await listAll(
      `/memories?elder_id=${encodeURIComponent(elder)}`,
    )
    if (ticket === epoch && sameCareSession(session, readSession()))
      memories.value = parseElderMemories(value, elder)
  } catch (failure) {
    if (ticket === epoch && sameCareSession(session, readSession()))
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
async function readHistory(memory: ElderMemory) {
  if (historyBusy.value[memory.id] || !sameCareSession(session, readSession()))
    return
  const ticket = epoch
  historyBusy.value[memory.id] = true
  historyError.value[memory.id] = ''
  try {
    const value = await listAll(
      `/memories/${encodeURIComponent(memory.id)}/history`,
    )
    if (ticket === epoch && sameCareSession(session, readSession()))
      history.value[memory.id] = parseMemoryHistory(value, memory)
  } catch {
    if (ticket === epoch && sameCareSession(session, readSession()))
      historyError.value[memory.id] =
        '历史版本读取失败，请重试；当前内容不代表完整历史。'
  } finally {
    if (ticket === epoch) historyBusy.value[memory.id] = false
  }
}
function edit(memory: ElderMemory, action: string) {
  if (editor.value && !editorPanel.value?.canClose()) return
  editor.value = { id: memory.id, action }
}
function closeEditor() {
  if (editorPanel.value?.canClose()) editor.value = undefined
}
const groups = computed(() => {
  const labels = {
    current: '当前习惯',
    temporary: '临时意愿',
    review: '待核实变化',
    history: '暂停、停用与历史',
  }
  return Object.entries(labels).map(([key, title]) => ({
    key,
    title,
    rows: memories.value.filter(
      (m) =>
        memoryGroup(m) === key &&
        (!scene.value ||
          m.scenes.includes(scene.value as keyof typeof careScenes)) &&
        (!query.value.trim() ||
          `${m.content} ${m.source.quote}`.includes(query.value.trim())),
    ),
  }))
})
watch(
  () => props.elderId,
  () => {
    editor.value = undefined
    query.value = ''
    scene.value = ''
    void load()
  },
  { immediate: true, flush: 'sync' },
)
onMounted(() => {
  window.addEventListener('hulao:unauthorized', revoke)
  window.addEventListener('storage', checkSession)
  window.addEventListener('focus', checkSession)
})
onBeforeUnmount(() => {
  epoch++
  window.removeEventListener('hulao:unauthorized', revoke)
  window.removeEventListener('storage', checkSession)
  window.removeEventListener('focus', checkSession)
})
</script>
<template>
  <section class="elder-memories" aria-label="已登记照护记忆">
    <header>
      <h2>照护记忆</h2>
      <button v-if="api" type="button" :disabled="loading" @click="load">
        刷新记忆
      </button>
    </header>
    <p>
      生活偏好与本人当次意愿分别保留。专业要求以正式照护计划为准，生活偏好不能覆盖专业限制。
    </p>
    <p v-if="!api">
      当前演示未连接记忆服务；请在服务器账号中查看已确认的来源与历史。
    </p>
    <template v-else>
      <div class="memory-filters">
        <label>搜索内容或依据<input v-model="query" type="search" /></label
        ><label
          >适用场景<select v-model="scene">
            <option value="">全部场景</option>
            <option v-for="(label, key) in careScenes" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        ><button
          type="button"
          @click="resetFilters"
        >
          重置筛选
        </button>
      </div>
      <p v-if="loading" role="status">正在读取当前老人记忆…</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
      <template v-else>
        <p v-if="!memories.length">
          暂无已登记记忆；可以继续人工记录与安排任务。
        </p>
        <p v-else-if="!groups.some((g) => g.rows.length)">
          筛选无结果，请调整条件。
        </p>
        <section
          v-for="group in groups.filter((g) => g.rows.length)"
          :key="group.key"
          class="memory-group"
        >
          <h3>
            {{ group.title }} <small>{{ group.rows.length }}项</small>
          </h3>
          <article
            v-for="memory in group.rows"
            :key="memory.id"
            :data-memory-id="memory.id"
          >
            <p>
              <strong>{{ memory.content }}</strong>
            </p>
            <p>
              {{ memoryCategories[memory.category] }} ·
              {{ memoryStates[memory.status] }} ·
              {{ memory.effective ? '当前有效' : '暂不可用于执行提示' }}
            </p>
            <p v-if="!memory.source_current" class="memory-warning">
              来源已变更或撤销，请重新核对；不能继续作为当前执行依据。
            </p>
            <p
              v-if="memory.review_due || memory.review_state === 'pending'"
              class="memory-warning"
            >
              需要人工复核。单次拒绝或临时意愿不会自动改写长期偏好；到期复核不等于偏好失效。
            </p>
            <p v-if="memory.refusal_count">
              已登记拒绝线索
              {{ memory.refusal_count }} 次，仅供复核，不作为效果结论。
            </p>
            <details>
              <summary>查看原文依据与适用范围</summary>
              <blockquote>{{ memory.source.quote }}</blockquote>
              <RouterLink
                :to="{
                  path: recordPath,
                  query: {
                    elder_id: elderId,
                    record_id: memory.source.record_id,
                    action: '/records/{record_id}',
                    read: '1',
                  },
                }"
                >打开来源记录当前版本</RouterLink
              >
              <p>
                以上引文保留第{{
                  memory.source.revision
                }}版快照；来源记录可能已有更正，请同时核对当前版本。
              </p>
              <dl>
                <dt>来源记录</dt>
                <dd>
                  {{ memory.source.record_id }} · 第{{
                    memory.source.revision
                  }}版 · {{ display(memory.source.field) }}
                </dd>
                <dt>表达者</dt>
                <dd>{{ expressors[memory.attributed_to] }}</dd>
                <dt>确认者与时间</dt>
                <dd>
                  {{ memory.confirmed_by || '尚未确认' }} ·
                  {{
                    memory.confirmed_at
                      ? display(memory.confirmed_at, 'confirmed_at')
                      : '尚未确认'
                  }}
                </dd>
                <dt>适用场景</dt>
                <dd>
                  {{ memory.scenes.map((s) => careScenes[s]).join('、') }}
                </dd>
                <dt>有效期</dt>
                <dd>
                  {{ display(memory.valid_from, 'valid_from') }} 起；{{
                    memory.expires_at
                      ? display(memory.expires_at, 'expires_at') + ' 止'
                      : '未设置结束时间'
                  }}
                </dd>
                <dt>建议复核时间</dt>
                <dd>
                  {{
                    memory.review_due_at
                      ? display(memory.review_due_at, 'review_due_at')
                      : '未设置'
                  }}
                </dd>
                <dt>记忆版本</dt>
                <dd>第{{ memory.revision }}版</dd>
              </dl>
            </details>
            <details
              @toggle="
                ($event.target as HTMLDetailsElement).open &&
                !history[memory.id] &&
                readHistory(memory)
              "
            >
              <summary>修订原因与历史版本</summary>
              <p v-if="historyBusy[memory.id]" role="status">正在读取历史…</p>
              <p v-if="historyError[memory.id]" role="alert">
                {{ historyError[memory.id] }}
              </p>
              <button
                v-if="historyError[memory.id]"
                type="button"
                @click="readHistory(memory)"
              >
                重试历史
              </button>
              <p v-if="history[memory.id]?.length === 0">暂无可查看的历史。</p>
              <ol>
                <li
                  v-for="change in history[memory.id] || []"
                  :key="change.revision"
                >
                  第{{ change.revision }}版 · {{ display(change.action) }} ·
                  {{ display(change.created_at, 'created_at') }}
                  <p>
                    操作人：{{ change.created_by }}；原因：{{
                      change.reason || '创建时未填写原因'
                    }}
                  </p>
                  <p v-if="change.before">
                    原内容：{{ change.before.content }}
                  </p>
                  <p>修订后：{{ change.after.content }}</p>
                </li>
              </ol>
            </details>
            <div v-if="management" class="memory-actions">
              <button
                type="button"
                @click="edit(memory, '/memories/{memory_id}/review')"
              >
                确认、复核或暂停</button
              ><button
                type="button"
                @click="edit(memory, '/memories/{memory_id}/revisions')"
              >
                修订并保留历史
              </button>
            </div>
          </article>
        </section>
      </template>
      <section v-if="editor" aria-label="记忆人工办理">
        <button type="button" @click="closeEditor">收起办理表单</button
        ><WorkflowPanel
          :key="editor.id + editor.action"
          ref="editorPanel"
          group="memories"
          title="记忆人工办理"
          :initial-action="editor.action"
          :context="{ elder_id: elderId, memory_id: editor.id }"
          @changed="load"
        />
      </section>
    </template>
  </section>
</template>
<style scoped>
.elder-memories {
  margin-block: 24px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--hl-border, #dce3e7);
  border-radius: 8px;
  color: #20282e;
  font-size: 16px;
}
header,
.memory-filters,
.memory-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
header {
  justify-content: space-between;
}
h2 {
  margin: 0;
  font-size: 20px;
}
h3 {
  font-size: 17px;
}
small {
  font-weight: 400;
  color: #5f6b73;
}
p,
dd,
li {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.memory-filters label {
  display: grid;
  gap: 6px;
  min-width: 0;
  flex: 1 1 160px;
}
button,
input,
select {
  box-sizing: border-box;
  max-width: 100%;
  min-height: 44px;
  padding: 8px;
  border: 1px solid #bbc8d0;
  border-radius: 6px;
  background: #fff;
  color: #20282e;
  font: inherit;
}
button {
  color: #1767cf;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
article {
  padding-block: 12px;
  border-top: 1px solid #dce3e7;
}
details {
  margin-block: 12px;
}
summary {
  min-height: 36px;
  color: #1767cf;
  cursor: pointer;
}
blockquote {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 3px solid #14765e;
  background: #f5f7f8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
dt {
  color: #5f6b73;
}
dd {
  margin: 4px 0 12px;
}
.memory-warning {
  color: #875100;
}
ol {
  padding-left: 20px;
}
:focus-visible {
  outline: 2px solid #1767cf;
  outline-offset: 2px;
}
</style>
