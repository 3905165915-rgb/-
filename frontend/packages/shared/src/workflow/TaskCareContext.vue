<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { readSession, type AppMode, type FrontendSession } from '../session'
import { request } from './model'
import {
  careScenes,
  contextDisplayLimit,
  createTaskCareContext,
  sameCareSession,
} from './task-care-context'

const props = defineProps<{
  taskId: string
  mode: AppMode
  session: FrontendSession | null
}>()
const context = createTaskCareContext({
  request,
  session: () => {
    const live = readSession()
    return sameCareSession(live, props.session) ? live : null
  },
})
const state = context.state
const task = computed(() => state.value.task.data)
const resident = computed(() => state.value.resident.data)
const source = computed(() => state.value.source.data)
const references = computed(() => state.value.references.data)
const memories = computed(() => state.value.memories.data)
const categories: Record<string, string> = {
  stable_preference: '稳定偏好',
  temporary_wish: '临时意愿',
  communication: '沟通方式',
}
const attributions: Record<string, string> = {
  elder: '老人本人',
  family: '家属',
  staff: '工作人员',
  unknown: '归属未核实',
}
const statuses: Record<string, string> = {
  pending: '待执行',
  in_progress: '执行中',
  overdue: '已逾期',
  not_done: '未执行',
  completed: '已完成',
  cancelled: '已取消',
  active: '在院',
  out: '外出',
  discharged: '已离院',
  confirmed: '已确认',
  corrected: '已更正',
  candidate: '候选',
  review_required: '待复核',
  retired: '已停用',
  rejected: '已驳回',
}
const reviewReasons: Record<string, string> = {
  memory_revision_changed: '记忆版本已变化',
  scene_no_longer_applicable: '场景已不适用',
  memory_missing: '记忆已不存在',
  memory_elder_mismatch: '记忆老人不匹配',
  memory_not_confirmed: '记忆当前未确认',
  memory_source_changed: '来源已更正或变化',
  memory_not_yet_effective: '尚未生效',
  memory_expired: '已到期',
  memory_observation_only: '仅为观察信息',
  memory_elder_inactive: '老人当前不适用',
}
function refresh() {
  void context.load(props.taskId, props.mode)
}
function changeScene(event: Event) {
  void context.selectScene((event.target as HTMLSelectElement).value)
}
function revoke() {
  context.clear('denied')
}
function checkSession() {
  if (props.mode === 'api' && !sameCareSession(readSession(), props.session))
    revoke()
}
watch(
  () => [
    props.taskId,
    props.mode,
    props.session?.mode,
    props.session?.accountKey,
    props.session?.role,
    props.session?.userId,
    props.session?.accessToken,
  ],
  refresh,
  { immediate: true, flush: 'sync' },
)
onMounted(() => {
  window.addEventListener('hulao:unauthorized', revoke)
  window.addEventListener('focus', checkSession)
  window.addEventListener('storage', checkSession)
})
onBeforeUnmount(() => {
  context.clear()
  window.removeEventListener('hulao:unauthorized', revoke)
  window.removeEventListener('focus', checkSession)
  window.removeEventListener('storage', checkSession)
})
</script>

<template>
  <section
    class="task-care-context"
    aria-label="任务照护依据"
    :aria-busy="state.task.status === 'loading'"
  >
    <header class="tcc-header">
      <h2>任务照护依据</h2>
      <button
        v-if="mode === 'api' && state.task.status !== 'denied'"
        type="button"
        :disabled="state.task.status === 'loading'"
        @click="refresh"
      >
        刷新依据
      </button>
    </header>
    <p
      v-if="state.task.status === 'demo'"
      class="tcc-muted"
      role="status"
    >
      演示模式不查询服务器照护记忆。
    </p>
    <p
      v-else-if="state.task.status === 'denied'"
      class="tcc-error"
      role="alert"
    >
      当前身份无权查看或登录已失效，任务照护依据已清除。请重新登录或联系主管。
    </p>
    <p
      v-else-if="state.task.status === 'loading'"
      role="status"
    >
      正在读取任务详情…
    </p>
    <p
      v-else-if="state.task.status === 'error'"
      class="tcc-error"
      role="alert"
    >
      {{ state.task.message }}
    </p>
    <p
      v-else-if="state.task.status === 'empty'"
      role="status"
    >
      未找到任务，无法查询照护依据。
    </p>
    <template v-else-if="task">
      <h3 class="tcc-task-title">
        {{ task.title }}
      </h3>
      <dl class="tcc-meta">
        <dt>任务</dt>
        <dd>
          {{ task.id }} · 版本 {{ task.revision }} ·
          {{ statuses[task.status] || task.status }}
        </dd>
        <dt>老人</dt>
        <dd>
          <template v-if="resident">
            {{ resident.name }} · {{ resident.id }} ·
            {{ resident.status === 'pending' ? '待入住' : statuses[resident.status] || resident.status
            }}<span v-if="resident.bed_id">
              · 床位编号 {{ resident.bed_id }}</span>
          </template>
          <span v-else>{{ task.elder_id }} ·
            {{
              state.resident.status === 'loading'
                ? '正在读取老人资料…'
                : '老人资料未载入'
            }}</span>
        </dd>
        <dt>负责人</dt>
        <dd>{{ task.assigned_to || '未分配' }}</dd>
        <dt>截止时间</dt>
        <dd>{{ task.due_at || '未提供' }}</dd>
        <dt>执行条件</dt>
        <dd>{{ task.condition || '未提供' }}</dd>
      </dl>
      <p
        v-if="state.resident.status === 'error'"
        class="tcc-error"
        role="alert"
      >
        {{ state.resident.message }}
      </p>

      <section
        class="tcc-band"
        aria-label="任务来源"
      >
        <h3>任务来源</h3>
        <p v-if="task.source_plan_id">
          照护计划 {{ task.source_plan_id }} · 版本
          {{ task.source_plan_revision ?? '未提供' }} · 条目
          {{ task.plan_item_key || '未提供' }}
        </p>
        <p
          v-if="state.source.status === 'loading'"
          role="status"
        >
          正在读取来源记录…
        </p>
        <p
          v-else-if="state.source.status === 'error'"
          class="tcc-error"
          role="alert"
        >
          来源记录 {{ task.source_record_id }}：{{ state.source.message }}
        </p>
        <template v-else-if="source">
          <p>
            正式记录 {{ source.id }} · 当前版本 {{ source.revision }} ·
            {{ statuses[source.status] || source.status }}
          </p>
          <p class="tcc-muted">
            以下为来源记录当前已核对的观察；记录内容不等于任务已完成。
          </p>
          <ul
            v-if="source.observations.length"
            class="tcc-observations"
          >
            <li
              v-for="(observation, index) in source.observations.slice(
                0,
                contextDisplayLimit,
              )"
              :key="index"
            >
              {{ observation }}
            </li>
          </ul>
          <p
            v-else
            class="tcc-muted"
          >
            来源记录未提供已核对的观察。
          </p>
          <p
            v-if="source.observations.length > contextDisplayLimit"
            class="tcc-muted"
          >
            共 {{ source.observations.length }} 项观察，此处显示前
            {{ contextDisplayLimit }} 项。
          </p>
          <details v-if="source.raw_text">
            <summary>原始录入（保留原文，仅供追溯）</summary>
            <blockquote>{{ source.raw_text }}</blockquote>
          </details>
        </template>
        <p
          v-else-if="!task.source_plan_id"
          class="tcc-muted"
        >
          任务未关联来源记录或照护计划。
        </p>
      </section>

      <section
        class="tcc-band"
        aria-label="场景适用的确认记忆"
      >
        <h3>场景适用的确认记忆</h3>
        <label class="tcc-scene">服务场景
          <select
            :value="state.scene"
            aria-label="服务场景"
            @change="changeScene"
          >
            <option value="">请选择场景</option>
            <option
              v-for="(label, value) in careScenes"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select>
        </label>
        <p
          v-if="!state.scene"
          class="tcc-muted"
          role="status"
        >
          尚未选择场景，未查询记忆。
        </p>
        <p
          v-else-if="state.memories.status === 'loading'"
          role="status"
        >
          正在读取所选场景记忆…
        </p>
        <div
          v-else-if="state.memories.status === 'error'"
          role="alert"
        >
          <p class="tcc-error">
            {{ state.memories.message }}
          </p>
          <button
            type="button"
            @click="context.selectScene(state.scene)"
          >
            重试场景查询
          </button>
        </div>
        <p
          v-else-if="state.memories.status === 'empty'"
          role="status"
        >
          所选场景暂无当前有效的确认记忆。
        </p>
        <p
          v-if="memories"
          class="tcc-muted"
        >
          查询场景：{{ careScenes[memories.scene] }} · 服务器核验时间：{{
            memories.as_of
          }}
        </p>
        <ul
          v-if="memories?.memories.length"
          class="tcc-list"
        >
          <li
            v-for="memory in memories.memories.slice(0, contextDisplayLimit)"
            :key="memory.id"
          >
            <p>
              <strong>{{ memory.content }}</strong>
            </p>
            <p class="tcc-muted">
              {{ memory.id }} · 版本 {{ memory.revision }} ·
              {{ categories[memory.category] }} · 已确认、当前有效
            </p>
            <p>
              归属：{{ attributions[memory.attributed_to] }} · 确认人
              {{ memory.confirmed_by }} · {{ memory.confirmed_at }}
            </p>
            <p>
              生效：{{ memory.valid_from }} · 到期：{{
                memory.expires_at || '未设置'
              }}
            </p>
            <p
              v-if="memory.review_due_at"
              :class="memory.review_due ? 'tcc-warning' : 'tcc-muted'"
            >
              复核提醒：{{ memory.review_due_at
              }}{{ memory.review_due ? '（提醒已到期，仍需人工核对）' : '' }}
            </p>
            <p>
              来源 {{ memory.source.record_id }} · 版本
              {{ memory.source.revision }} ·
              {{
                memory.source.field === 'observations'
                  ? '已核对观察'
                  : '原始录入'
              }}
              · 当前来源匹配
            </p>
            <blockquote>{{ memory.source.quote }}</blockquote>
            <details>
              <summary>来源快照 · {{ memory.source.captured_at }}</summary>
              <p class="tcc-muted">
                当时记录状态：{{
                  statuses[memory.source.record_status] ||
                    memory.source.record_status
                }}
              </p>
              <blockquote>{{ memory.source.snapshot_text }}</blockquote>
            </details>
          </li>
        </ul>
        <p
          v-if="memories && memories.memories.length > contextDisplayLimit"
          class="tcc-muted"
        >
          共 {{ memories.memories.length }} 条，此处显示前
          {{ contextDisplayLimit }} 条。
        </p>
        <p class="tcc-muted">
          场景由工作人员选择，仍须核对本次服务与老人当前意愿。查询结果不代表任务已采用，也不代表医学安全或专业计划批准。
        </p>
      </section>

      <section
        class="tcc-band"
        aria-label="任务已采用依据"
      >
        <h3>任务已采用依据</h3>
        <p
          v-if="state.references.status === 'loading'"
          role="status"
        >
          正在核验采用关系…
        </p>
        <p
          v-else-if="state.references.status === 'error'"
          class="tcc-error"
          role="alert"
        >
          采用关系{{ state.references.message }}
        </p>
        <template v-if="references">
          <p class="tcc-muted">
            任务版本 {{ references.task_revision }} · 服务器核验时间：{{
              references.as_of
            }}
          </p>
          <p
            v-if="references.historical_only"
            class="tcc-muted"
          >
            任务已结束，以下仅为历史依据，不产生新的执行要求。
          </p>
          <p
            v-else-if="references.needs_review"
            class="tcc-warning"
            role="status"
          >
            存在需人工核对的采用依据。
          </p>
          <p
            v-if="!references.references.length"
            role="status"
          >
            任务尚无已采用的记忆依据。
          </p>
          <ul
            v-else
            class="tcc-list"
          >
            <li
              v-for="reference in references.references.slice(
                0,
                contextDisplayLimit,
              )"
              :key="reference.id"
            >
              <p>
                <strong>{{ reference.snapshot.content }}</strong>
              </p>
              <p class="tcc-muted">
                {{ reference.id }} · 记忆 {{ reference.memory_id }} · 采用版本
                {{ reference.memory_revision }} ·
                {{ careScenes[reference.scene] }} ·
                {{
                  reference.status === 'active' ? '采用关系未撤回' : '已撤回'
                }}
              </p>
              <p>
                采用人 {{ reference.adopted_by }} · {{ reference.adopted_at }} ·
                理由：{{ reference.reason }}
              </p>
              <p v-if="reference.status === 'withdrawn'">
                撤回人 {{ reference.withdrawn_by || '未提供' }} ·
                {{ reference.withdrawn_at || '未提供' }} · 理由：{{
                  reference.withdrawal_reason || '未提供'
                }}
              </p>
              <dl class="tcc-meta">
                <dt>采用时归属</dt>
                <dd>
                  {{ attributions[reference.snapshot.attributed_to] }} ·
                  {{ categories[reference.snapshot.category] }}
                </dd>
                <dt>采用时确认</dt>
                <dd>
                  {{ reference.snapshot.confirmed_by }} ·
                  {{ reference.snapshot.confirmed_at }}
                </dd>
                <dt>采用时期限</dt>
                <dd>
                  {{ reference.snapshot.valid_from }} 至
                  {{ reference.snapshot.expires_at || '未设置到期' }}
                </dd>
                <dt>当前核验</dt>
                <dd>
                  版本 {{ reference.current.memory_revision ?? '不存在' }} ·
                  {{
                    reference.current.memory_status
                      ? statuses[reference.current.memory_status] ||
                        reference.current.memory_status
                      : '无当前状态'
                  }}
                  ·
                  {{
                    reference.current.effective ? '当前有效' : '当前不可用'
                  }}
                  ·
                  {{
                    reference.current.source_current ? '来源匹配' : '来源不匹配'
                  }}
                </dd>
              </dl>
              <p
                v-if="reference.current.outdated || reference.needs_review"
                class="tcc-warning"
              >
                当前依据已变化{{
                  reference.needs_review ? '，需人工核对' : ''
                }}：{{
                  reference.current.reasons
                    .map((reason) => reviewReasons[reason] || reason)
                    .join('；') || '请刷新核对当前状态'
                }}
              </p>
              <p
                v-if="reference.current.review_due"
                class="tcc-warning"
              >
                当前复核提醒已到期。
              </p>
              <p>
                采用时来源 {{ reference.snapshot.source.record_id }} · 版本
                {{ reference.snapshot.source.revision }} ·
                {{
                  reference.snapshot.source.field === 'observations'
                    ? '已核对观察'
                    : '原始录入'
                }}
              </p>
              <blockquote>{{ reference.snapshot.source.quote }}</blockquote>
              <details>
                <summary>
                  采用时来源快照 · {{ reference.snapshot.source.captured_at }}
                </summary>
                <blockquote>
                  {{ reference.snapshot.source.snapshot_text }}
                </blockquote>
              </details>
            </li>
          </ul>
          <p
            v-if="references.references.length > contextDisplayLimit"
            class="tcc-muted"
          >
            共 {{ references.references.length }} 条采用关系，此处显示前
            {{ contextDisplayLimit }} 条。
          </p>
        </template>
        <p class="tcc-muted">
          采用关系与当时快照仅记录人工选择的依据，不证明服务已完成。未撤回不代表当前仍有效。
        </p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.task-care-context {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  margin: 16px 0;
  padding: 16px;
  border-block: 1px solid var(--hl-border, #dce3e7);
  background: var(--hl-surface, #fff);
  color: var(--hl-ink, #20282e);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.tcc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.task-care-context h2 {
  margin: 0;
  font-size: 18px;
}
.task-care-context h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.task-care-context p {
  margin: 8px 0;
}
.tcc-task-title {
  margin-top: 16px !important;
}
.tcc-band {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--hl-border, #dce3e7);
}
.tcc-meta {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  gap: 6px 12px;
  margin: 12px 0;
}
.tcc-meta dt {
  color: var(--hl-muted, #5f6b73);
}
.tcc-meta dd {
  margin: 0;
  min-width: 0;
}
.tcc-scene {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.task-care-context select,
.task-care-context button {
  box-sizing: border-box;
  max-width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--hl-border, #dce3e7);
  border-radius: 6px;
  background: var(--hl-surface, #fff);
  color: var(--hl-primary, #1767cf);
  font: inherit;
}
.task-care-context select {
  min-width: 160px;
  color: var(--hl-ink, #20282e);
}
.task-care-context button,
.task-care-context summary {
  cursor: pointer;
}
.task-care-context button:disabled {
  opacity: 0.6;
  cursor: wait;
}
.task-care-context :focus-visible {
  outline: 2px solid var(--hl-primary, #1767cf);
  outline-offset: 2px;
}
.tcc-list {
  padding: 0;
  margin: 0;
  list-style: none;
}
.tcc-list > li {
  padding: 12px 0;
  border-bottom: 1px solid var(--hl-border, #dce3e7);
}
.tcc-observations {
  padding-left: 20px;
}
.task-care-context blockquote {
  margin: 10px 0;
  padding-left: 12px;
  border-left: 2px solid var(--hl-border, #dce3e7);
  white-space: pre-wrap;
}
.task-care-context details {
  margin: 8px 0;
}
.task-care-context summary {
  color: var(--hl-primary, #1767cf);
}
.tcc-muted {
  color: var(--hl-muted, #5f6b73);
}
.tcc-error {
  color: var(--hl-danger, #be3545);
}
.tcc-warning {
  color: var(--hl-warning, #946000);
}
@media (max-width: 420px) {
  .task-care-context {
    padding: 12px;
  }
  .tcc-meta {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .tcc-meta dd {
    margin-bottom: 6px;
  }
}
</style>
