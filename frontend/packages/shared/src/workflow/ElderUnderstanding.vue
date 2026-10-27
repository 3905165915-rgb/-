<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { request, type Row } from './model'
import {
  object,
  rows,
  useWorkspaceAction,
  workspaceDate,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import ElderMemories from './ElderMemories.vue'
const props = defineProps<{ elderId: string; recordPath: string }>()
const scope = useWorkspaceScope()
const { active, management } = scope
const confirmed = ref<Row[]>([])
const observations = ref<Row[]>([])
const needsReview = ref<Row[]>([])
const content = ref<Record<string, string>>({})
const editing = ref('')
const reviewing = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const action = useWorkspaceAction(() => props.elderId, 'understanding')
const { pending, busy, error: saveError } = action
const groups = [
  { key: 'preference', label: '活动喜好' },
  { key: 'habit', label: '生活习惯' },
  { key: 'communication', label: '沟通方式' },
  { key: 'recent_changes', label: '近期变化' },
  { key: 'attention', label: '需要留意' },
]
let epoch = 0
function group(row: Row) {
  const value = String(row.understanding_group || row.category)
  if (
    ['recent_changes', 'recentChanges'].includes(value) ||
    ['temporary', 'temporary_wish', 'conflict'].includes(String(row.kind))
  )
    return 'recent_changes'
  if (['communication'].includes(value)) return 'communication'
  if (['habit', 'routine'].includes(value)) return 'habit'
  if (
    [
      'attention',
      'avoidance',
      'contraindication',
      'observation',
      'care_attention',
    ].includes(value)
  )
    return 'attention'
  return 'preference'
}
const grouped = computed(() =>
  groups.map((item) => ({
    ...item,
    confirmed: confirmed.value.filter((row) => group(row) === item.key),
    observations: observations.value.filter((row) => group(row) === item.key),
  })),
)
function citations(row: Row): Row[] {
  if (Array.isArray(row.evidence)) return rows(row.evidence)
  if (row.source && typeof row.source === 'object') {
    const source = object(row.source)
    return [
      {
        source_id: source.record_id,
        quote: source.quote,
        happened_at: source.captured_at,
      },
    ]
  }
  return []
}
async function load() {
  const ticket = ++epoch
  if (!scope.valid()) return
  loading.value = true
  error.value = ''
  try {
    const result = object(
      await request(
        '/elders/' + encodeURIComponent(props.elderId) + '/understanding',
      ),
    )
    if (ticket !== epoch || !scope.valid()) return
    if (result.elder_id !== props.elderId)
      throw new Error('了解资料与当前老人不匹配。')
    const nextConfirmed = rows(result.confirmed),
      nextObservations = rows(result.observations),
      nextReview = rows(result.needs_review)
    confirmed.value = nextConfirmed
    observations.value = nextObservations
    needsReview.value = nextReview
    notice.value = String(
      result.notice || '本人当次意愿优先。近期观察不替代已确认照护要求。',
    )
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function validate(value: unknown) {
  const result = object(value)
  const intended = pending.value?.body.decision
  if (
    !['adopt', 'reject'].includes(String(result.decision)) ||
    result.decision !== intended
  )
    throw new Error('决定回执异常，请重试原提交核实。')
  if (
    result.decision === 'adopt' &&
    object(result.memory).elder_id !== props.elderId
  )
    throw new Error('回执与当前老人不匹配。')
  return result
}
async function decide(row: Row, decision: 'adopt' | 'reject') {
  if (!management || !scope.valid() || busy.value || pending.value) return
  if (decision === 'adopt' && row.can_adopt !== true) return
  const body: Row = {
    expected_revision: row.revision,
    decision,
    note: '已核对来源原文，本人当次意愿优先',
  }
  if (decision === 'adopt' && editing.value === row.id) {
    if (!content.value[String(row.id)]?.trim()) {
      error.value = '请填写核对后的内容。'
      return
    }
    body.content = content.value[String(row.id)].trim()
  }
  const result = await action.submit(
    '/elders/' +
      encodeURIComponent(props.elderId) +
      '/understanding/' +
      encodeURIComponent(String(row.report_id)) +
      '/' +
      encodeURIComponent(String(row.id)) +
      '/decision',
    body,
    validate,
  )
  if (result && scope.valid()) {
    editing.value = ''
    await load()
  }
}
async function retry() {
  if (await action.retry(validate)) await load()
}
function editObservation(row: Row) {
  editing.value = String(row.id)
  content.value[String(row.id)] = String(row.text)
}
watch(
  () => props.elderId,
  () => {
    confirmed.value = []
    observations.value = []
    needsReview.value = []
    content.value = {}
    editing.value = ''
    reviewing.value = false
    void load()
  },
  { immediate: true },
)
watch(active, (value) => {
  if (!value) {
    epoch++
    confirmed.value = []
    observations.value = []
    needsReview.value = []
    reviewing.value = false
  }
})
onBeforeUnmount(() => {
  epoch++
})
defineExpose({ refresh: load })
</script>
<template>
  <section v-if="active" class="workspace-panel" aria-label="了解这位老人">
    <header>
      <div>
        <h3>了解这位老人</h3>
        <p>{{ notice }}</p>
      </div>
      <button type="button" :disabled="loading || busy" @click="load">
        刷新
      </button>
    </header>
    <section
      v-if="confirmed.length"
      class="workspace-panel"
      aria-label="照护要点"
    >
      <h4>先了解这几件事</h4>
      <ul>
        <li v-for="row in confirmed.slice(0, 5)" :key="String(row.id)">
          {{ row.content }}
        </li>
      </ul>
    </section>
    <details>
      <summary>查看分类资料、原文与逐项核对</summary>
      <p v-if="loading" role="status">正在读取已确认资料与近期观察…</p>
      <p v-if="error || saveError" role="alert" class="workspace-error">
        {{ error || saveError }}
      </p>
      <button v-if="pending" type="button" :disabled="busy" @click="retry">
        核实并重试原决定
      </button>
      <div class="understanding-groups">
        <section
          v-for="item in grouped"
          :key="item.key"
          class="understanding-group"
        >
          <h4>{{ item.label }}</h4>
          <h5>已确认</h5>
          <p v-if="!item.confirmed.length" class="muted">尚无已确认资料</p>
          <article
            v-for="row in item.confirmed"
            :key="String(row.id)"
            class="understanding-card confirmed"
          >
            <strong>{{ row.content }}</strong
            ><span class="workspace-badge">已人工确认</span>
            <details>
              <summary>查看原文依据</summary>
              <blockquote v-for="(source, i) in citations(row)" :key="i">
                {{ source.quote }}
                <footer>
                  {{ workspaceDate(source.happened_at) }}
                </footer>
              </blockquote>
            </details>
          </article>
          <h5>近期观察 · 尚待核实</h5>
          <p v-if="!item.observations.length" class="muted">暂无近期观察</p>
          <article
            v-for="row in item.observations"
            :key="String(row.id)"
            class="understanding-card"
          >
            <p>{{ row.text }}</p>
            <p class="workspace-warning">
              {{ row.label
              }}{{
                row.kind === 'conflict'
                  ? '；不同记录存在差异，请询问本人并补充观察'
                  : row.kind === 'temporary' || row.kind === 'temporary_wish'
                    ? '；临时意愿，只适用于当次情况'
                    : ''
              }}
            </p>
            <details>
              <summary>查看原文依据（{{ citations(row).length }} 条）</summary>
              <blockquote v-for="(source, i) in citations(row)" :key="i">
                {{ source.quote }}
                <footer>
                  {{ workspaceDate(source.happened_at) }}
                </footer>
              </blockquote>
            </details>
            <template v-if="management">
              <label v-if="editing === row.id"
                >核对后的内容<textarea
                  v-model="content[String(row.id)]"
                  rows="3"
                  maxlength="1000"
                  :disabled="busy || !!pending"
                />
              </label>
              <div class="workspace-actions">
                <button
                  v-if="row.can_adopt === true"
                  type="button"
                  :disabled="busy || !!pending"
                  @click="decide(row, 'adopt')"
                >
                  {{
                    editing === row.id ? '确认修改并采用' : '采用为已确认资料'
                  }}</button
                ><button
                  v-if="row.can_adopt === true && editing !== row.id"
                  type="button"
                  :disabled="busy || !!pending"
                  @click="editObservation(row)"
                >
                  修改后采用</button
                ><button
                  type="button"
                  :disabled="busy || !!pending"
                  @click="decide(row, 'reject')"
                >
                  不采用
                </button>
              </div>
              <p v-if="row.can_adopt !== true" class="muted">
                临时意愿、冲突、照护关注或已变化依据不能直接采用为长期偏好。
              </p>
            </template>
          </article>
        </section>
      </div>
      <div v-if="needsReview.length">
        <p class="workspace-warning">
          {{ needsReview.length }} 项既有资料需要复核，未计入当前已确认资料。
        </p>
        <button type="button" @click="reviewing = !reviewing">
          {{ reviewing ? '收起资料复核' : '在本页办理既有资料复核' }}</button
        ><ElderMemories
          v-if="reviewing"
          :key="elderId"
          :elder-id="elderId"
          :record-path="recordPath"
        />
      </div>
    </details>
  </section>
</template>
