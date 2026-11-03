<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { beijingDay } from '../demo-metrics'
import { request, type Row } from './model'
import { date, localTime } from './workspace-time'
import {
  object,
  useWorkspaceAction,
  workspaceStorageKey,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import './elder-workspace.css'
import {
  careHintScenes,
  careHintStatusLabels,
  careReminderOccasions,
  careReminderStatusLabels,
  careGuidanceActions,
  guidanceForScene,
  validateCareGuidanceUpdate,
  validateCareGuidanceList,
} from './care-arrangement'

const props = defineProps<{
  elderId: string
  scene?: string
  manage?: boolean
  refreshKey?: number
}>()
const scope = useWorkspaceScope()
const { active } = scope
const items = ref<Row[]>([]),
  loading = ref(false),
  error = ref(''),
  notice = ref('')
const query = ref(''),
  status = ref(''),
  open = ref(''),
  kind = ref('')
const reason = ref(''),
  observation = ref(''),
  response = ref('unclear'),
  happened = ref(localTime(new Date()))
const draftError = ref('')
const drafts = ref<Record<string, Row>>({})
const today = ref(beijingDay(Date.now()))
const action = useWorkspaceAction(() => props.elderId, 'care-guidance')
const { busy, pending, error: saveError } = action
const draftKey = computed(() =>
  workspaceStorageKey(scope.owner, props.elderId, 'care-guidance-text'),
)
const managing = computed(() => props.manage && scope.management)
const visible = computed(() =>
  items.value.filter((row) => {
    if (!managing.value) {
      if (row.content_type === 'routine_hint' && row.status !== 'enabled')
        return false
      if (
        row.content_type === 'one_off_reminder' &&
        (row.status !== 'active' || row.service_date !== today.value)
      )
        return false
      if (!guidanceForScene(row, props.scene)) return false
    }
    return (
      (!status.value || row.status === status.value) &&
      (!query.value.trim() ||
        `${row.title} ${row.instruction || row.record_what || ''}`.includes(
          query.value.trim(),
        ))
    )
  }),
)
function label(row: Row): string {
  return (
    (row.content_type === 'routine_hint'
      ? careHintStatusLabels[
          String(row.status) as keyof typeof careHintStatusLabels
        ]
      : careReminderStatusLabels[String(row.status)]) || '状态待核实'
  )
}
let epoch = 0,
  restoring = false
function preserve() {
  if (restoring || !scope.valid()) return false
  try {
    if (open.value)
      drafts.value[open.value] = {
        kind: kind.value,
        reason: reason.value,
        observation: observation.value,
        response: response.value,
        happened: happened.value,
      }
    sessionStorage.setItem(
      draftKey.value,
      JSON.stringify({ open: open.value, drafts: drafts.value }),
    )
    draftError.value = ''
    return true
  } catch {
    draftError.value = '本次回应或调整说明暂存失败，请保持页面打开。'
    return false
  }
}
watch([open, kind, reason, observation, response, happened], preserve, {
  flush: 'sync',
})
async function load() {
  const ticket = ++epoch
  items.value = []
  if (!scope.valid() || !props.elderId) return
  loading.value = true
  error.value = ''
  try {
    const value = await request(
      `/elders/${encodeURIComponent(props.elderId)}/care-guidance`,
    )
    if (ticket === epoch && scope.valid())
      items.value = validateCareGuidanceList(value, props.elderId)
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = `照护提示暂未读取，可能尚未接入；可继续记录事实。${failure instanceof Error ? failure.message : ''}`
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function begin(row: Row, value: string) {
  if (busy.value || pending.value || !scope.valid()) return
  if (!preserve()) return
  restoring = true
  open.value = String(row.id)
  kind.value = value
  const draft = drafts.value[open.value]
  reason.value = draft?.kind === value ? String(draft.reason) : ''
  observation.value = draft?.kind === value ? String(draft.observation) : ''
  response.value = draft?.kind === value ? String(draft.response) : 'unclear'
  happened.value =
    draft?.kind === value
      ? String(draft.happened)
      : localTime(new Date()).slice(0, 16)
  restoring = false
  preserve()
}
function close() {
  if (busy.value || pending.value) return
  if (!preserve()) return
  open.value = ''
  notice.value = '填写内容保留在本机，重新打开可继续编辑。'
}
function validate(value: unknown) {
  const attempt = pending.value
  if (!attempt) throw new Error('原提交凭证缺失，请核实。')
  const recorded = attempt.path.endsWith('/record')
  const expectedId = decodeURIComponent(attempt.path.split('/').at(-2) || '')
  return validateCareGuidanceUpdate(
    value,
    props.elderId,
    expectedId,
    Number(attempt.body.expected_revision),
    recorded ? 'recorded' : String(attempt.body.status),
    recorded,
  )
}
async function completed(row: Row | null) {
  if (!row || !scope.valid()) return
  restoring = true
  delete drafts.value[String(row.id)]
  open.value = ''
  reason.value = ''
  observation.value = ''
  response.value = 'unclear'
  kind.value = ''
  restoring = false
  preserve()
  notice.value =
    row.status === 'recorded'
      ? '本次回应已保存为正式记录，不生成任务或长期习惯。'
      : '服务端已确认提示状态变更。'
  await load()
}
async function retry() {
  await completed(await action.retry(validate))
}
async function send(row: Row) {
  if (!scope.valid() || busy.value || pending.value || !preserve()) return
  error.value = ''
  try {
    const record = kind.value === 'record'
    if (
      record &&
      (row.content_type !== 'one_off_reminder' ||
        row.status !== 'active' ||
        row.service_date !== beijingDay(Date.now()))
    )
      throw new Error('本次提醒已变化或到期，请重新读取。')
    if (
      !record &&
      !careGuidanceActions(row, scope.management).includes(kind.value)
    )
      throw new Error('当前状态或权限不允许此操作。')
    if (record && !observation.value.trim())
      throw new Error('请记录实际询问和回应，不要求老人同意参加。')
    if (!record && !reason.value.trim())
      throw new Error('请填写本次调整或确认的说明。')
    const body = record
      ? {
          expected_revision: row.revision,
          response: response.value,
          observation: observation.value.trim(),
          happened_at: date(happened.value),
        }
      : {
          expected_revision: row.revision,
          status: kind.value,
          reason: reason.value.trim(),
        }
    await completed(
      await action.submit(
        `/elders/${encodeURIComponent(props.elderId)}/care-guidance/${encodeURIComponent(String(row.id))}/${record ? 'record' : 'status'}`,
        body,
        validate,
      ),
    )
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : '保存失败，请保留内容。'
  }
}
watch(
  () => [props.elderId, props.refreshKey],
  () => {
    restoring = true
    open.value = ''
    kind.value = ''
    reason.value = ''
    observation.value = ''
    response.value = 'unclear'
    happened.value = localTime(new Date()).slice(0, 16)
    notice.value = ''
    draftError.value = ''
    drafts.value = {}
    try {
      const raw = sessionStorage.getItem(draftKey.value)
      if (raw) {
        const draft = object(JSON.parse(raw))
        if (typeof draft.open !== 'string') throw new Error('invalid')
        const stored = object(draft.drafts)
        for (const [id, value] of Object.entries(stored)) {
          const fields = object(value)
          for (const field of [
            'kind',
            'reason',
            'observation',
            'response',
            'happened',
          ])
            if (typeof fields[field] !== 'string') throw new Error('invalid')
          drafts.value[id] = fields
        }
        const fields = drafts.value[draft.open]
        if (draft.open && !fields) throw new Error('invalid')
        if (fields) {
          open.value = draft.open
          kind.value = String(fields.kind)
          reason.value = String(fields.reason)
          observation.value = String(fields.observation)
          response.value = String(fields.response)
          happened.value = String(fields.happened)
        }
      }
    } catch {
      draftError.value = '本机编辑内容无法完整恢复，请保留页面并核对。'
    }
    restoring = false
    void load()
  },
  { immediate: true },
)
watch(scope.active, (value) => {
  if (!value) {
    epoch++
    items.value = []
    open.value = ''
  }
})
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    today.value = beijingDay(Date.now())
  }, 30000)
})
onBeforeUnmount(() => {
  epoch++
  clearInterval(timer)
})
</script>

<template>
  <aside
    v-if="active"
    class="workspace-panel care-guidance"
    aria-label="生活照护提示与本次提醒"
  >
    <header class="workspace-actions">
      <h4>
        {{ managing ? '管理生活照护提示与本次提醒' : '生活照护提示与本次提醒' }}
      </h4>
      <button type="button" :disabled="loading || busy" @click="load">
        刷新提示
      </button>
    </header>
    <p class="muted">
      日常提示不要求每次打卡；本次意愿优先，提示与提醒均不计入任务完成率或逾期数。
    </p>
    <div v-if="managing" class="workspace-actions">
      <label>搜索提示<input v-model="query" type="search" /></label>
      <label
        >提示状态<select v-model="status">
          <option value="">全部</option>
          <option
            v-for="(name, key) in {
              ...careHintStatusLabels,
              ...careReminderStatusLabels,
            }"
            :key="key"
            :value="key"
          >
            {{ name }}
          </option>
        </select></label
      >
    </div>
    <p v-if="loading" role="status">正在读取生活照护提示…</p>
    <p
      v-if="error || saveError || draftError"
      role="alert"
      class="workspace-error"
    >
      {{ error || saveError || draftError }}
    </p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="pending" class="workspace-warning">
      上次处理结果待核实，请重试原提交。
    </p>
    <button v-if="pending" type="button" :disabled="busy" @click="retry">
      核实上次提示操作
    </button>
    <p v-if="!loading && !error && !visible.length" class="muted">
      当前没有符合条件的有效提示或本次提醒。
    </p>
    <article
      v-for="row in visible"
      :key="String(row.id)"
      class="understanding-card"
    >
      <strong>{{ row.title }}</strong
      ><span class="workspace-badge">{{ label(row) }}</span>
      <template v-if="row.content_type === 'routine_hint'">
        <p>
          场景：{{ careHintScenes[row.scene as keyof typeof careHintScenes] }}
        </p>
        <p>{{ row.instruction }}</p>
      </template>
      <template v-else>
        <p>
          {{ row.service_date }} ·
          {{
            careReminderOccasions[
              row.occasion as keyof typeof careReminderOccasions
            ]
          }}
        </p>
        <p>需要记录什么：{{ row.record_what }}</p>
      </template>
      <p v-if="row.condition" class="workspace-warning">
        适用前提：{{ row.condition }}；不满足时请报告调整。
      </p>
      <div class="workspace-actions">
        <button
          v-if="
            row.content_type === 'one_off_reminder' &&
            row.status === 'active' &&
            row.service_date === today
          "
          type="button"
          :disabled="busy || !!pending"
          @click="begin(row, 'record')"
        >
          记录本次回应
        </button>
        <button
          v-for="next in careGuidanceActions(row, !!managing)"
          :key="next"
          type="button"
          :disabled="busy || !!pending"
          @click="begin(row, next)"
        >
          {{
            next === 'enabled'
              ? '人工确认启用'
              : next === 'needs_adjustment'
                ? '报告需调整'
                : next === 'disabled'
                  ? '停用提示'
                  : next === 'cancelled'
                    ? '取消本次提醒'
                    : '退回待确认'
          }}
        </button>
      </div>
      <form v-if="open === row.id" @submit.prevent="send(row)">
        <fieldset :disabled="busy || !!pending || loading">
          <template v-if="kind === 'record'">
            <label
              >老人本次回应<select v-model="response" aria-label="老人本次回应">
                <option value="willing">本人愿意参加</option>
                <option value="alternative">选择其他活动</option>
                <option value="rest">想休息</option>
                <option value="declined">不愿意参加</option>
                <option value="unclear">暂未得到明确回应</option>
              </select></label
            >
            <label
              >实际询问与回应<textarea
                v-model="observation"
                required
                maxlength="2000"
                rows="3"
                placeholder="如实记录询问、回应及调整，不以同意参加作为完成要求。"
              />
            </label>
            <label
              >实际发生时间（北京时间）<input
                v-model="happened"
                type="datetime-local"
                required
            /></label>
          </template>
          <label v-else
            >处理说明<textarea
              v-model="reason"
              required
              maxlength="2000"
              rows="2"
            />
          </label>
          <button type="submit">
            {{
              kind === 'record' ? '保存本次实际记录' : '确认状态变更'
            }}</button
          ><button type="button" @click="close">收起并保留填写</button>
        </fieldset>
      </form>
    </article>
  </aside>
</template>
