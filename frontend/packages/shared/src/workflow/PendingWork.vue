<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CheckCheck, ChevronLeft, ChevronRight, RefreshCw, UserRoundCheck } from 'lucide-vue-next'
import { readSession } from '../session'
import { listAll, request, type Row } from './model'
import { sameCareSession } from './task-care-context'
import WorkspaceDecisions from './WorkspaceDecisions.vue'
import {
  clearNotificationAction, notificationActionKey, notificationLocation,
  notificationObjects, notificationStages, notificationStatuses,
  validateNotifications, type ServerNotification,
} from './pending-work'

const props = withDefaults(defineProps<{ mobile?: boolean }>(), { mobile: false })
const session = ref(readSession())
const notifications = ref<ServerNotification[]>([])
const total = ref(0)
const offset = ref(0)
const limit = 100
const asOf = ref('')
const definition = ref('')
const elders = ref(new Map<string, string>())
const unread = ref(false)
const pending = ref(true)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const busyId = ref('')
let epoch = 0
let actionEpoch = 0
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const pageNumber = computed(() => Math.floor(offset.value / limit) + 1)
const permitted = computed(() => !!session.value && ['admin', 'supervisor', 'caregiver'].includes(session.value.role || ''))
function elderName(id: unknown) { return typeof id === 'string' ? elders.value.get(id) || '老人信息暂不可用' : '未关联老人' }
function when(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '时间待核实'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}
function isRead(row: ServerNotification) { return typeof row.read_at === 'string' && !!row.read_at }
function status(row: ServerNotification) {
  if (row.returned === true) return '业务已退回，需核对最新通知'
  return notificationStatuses[row.status] || '状态待核实'
}
async function load() {
  const ticket = ++epoch
  if (!sameCareSession(readSession(), session.value)) {
    actionEpoch++; busyId.value = ''; offset.value = 0
    notifications.value = []; total.value = 0; elders.value = new Map(); asOf.value = ''; definition.value = ''
  }
  session.value = readSession()
  const current = session.value
  if (!permitted.value || current?.mode !== 'api') {
    notifications.value = []; total.value = 0; elders.value = new Map(); loaded.value = true; loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  const query = new URLSearchParams({ unread: String(unread.value), pending: String(pending.value), limit: String(limit), offset: String(offset.value) })
  try {
    const [response, elderResponse] = await Promise.all([
      request(`/notifications?${query}`),
      listAll('/elders').catch(() => null),
    ])
    const page = validateNotifications(response)
    if (page.offset !== offset.value || page.limit !== limit) throw new Error('通知分页与请求不一致，请刷新核实。')
    if (ticket !== epoch || !sameCareSession(readSession(), current)) return
    notifications.value = page.items
    total.value = page.total
    offset.value = page.offset
    asOf.value = page.as_of
    definition.value = page.definition
    if (Array.isArray(elderResponse)) {
      const names = new Map<string, string>()
      for (const elder of elderResponse as Row[]) if (typeof elder.id === 'string' && typeof elder.name === 'string') names.set(elder.id, elder.name)
      elders.value = names
    }
    loaded.value = true
  } catch (failure) {
    if (ticket === epoch && sameCareSession(readSession(), current)) {
      error.value = failure instanceof Error ? failure.message : '服务器通知暂时无法读取。'
      if ((failure as { status?: number })?.status === 403) { notifications.value = []; total.value = 0; elders.value = new Map() }
      loaded.value = true
    }
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
async function act(row: ServerNotification, action: 'read' | 'accept') {
  const current = session.value
  if (!current || busyId.value || !permitted.value || !sameCareSession(readSession(), current)) return
  const ticket = epoch
  const actionTicket = ++actionEpoch
  busyId.value = row.id
  error.value = ''
  try {
    const receipt = notificationActionKey(sessionStorage, current, row, action)
    const value = await request(`/notifications/${encodeURIComponent(row.id)}/actions`, 'post', {
      expected_revision: row.revision,
      action,
    }, receipt.key)
    if (ticket !== epoch || !sameCareSession(readSession(), current)) return
    if (!value || typeof value !== 'object' || (value as Row).id !== row.id || !Number.isSafeInteger((value as Row).revision) || Number((value as Row).revision) <= row.revision)
      throw new Error('服务器未返回有效通知版本；操作结果需刷新核实。')
    clearNotificationAction(sessionStorage, receipt)
    const updated = value as ServerNotification
    notifications.value = notifications.value.map(item => item.id === row.id ? updated : item)
    await load()
  } catch (failure) {
    if (ticket === epoch && sameCareSession(readSession(), current)) error.value = failure instanceof Error ? failure.message + '；保留原请求编号，可重试或刷新核实。' : '操作未确认；保留原请求编号，可重试。'
  } finally {
    if (actionTicket === actionEpoch) busyId.value = ''
  }
}
function revoke() {
  epoch++
  actionEpoch++; busyId.value = ''
  notifications.value = []; total.value = 0; elders.value = new Map(); session.value = null
  loaded.value = true; loading.value = false; error.value = ''
}
function changed() { if (!sameCareSession(readSession(), session.value)) void load() }
function setFilter(which: 'unread' | 'pending', value: boolean) {
  if (which === 'unread') unread.value = value
  else pending.value = value
  offset.value = 0
  void load()
}
function nextPage() { if (offset.value + limit < total.value) { offset.value += limit; void load() } }
function previousPage() { if (offset.value > 0) { offset.value = Math.max(0, offset.value - limit); void load() } }
onMounted(() => { void load(); window.addEventListener('focus', load); window.addEventListener('storage', changed); window.addEventListener('hulao:unauthorized', revoke) })
onBeforeUnmount(() => { epoch++; window.removeEventListener('focus', load); window.removeEventListener('storage', changed); window.removeEventListener('hulao:unauthorized', revoke) })
</script>

<template>
  <section
    class="server-notifications"
    aria-label="服务器待处理通知"
  >
    <header>
      <div><h1>待我处理</h1><p>通知已读或接单不会自动完成关联任务、交班或整改。</p></div><button
        class="icon-button"
        type="button"
        aria-label="刷新服务器通知"
        title="刷新服务器通知"
        :disabled="loading"
        @click="load"
      >
        <RefreshCw
          :size="19"
          aria-hidden="true"
        />
      </button>
    </header>
    <p
      v-if="!permitted"
      role="alert"
    >
      当前账号不能查看内部通知。
    </p>
    <p
      v-else-if="session?.mode !== 'api'"
      role="status"
    >
      服务器通知仅在服务器账号下提供；演示环境没有跨设备通知数据。
    </p>
    <template v-else>
      <WorkspaceDecisions />
      <div class="filters">
        <label><input
          type="checkbox"
          :checked="unread"
          @change="setFilter('unread', ($event.target as HTMLInputElement).checked)"
        >仅未读</label>
        <label><input
          type="checkbox"
          :checked="pending"
          @change="setFilter('pending', ($event.target as HTMLInputElement).checked)"
        >仅待办理</label>
      </div>
      <p class="meta">
        {{ definition || '状态以服务器通知为准。' }}<span v-if="asOf">最近刷新：{{ when(asOf) }}</span>
      </p>
      <p
        v-if="loading && !loaded"
        role="status"
      >
        正在读取服务器通知…
      </p>
      <p
        v-if="error"
        class="error"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-if="!loading && loaded && !notifications.length"
        role="status"
      >
        {{ error ? '读取失败，当前结果不能代表服务器没有通知。' : '当前筛选范围没有通知。' }}
      </p>
      <ul>
        <li
          v-for="item in notifications"
          :key="item.id"
        >
          <div class="notice-main">
            <div class="notice-title">
              <strong>{{ item.title || notificationObjects[item.object_type] || '待办理事项' }}</strong><span>{{ status(item) }}</span>
            </div>
            <p>{{ elderName(item.elder_id) }} · {{ notificationStages[item.stage] || '阶段待核实' }} · {{ notificationObjects[item.object_type] || '业务对象待核实' }}</p>
            <p>通知时间：{{ when(item.created_at) }}<span v-if="item.accepted_at"> · 接单：{{ when(item.accepted_at) }}</span><span v-if="isRead(item)"> · 已读：{{ when(item.read_at) }}</span></p>
            <RouterLink
              class="open-link"
              :to="notificationLocation(item, props.mobile)"
            >
              进入关联业务<ChevronRight
                :size="16"
                aria-hidden="true"
              />
            </RouterLink>
          </div>
          <div class="notice-actions">
            <button
              v-if="!isRead(item)"
              type="button"
              class="secondary"
              :disabled="loading || !!busyId"
              @click="act(item, 'read')"
            >
              <CheckCheck
                :size="16"
                aria-hidden="true"
              />标记已读
            </button>
            <button
              v-if="item.status === 'pending'"
              type="button"
              :disabled="loading || !!busyId"
              @click="act(item, 'accept')"
            >
              <UserRoundCheck
                :size="16"
                aria-hidden="true"
              />{{ busyId === item.id ? '提交中…' : '接单办理' }}
            </button>
          </div>
        </li>
      </ul>
      <nav
        v-if="total > limit"
        class="pagination"
        aria-label="通知分页"
      >
        <button
          type="button"
          class="secondary"
          :disabled="loading || offset === 0"
          @click="previousPage"
        >
          <ChevronLeft :size="16" />上一页
        </button>
        <span>第 {{ pageNumber }} / {{ pages }} 页 · 共 {{ total }} 条</span>
        <button
          type="button"
          class="secondary"
          :disabled="loading || offset + limit >= total"
          @click="nextPage"
        >
          下一页<ChevronRight :size="16" />
        </button>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.server-notifications { min-width: 0; overflow-wrap: anywhere; }
header, .filters, .notice-title, .notice-actions, .pagination { display: flex; align-items: center; gap: 12px; }
header { justify-content: space-between; }
h1 { margin: 0; }
header p, .meta, li p { color: var(--hl-muted, #5f6b73); line-height: 1.55; }
.filters { flex-wrap: wrap; padding-block: 10px; border-block: 1px solid var(--hl-border, #dce3e7); }
.filters label { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; }
.meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; }
ul { padding: 0; list-style: none; }
li { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding-block: 14px; border-bottom: 1px solid var(--hl-border, #dce3e7); }
.notice-main { min-width: 0; }
.notice-title { flex-wrap: wrap; }
.notice-title strong { font-size: 16px; }
.notice-title span { color: var(--hl-muted, #5f6b73); }
li p { margin: 6px 0; font-size: 14px; }
.open-link { display: inline-flex; align-items: center; min-height: 40px; gap: 4px; color: var(--hl-primary, #1767cf); }
.notice-actions { flex-wrap: wrap; justify-content: flex-end; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 7px 10px; color: #fff; background: var(--hl-primary, #1767cf); border: 1px solid var(--hl-primary, #1767cf); border-radius: 6px; }
.secondary { color: var(--hl-ink, #20282e); background: white; border-color: var(--hl-border, #dce3e7); }
button:disabled { opacity: .55; }
.pagination { justify-content: center; flex-wrap: wrap; padding-block: 16px; }
.error { color: var(--hl-danger, #b52d38); }
@media (max-width: 520px) { li { flex-direction: column; } .notice-actions { justify-content: flex-start; } }
</style>
