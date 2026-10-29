<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserRoundCheck,
} from 'lucide-vue-next'
import { readSession } from '../session'
import { formatBusinessTime } from '../business-time'
import { loadDemoState, subscribeDemo } from '../demo-store'
import WorkflowPanel from './WorkflowPanel.vue'
import { listAll, request, type Row } from './model'
import { sameCareSession } from './task-care-context'
import {
  clearNotificationAction,
  notificationActionKey,
  notificationLocation,
  notificationObjects,
  notificationStages,
  notificationStatuses,
  validateNotifications,
  demoFollowups,
  filterNotifications,
  followupCategories,
  followupTools,
  notificationCategory,
  notificationWork,
  isUrgentNotification,
  type DemoFollowup,
  type FollowupCategory,
  type ServerNotification,
} from './pending-work'

const props = withDefaults(defineProps<{ mobile?: boolean }>(), {
  mobile: false,
})
const session = ref(readSession())
const notifications = ref<ServerNotification[]>([])
const demoItems = ref<DemoFollowup[]>([])
const category = ref<FollowupCategory>('pending')
const business = ref('')
const selectedId = ref('')
const total = ref(0)
const offset = ref(0)
const limit = 100
const asOf = ref('')
const definition = ref('')
const elders = ref(new Map<string, string>())
const unread = ref(false)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const busyId = ref('')
const batchBusy = ref(false)
const batchResult = ref('')
let epoch = 0
let actionEpoch = 0
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const pageNumber = computed(() => Math.floor(offset.value / limit) + 1)
const permitted = computed(
  () =>
    !!session.value &&
    ['admin', 'supervisor', 'caregiver', 'nurse'].includes(session.value.role || ''),
)
const demoMode = computed(() => session.value?.mode === 'demo')
const tools = computed(() =>
  !props.mobile && ['admin', 'supervisor'].includes(session.value?.role || '')
    ? followupTools
    : [],
)
const businessOptions = computed(() =>
  demoMode.value
    ? ['care_tasks', 'handovers', 'care_memories']
    : [
        ...new Set([
          ...Object.keys(notificationObjects),
          ...notifications.value.map((item) => item.object_type),
        ]),
      ],
)
const visibleNotifications = computed(() =>
  notifications.value,
)
const visibleDemoItems = computed(() =>
  demoItems.value.filter(
    (item) =>
      item.category === category.value &&
      (!business.value || item.business === business.value),
  ),
)
const counts = computed(() =>
  Object.fromEntries(
    followupCategories.map((tab) => [
      tab.value,
      demoMode.value
        ? demoItems.value.filter(
            (item) =>
              item.category === tab.value &&
              (!business.value || item.business === business.value),
          ).length
        : filterNotifications(notifications.value, tab.value, business.value)
            .length,
    ]),
  ),
)
const selected = computed(() =>
  visibleNotifications.value.find((item) => item.id === selectedId.value),
)
const activeWork = computed(() =>
  selected.value
    ? notificationWork(selected.value, session.value?.role || null)
    : null,
)
function elderName(id: unknown) {
  return typeof id === 'string'
    ? elders.value.get(id) || '老人信息暂不可用'
    : '未关联老人'
}
function when(value: unknown) {
  return typeof value === 'string' ? formatBusinessTime(value) : '时间待核实'
}
function isRead(row: ServerNotification) {
  return typeof row.read_at === 'string' && !!row.read_at
}
function status(row: ServerNotification) {
  if (row.returned === true) return '业务已退回，需核对最新通知'
  return notificationStatuses[row.status] || '状态待核实'
}
async function load() {
  const ticket = ++epoch
  if (!sameCareSession(readSession(), session.value)) {
    actionEpoch++
    busyId.value = ''
    offset.value = 0
    notifications.value = []
    demoItems.value = []
    selectedId.value = ''
    total.value = 0
    elders.value = new Map()
    asOf.value = ''
    definition.value = ''
  }
  session.value = readSession()
  const current = session.value
  if (!permitted.value || !current) {
    notifications.value = []
    demoItems.value = []
    total.value = 0
    elders.value = new Map()
    loaded.value = true
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  const query = new URLSearchParams({
    unread: String(unread.value),
    pending: 'false',
    limit: String(limit),
    offset: String(offset.value),
  })
  try {
    if (current.mode === 'demo') {
      const state = await loadDemoState()
      if (ticket !== epoch || !sameCareSession(readSession(), current)) return
      demoItems.value = demoFollowups(state, props.mobile)
      notifications.value = []
      total.value = 0
      asOf.value = ''
      definition.value = ''
      loaded.value = true
      return
    }
    const [response, elderResponse] = await Promise.all([
      request(`/notifications?${query}`),
      listAll('/elders').catch(() => null),
    ])
    const page = validateNotifications(response)
    if (page.offset !== offset.value || page.limit !== limit)
      throw new Error('通知分页与请求不一致，请刷新核实。')
    if (ticket !== epoch || !sameCareSession(readSession(), current)) return
    if (!page.items.length && offset.value > 0 && page.total <= offset.value) {
      offset.value = 0
      await load()
      return
    }
    notifications.value = page.items
    total.value = page.total
    offset.value = page.offset
    asOf.value = page.as_of
    definition.value = page.definition
    if (Array.isArray(elderResponse)) {
      const names = new Map<string, string>()
      for (const elder of elderResponse as Row[])
        if (typeof elder.id === 'string' && typeof elder.name === 'string')
          names.set(elder.id, elder.name)
      elders.value = names
    }
    loaded.value = true
  } catch (failure) {
    if (ticket === epoch && sameCareSession(readSession(), current)) {
      error.value =
        failure instanceof Error ? failure.message : '服务器通知暂时无法读取。'
      notifications.value = []
      demoItems.value = []
      selectedId.value = ''
      total.value = 0
      elders.value = new Map()
      asOf.value = ''
      definition.value = ''
      loaded.value = true
    }
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
async function act(row: ServerNotification, action: 'read' | 'accept') {
  const current = session.value
  if (
    !current ||
    current.mode !== 'api' ||
    loading.value ||
    busyId.value ||
    !permitted.value ||
    !sameCareSession(readSession(), current)
  )
    return
  const ticket = epoch
  const actionTicket = ++actionEpoch
  busyId.value = row.id
  error.value = ''
  try {
    const receipt = notificationActionKey(sessionStorage, current, row, action)
    const value = await request(
      `/notifications/${encodeURIComponent(row.id)}/actions`,
      'post',
      {
        expected_revision: row.revision,
        action,
      },
      receipt.key,
    )
    if (ticket !== epoch || !sameCareSession(readSession(), current)) return
    if (
      !value ||
      typeof value !== 'object' ||
      (value as Row).id !== row.id ||
      !Number.isSafeInteger((value as Row).revision) ||
      Number((value as Row).revision) <= row.revision
    )
      throw new Error('服务器未返回有效通知版本；操作结果需刷新核实。')
    clearNotificationAction(sessionStorage, receipt)
    const updated = value as ServerNotification
    notifications.value = notifications.value.map((item) =>
      item.id === row.id ? updated : item,
    )
    await load()
    return true
  } catch (failure) {
    if (ticket === epoch && sameCareSession(readSession(), current))
      error.value =
        failure instanceof Error
          ? failure.message + '；保留原请求编号，可重试或刷新核实。'
          : '操作未确认；保留原请求编号，可重试。'
    return false
  } finally {
    if (actionTicket === actionEpoch) busyId.value = ''
  }
}
async function markPageRead() {
  if (batchBusy.value || loading.value || busyId.value) return
  const current = session.value
  const targets = notifications.value.filter(item => !isRead(item))
  batchBusy.value = true
  let confirmed = 0
  try {
    for (const row of targets) {
      if (!sameCareSession(readSession(), current)) break
      if (await act(row, 'read')) confirmed++
    }
    if (sameCareSession(readSession(), current))
      batchResult.value = `本页 ${targets.length} 条消息：${confirmed} 条已确认已读，${targets.length - confirmed} 条未确认。已读不改变业务进展。`
  } finally { batchBusy.value = false }
}
function revoke() {
  epoch++
  actionEpoch++
  busyId.value = ''
  notifications.value = []
  demoItems.value = []
  selectedId.value = ''
  total.value = 0
  elders.value = new Map()
  session.value = null
  loaded.value = true
  loading.value = false
  error.value = ''
}
function changed() {
  if (!sameCareSession(readSession(), session.value)) void load()
}
function setUnread(value: boolean) {
  unread.value = value
  offset.value = 0
  void load()
}
function nextPage() {
  if (offset.value + limit < total.value) {
    offset.value += limit
    void load()
  }
}
function previousPage() {
  if (offset.value > 0) {
    offset.value = Math.max(0, offset.value - limit)
    void load()
  }
}
let unsubscribeDemo: (() => void) | undefined
onMounted(() => {
  void load()
  unsubscribeDemo = subscribeDemo(() => {
    if (readSession()?.mode === 'demo') void load()
  })
  window.addEventListener('focus', load)
  window.addEventListener('storage', changed)
  window.addEventListener('hulao:unauthorized', revoke)
})
onBeforeUnmount(() => {
  epoch++
  unsubscribeDemo?.()
  window.removeEventListener('focus', load)
  window.removeEventListener('storage', changed)
  window.removeEventListener('hulao:unauthorized', revoke)
})
</script>

<template>
  <section class="server-notifications" aria-label="消息">
    <header>
      <div>
        <h1>消息</h1>
        <p>查看提醒与已读状态。业务处理进展请进入照护跟进核对。</p>
        <RouterLink to="/followups">进入业务办理</RouterLink>
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="刷新消息"
        title="刷新消息"
        :disabled="loading || !!busyId"
        @click="load"
      >
        <RefreshCw :size="19" aria-hidden="true" />
      </button>
    </header>
    <p v-if="!permitted" role="alert">当前账号不能查看内部通知。</p>
    <template v-else>
      <p v-if="demoMode" class="meta">
        虚构演示：从本机任务、交班与照护理解复查生成跟进入口；不提供服务器通知或跨设备已读状态。
      </p>
      <p v-else class="meta">
        已读只表示看过消息，接单只表示接受提醒；两者都不代表业务完成。列表与总数均使用服务器的未读筛选范围。
      </p>
      <nav v-if="demoMode" class="category-tabs" aria-label="本机演示分类">
        <button
          v-for="tab in followupCategories"
          :key="tab.value"
          type="button"
          :class="{ secondary: category !== tab.value }"
          :aria-pressed="category === tab.value"
          @click="category = tab.value"
        >
          {{ tab.label }}（{{ counts[tab.value] }}）
        </button>
      </nav>
      <details v-if="tools.length" class="followup-tools">
        <summary>更多照护跟进工具</summary>
        <nav aria-label="照护跟进内部工具">
          <RouterLink
            v-for="tool in tools"
            :key="tool.path"
            class="open-link"
            :to="tool.path"
          >
            {{ tool.label }}<ChevronRight :size="16" aria-hidden="true" />
          </RouterLink>
        </nav>
      </details>
      <div class="filters">
        <label v-if="demoMode"
          >业务筛选<select v-model="business">
            <option value="">
              全部业务（{{ demoMode ? '本机演示' : '当前页' }}）
            </option>
            <option v-for="type in businessOptions" :key="type" :value="type">
              {{ notificationObjects[type] || '其他业务：' + type }}
            </option>
          </select></label
        >
        <label v-if="!demoMode"
          ><input
            type="checkbox"
            :checked="unread"
            :disabled="loading || !!busyId"
            @change="setUnread(($event.target as HTMLInputElement).checked)"
          />仅未读（服务器筛选）</label
        >
      </div>
      <button v-if="!demoMode" type="button" class="secondary" :disabled="loading || !!busyId || batchBusy || !notifications.some(item => !isRead(item))" @click="markPageRead">{{ batchBusy ? '正在逐条确认…' : '将本页未读消息标记已读' }}</button>
      <p v-if="batchResult" role="status">{{ batchResult }}</p>
      <p v-if="!demoMode" class="meta">
        {{ definition || '状态以服务器通知为准。'
        }}<span v-if="asOf">最近刷新：{{ when(asOf) }}</span>
      </p>
      <p v-if="!demoMode && loaded && !error" class="meta">
        服务器通知第 {{ pageNumber }} / {{ pages }} 页 · 当前载入
        {{ notifications.length }} 条 · 服务器筛选范围共 {{ total }} 条
      </p>
      <p v-if="loading" role="status">
        {{ demoMode ? '正在读取本机演示事项…' : '正在读取服务器通知…' }}
      </p>
      <p v-if="error" class="error" role="alert">
        {{ error }}
      </p>
      <p
        v-if="
          !loading &&
          loaded &&
          !(demoMode ? visibleDemoItems.length : visibleNotifications.length)
        "
        role="status"
      >
        {{
          error
            ? '读取失败，无法判断当前范围是否还有事项。'
            : demoMode
              ? '当前分类与业务筛选下没有本机演示事项。'
              : '当前筛选范围没有消息；可取消仅未读筛选或刷新。'
        }}
      </p>
      <ul>
        <li v-for="item in visibleNotifications" :key="item.id" :class="{ 'urgent-notice': isUrgentNotification(item) }">
          <div class="notice-main">
            <div class="notice-title">
              <b v-if="isUrgentNotification(item)" class="urgent-badge">紧急</b>
              <strong>{{
                item.title ||
                notificationObjects[item.object_type] ||
                '待办理事项'
              }}</strong
              ><span>{{ status(item) }}</span>
            </div>
            <p>
              {{ elderName(item.elder_id) }} ·
              {{ notificationStages[item.stage] || '阶段待核实' }} ·
              {{ notificationObjects[item.object_type] || '业务对象待核实' }}
            </p>
            <p>
              通知时间：{{ when(item.created_at)
              }}<span v-if="item.accepted_at">
                · 接单：{{ when(item.accepted_at) }}</span
              ><span v-if="isRead(item)">
                · 已读：{{ when(item.read_at) }}</span
              >
            </p>
            <p v-if="notificationCategory(item) === 'review'">
              需按原业务规则审核；涉及独立复查时由独立人员办理，提交不等于复查通过。
            </p>
            <RouterLink
              v-if="notificationObjects[item.object_type]"
              class="open-link"
              :to="notificationLocation(item, props.mobile)"
            >
              {{ isUrgentNotification(item) ? '立即查看事件' : '进入关联业务' }}<ChevronRight :size="16" aria-hidden="true" />
            </RouterLink>
            <p v-else>当前通知的业务入口待核实，请联系主管核对。</p>
            <button
              v-if="!isUrgentNotification(item) && notificationWork(item, session?.role || null)"
              type="button"
              class="secondary"
              :disabled="loading || !!busyId || batchBusy"
              :aria-expanded="selectedId === item.id"
              @click="selectedId = selectedId === item.id ? '' : item.id"
            >
              {{
                selectedId === item.id
                  ? '收起办理表单'
                  : notificationWork(item, session?.role || null)?.label
              }}
            </button>
          </div>
          <div class="notice-actions">
            <button
              v-if="!isRead(item)"
              type="button"
              class="secondary"
              :disabled="loading || !!busyId || batchBusy"
              @click="act(item, 'read')"
            >
              <CheckCheck :size="16" aria-hidden="true" />标记已读
            </button>
            <button
              v-if="item.status === 'pending' && !isUrgentNotification(item)"
              type="button"
              :disabled="loading || !!busyId"
              @click="act(item, 'accept')"
            >
              <UserRoundCheck :size="16" aria-hidden="true" />{{
                busyId === item.id ? '提交中…' : '接单办理'
              }}
            </button>
          </div>
          <div v-if="selectedId === item.id && activeWork" class="notice-form">
            <WorkflowPanel
              :key="`${session?.accountKey}:${selectedId}:${activeWork.action}`"
              :group="activeWork.group"
              :context="activeWork.context"
              :title="item.title"
              :initial-action="activeWork.action"
              :auto-read="activeWork.autoRead"
              @changed="load"
            />
          </div>
        </li>
        <li v-for="item in visibleDemoItems" :key="item.id">
          <div class="notice-main">
            <div class="notice-title">
              <strong>{{ item.title }}</strong
              ><span>{{ notificationObjects[item.business] }}</span>
            </div>
            <p>{{ item.detail }}</p>
            <RouterLink class="open-link" :to="item.location">
              {{
                item.business === 'care_memories'
                  ? item.category === 'review'
                    ? '进入独立复查'
                    : item.category === 'processed'
                      ? '查看处理结果'
                      : '进入核验办理'
                  : '进入关联业务'
              }}<ChevronRight :size="16" aria-hidden="true" />
            </RouterLink>
          </div>
        </li>
      </ul>
      <nav
        v-if="!demoMode && total > limit"
        class="pagination"
        aria-label="消息分页"
      >
        <button
          type="button"
          class="secondary"
          :disabled="loading || !!busyId || offset === 0"
          @click="previousPage"
        >
          <ChevronLeft :size="16" />上一页
        </button>
        <span
          >第 {{ pageNumber }} / {{ pages }} 页 · 服务器筛选范围共
          {{ total }} 条</span
        >
        <button
          type="button"
          class="secondary"
          :disabled="loading || !!busyId || offset + limit >= total"
          @click="nextPage"
        >
          下一页<ChevronRight :size="16" />
        </button>
      </nav>
    </template>
  </section>
</template>

<style scoped>
li.urgent-notice { border: 1px solid #f3a59b; border-left: 5px solid #b42318; background: #fff4f2; }
.urgent-badge { background: #b42318; color: white; border-radius: 4px; padding: 3px 8px; }
.urgent-notice .open-link { background: #b42318; color: white; padding: 8px 14px; border-radius: 6px; }
.server-notifications {
  min-width: 0;
  overflow-wrap: anywhere;
}
header,
.filters,
.notice-title,
.notice-actions,
.pagination,
.category-tabs {
  display: flex;
  align-items: center;
  gap: 12px;
}
header {
  justify-content: space-between;
}
h1 {
  margin: 0;
}
header p,
.meta,
li p {
  color: var(--hl-muted, #5f6b73);
  line-height: 1.55;
}
.filters {
  flex-wrap: wrap;
  padding-block: 10px;
  border-block: 1px solid var(--hl-border, #dce3e7);
}
.filters label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.filters label {
  flex-wrap: wrap;
  max-width: 100%;
}
select {
  max-width: 100%;
  min-height: 40px;
  padding: 6px;
  color: inherit;
  background: white;
  border: 1px solid var(--hl-border, #dce3e7);
  border-radius: 6px;
}
.category-tabs {
  flex-wrap: wrap;
  padding-bottom: 12px;
}
.followup-tools summary {
  cursor: pointer;
  padding-block: 14px;
}
.followup-tools nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 16px;
}
ul {
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding-block: 14px;
  border-bottom: 1px solid var(--hl-border, #dce3e7);
}
.notice-main {
  min-width: 0;
}
.notice-form {
  width: 100%;
  min-width: 0;
}
.notice-title {
  flex-wrap: wrap;
}
.notice-title strong {
  font-size: 16px;
}
.notice-title span {
  color: var(--hl-muted, #5f6b73);
}
li p {
  margin: 6px 0;
  font-size: 14px;
}
.open-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  gap: 4px;
  color: var(--hl-primary, #1767cf);
}
.notice-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  padding: 7px 10px;
  color: #fff;
  background: var(--hl-primary, #1767cf);
  border: 1px solid var(--hl-primary, #1767cf);
  border-radius: 6px;
}
.secondary {
  color: var(--hl-ink, #20282e);
  background: white;
  border-color: var(--hl-border, #dce3e7);
}
button:disabled {
  opacity: 0.55;
}
.pagination {
  justify-content: center;
  flex-wrap: wrap;
  padding-block: 16px;
}
.error {
  color: var(--hl-danger, #b52d38);
}
@media (max-width: 520px) {
  li {
    flex-direction: column;
  }
  .notice-actions {
    justify-content: flex-start;
  }
}
</style>
