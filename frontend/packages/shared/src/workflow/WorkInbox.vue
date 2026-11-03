<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { request, type Row } from './model'
import { useWorkspaceScope } from './workspace-scope'
import { workspaceDate } from './workspace-action'
import {
  inboxQueues,
  inboxPage,
  inboxForm,
  inboxLocation,
  inboxWorkflow,
  inboxRelatedLocations,
  type InboxPage,
  type InboxQueue,
  type InboxRow,
} from './work-inbox'
import WorkflowPanel from './WorkflowPanel.vue'
import CareSafety from './CareSafety.vue'
const props = defineProps<{ mobile?: boolean; compact?: boolean }>()
const scope = useWorkspaceScope(),
  route = useRoute()
const queue = ref<InboxQueue>('mine'),
  offset = ref(0),
  page = ref<InboxPage | null>(null)
const loading = ref(false),
  error = ref(''),
  selected = ref<InboxRow | null>(null),
  formRegion = ref<HTMLElement>()
const form = computed(() =>
  selected.value ? inboxForm(selected.value, scope.owner?.role || null) : null,
)
const elderId = computed(() =>
  String(route.query.elder_id || route.query.elder || ''),
)
const limit = computed(() => (props.compact ? 5 : 30))
let epoch = 0,
  timer: ReturnType<typeof setInterval> | undefined
const roles: Record<string, string> = {
  admin: '管理员',
  supervisor: '主管',
  caregiver: '护理员',
  nurse: '护士',
}
function primaryLabel(item: InboxRow) {
  const primary = inboxWorkflow(item).primary_action as Row | undefined
  return typeof primary?.label === 'string' ? primary.label : '查看并办理'
}
function responsibility(item: InboxRow) {
  const owner = inboxWorkflow(item).responsibility as Row | undefined
  return (
    item.owner_name ||
    item.assigned_name ||
    (owner?.assigned_to === scope.owner?.userId
      ? '由我办理'
      : Array.isArray(owner?.roles)
        ? owner.roles
            .map((r) => roles[String(r)] || '')
            .filter(Boolean)
            .join(' / ')
        : '') ||
    '按当前责任办理'
  )
}
async function load(quiet = false) {
  const ticket = ++epoch
  if (!scope.valid()) {
    page.value = null
    return
  }
  if (!quiet) loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      queue: queue.value,
      limit: String(limit.value),
      offset: String(offset.value),
    })
    if (elderId.value) params.set('elder_id', elderId.value)
    const result = inboxPage(await request('/work-inbox?' + params))
    if (ticket !== epoch || !scope.valid()) return
    if (result.offset !== offset.value || result.limit !== limit.value)
      throw new Error('工作事项分页与请求不一致，请重新读取。')
    if (
      !result.items.length &&
      offset.value > 0 &&
      offset.value >= result.total
    ) {
      offset.value = 0
      void load()
      return
    }
    page.value = result
    if (selected.value)
      selected.value =
        result.items.find((item) => item.id === selected.value?.id) || null
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function movePage(delta: number) { offset.value = Math.max(0, offset.value + delta * limit.value); selected.value = null; void load() }
function chooseQueue(value: InboxQueue) {
  queue.value = value
  offset.value = 0
  selected.value = null
  page.value = null
  void load()
}
async function open(item: InboxRow) {
  selected.value = selected.value?.id === item.id ? null : item
  await nextTick()
  formRegion.value?.focus()
  formRegion.value?.scrollIntoView({ block: 'nearest' })
}
function setFormRegion(node: unknown) {
  formRegion.value = node instanceof HTMLElement ? node : undefined
}
function refreshVisible() {
  if (document.visibilityState === 'visible' && !selected.value) void load(true)
}
watch(
  elderId,
  () => {
    page.value = null
    selected.value = null
    offset.value = 0
    void load()
  },
  { immediate: true },
)
watch(scope.active, (active) => {
  if (!active) {
    epoch++
    page.value = null
    selected.value = null
  }
})
onMounted(() => {
  timer = setInterval(refreshVisible, 30000)
  window.addEventListener('focus', refreshVisible)
})
onBeforeUnmount(() => {
  epoch++
  clearInterval(timer)
  window.removeEventListener('focus', refreshVisible)
})
</script>
<template>
  <section
    v-if="scope.active.value"
    class="work-inbox"
    :class="{ compact }"
    aria-label="工作收件箱"
  >
    <header>
      <div>
        <p class="eyebrow">
          工作收件箱
        </p>
        <h2>{{ compact ? '优先办理' : '今天要做什么' }}</h2>
        <p>先处理紧急情况，再接续当前责任。</p>
      </div>
      <button
        type="button"
        class="secondary"
        :disabled="loading"
        @click="load()"
      >
        刷新
      </button>
    </header>
    <nav
      class="inbox-tabs"
      aria-label="工作队列"
    >
      <button
        v-for="tab in inboxQueues"
        :key="tab.value"
        type="button"
        :aria-pressed="queue === tab.value"
        @click="chooseQueue(tab.value)"
      >
        {{ tab.label }} <span>{{ page ? page.counts[tab.value] : '—' }}</span>
      </button>
    </nav>
    <p
      v-if="loading"
      role="status"
    >
      正在读取当前工作…
    </p>
    <div
      v-if="error"
      class="inbox-error"
      role="alert"
    >
      <p>{{ error }}</p>
      <button
        type="button"
        @click="load()"
      >
        重新读取
      </button>
    </div>
    <p
      v-if="!loading && !error && page && !page.items.length"
      class="inbox-empty"
    >
      {{
        queue === 'waiting'
          ? '当前没有等待他人接续的事项。'
          : queue === 'processed'
            ? '当前范围没有已处理事项。'
            : '这一栏的事项已处理完，可以查看其他队列。'
      }}
    </p>
    <ul
      v-if="page"
      class="inbox-list"
    >
      <li
        v-for="item in page.items"
        :key="item.id"
        :class="{ urgent: item.priority === 'urgent' }"
      >
        <div class="inbox-row-heading">
          <span
            v-if="item.priority === 'urgent'"
            class="urgent-label"
          >紧急 · 请立即关注</span><span
            v-if="item.unread"
            class="unread-label"
          >未读</span><span>{{ item.elder_name || '机构事项' }}</span><span class="state-label">{{
            inboxWorkflow(item).state_label ||
              (queue === 'processed'
                ? '已处理'
                : queue === 'review'
                  ? '待复查'
                  : queue === 'waiting'
                    ? '等待接续'
                    : '待办理')
          }}</span>
        </div>
        <h3>{{ item.display_label || item.title }}</h3>
        <p>
          {{ responsibility(item)
          }}<span v-if="item.due_at">
            · 截止 {{ workspaceDate(item.due_at) }}</span>
        </p>
        <p
          v-if="inboxWorkflow(item).blocked_reason"
          class="blocked-reason"
        >
          {{ inboxWorkflow(item).blocked_reason }}
        </p>
        <p v-if="item.reason">
          {{ item.reason }}
        </p>
        <details
          v-if="inboxRelatedLocations(item, !!mobile).length > 1"
          class="inbox-related"
        >
          <summary>
            查看合并的
            {{ inboxRelatedLocations(item, !!mobile).length }} 条关联提示
          </summary>
          <ul>
            <li
              v-for="(related, index) in inboxRelatedLocations(item, !!mobile)"
              :key="index"
            >
              <RouterLink :to="related.location">
                {{
                  related.label
                }}
              </RouterLink>
            </li>
          </ul>
        </details>
        <button
          v-if="inboxForm(item, scope.owner?.role || null)"
          type="button"
          class="inbox-primary"
          @click="open(item)"
        >
          {{
            selected?.id === item.id
              ? '收起办理'
              : item.priority === 'urgent'
                ? '立即查看事件'
                : primaryLabel(item)
          }}
        </button>
        <RouterLink
          v-else
          class="inbox-primary"
          :to="inboxLocation(item, !!mobile)"
        >
          {{ queue === 'processed' ? '查看处理结果' : '进入事项' }}
        </RouterLink>
        <div
          v-if="selected?.id === item.id && form"
          :ref="setFormRegion"
          tabindex="-1"
          class="inbox-form"
        >
          <CareSafety
            v-if="form.group === 'incidents'"
            :key="item.id"
            :context="form.context"
            initial-action="/incidents/{incident_id}"
            :record-path="mobile ? '/records/new' : '/workflows/records'"
            focused
            @changed="load()"
          />
          <WorkflowPanel
            v-else
            :key="item.id"
            :group="form.group"
            :context="form.context"
            :initial-action="form.action"
            :auto-read="form.read"
            focused
            @changed="load()"
          />
        </div>
      </li>
    </ul>
    <nav
      v-if="page && !compact && page.total > limit"
      class="inbox-pagination"
      aria-label="工作事项分页"
    >
      <button
        type="button"
        :disabled="loading || !offset"
        @click="movePage(-1)"
      >
        上一页
      </button><span>第 {{ Math.floor(offset / limit) + 1 }} /
        {{ Math.ceil(page.total / limit) }} 页 · 共 {{ page.total }} 项</span><button
        type="button"
        :disabled="loading || offset + limit >= page.total"
        @click="movePage(1)"
      >
        下一页
      </button>
    </nav>
    <RouterLink
      v-if="compact"
      to="/notifications"
      class="inbox-all"
    >
      打开完整工作收件箱
    </RouterLink>
    <p class="inbox-footnote">
      消息未读只作提醒；业务完成后才会移出待办。<span v-if="page">
        更新于 {{ workspaceDate(page.as_of) }}</span>
    </p>
  </section>
  <p
    v-else
    role="status"
  >
    请使用当前工作人员账号重新进入工作收件箱。
  </p>
</template>
<style scoped>
.work-inbox {
  color: var(--hl-ink, #233b34);
  min-width: 0;
  overflow-wrap: anywhere;
}
header,
.inbox-row-heading,
.inbox-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
}
header p {
  margin: 6px 0;
  color: var(--hl-muted, #586961);
}
h2 {
  margin: 0;
  font-size: 24px;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.12em;
}
.inbox-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 20px 0 12px;
}
.inbox-tabs button {
  background: #fff;
  color: inherit;
  border: 1px solid var(--hl-border, #d9e1db);
}
.inbox-tabs button[aria-pressed='true'] {
  background: #e5f1e9;
  border-color: #588a71;
  color: #27543d;
}
.inbox-tabs span {
  margin-left: 6px;
}
button,
.inbox-primary,
.inbox-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid transparent;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
.secondary,
.inbox-pagination button {
  background: white;
  border-color: var(--hl-border, #d9e1db);
  color: inherit;
}
.inbox-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.inbox-list > li {
  margin: 12px 0;
  padding: 20px;
  border: 1px solid var(--hl-border, #d9e1db);
  background: #fffefa;
  border-radius: 16px;
}
.inbox-row-heading {
  justify-content: flex-start;
  color: #57685f;
  font-size: 13px;
}
.state-label {
  margin-left: auto;
}
.inbox-list h3 {
  font-size: 18px;
  line-height: 1.5;
  margin: 10px 0;
}
.inbox-list p {
  line-height: 1.65;
  margin: 8px 0;
}
.inbox-primary {
  margin-top: 8px;
  background: var(--hl-primary, #356b50);
  color: white;
}
.inbox-list > li.urgent {
  background: #fff4ef;
  border-color: #e7aaa0;
  border-left: 5px solid #b6362b;
}
.urgent-label {
  color: #9e241d;
  font-weight: 700;
}
.urgent .inbox-primary {
  background: #ae3028;
}
.unread-label {
  padding: 3px 7px;
  background: #e7eff6;
  color: #315e82;
  border-radius: 5px;
}
.blocked-reason {
  color: #80591d;
}
.inbox-error {
  padding: 16px;
  background: #fff2ed;
  color: #9e3029;
}
.inbox-form {
  margin-top: 20px;
  border-top: 1px solid #d7ded8;
  padding-top: 18px;
}
.inbox-footnote {
  font-size: 12px;
  color: var(--hl-muted, #586961);
  line-height: 1.6;
}
.inbox-empty {
  padding: 28px 16px;
  background: #f0f5ee;
  border-radius: 14px;
}
.inbox-pagination {
  justify-content: center;
}
.inbox-all {
  color: var(--hl-primary, #356b50);
  border-color: #c5d8c8;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
:focus-visible {
  outline: 3px solid #8baf9b;
  outline-offset: 3px;
}
@media (max-width: 520px) {
  .inbox-list > li {
    padding: 15px;
  }
  .inbox-primary {
    width: 100%;
  }
  .inbox-tabs {
    gap: 6px;
  }
  .inbox-tabs button {
    flex: 1 1 42%;
  }
}
</style>
