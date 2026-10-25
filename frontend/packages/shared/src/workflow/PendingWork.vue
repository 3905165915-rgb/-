<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CheckCheck, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { readSession } from '../session'
import { listAll, request, type Row } from './model'
import { validateCatalog } from './catalogs'
import { sameCareSession } from './task-care-context'
import { isPendingRead, markPendingRead, pendingWork, pendingWorkLocation, type PendingWorkItem } from './pending-work'
const props = withDefaults(defineProps<{ mobile?: boolean }>(), { mobile: false })
const sources = ref<Record<string, Row[]>>({})
const errors = ref<string[]>([])
const loading = ref(false)
const readError = ref('')
const readVersion = ref(0)
const filter = ref('')
const unreadOnly = ref(false)
const session = ref(readSession())
let epoch = 0
const permitted = computed(() => !!session.value && ['admin', 'supervisor', 'caregiver'].includes(session.value.role || ''))
const items = computed(() => pendingWork(sources.value, session.value))
function isRead(item: PendingWorkItem) {
  void readVersion.value
  return !!session.value && isPendingRead(localStorage, session.value, item)
}
const visible = computed(() => items.value.filter(row => (!filter.value || row.kind === filter.value) && (!unreadOnly.value || !isRead(row))))
const elders = computed(() => new Map((sources.value.elders || []).map(row => [row.id, row])))
async function load() {
  const ticket = ++epoch
  session.value = readSession()
  const current = session.value
  sources.value = {}
  errors.value = []
  if (!permitted.value || current?.mode !== 'api') { loading.value = false; return }
  loading.value = true
  const names: Record<string, string> = { drafts: '待核对记录', handovers: '交班', incidents: '安全事件', shifts: '班次', elders: '老人' }
  const paths = { drafts: '/records/drafts', handovers: '/handovers', incidents: '/incidents', shifts: '/shifts', elders: '/elders' }
  await Promise.all(Object.entries(paths).map(async ([name, path]) => {
    try {
      const value = name === 'elders' ? await request(path) : await listAll(path)
      const rows = validateCatalog(name, value)
      if (ticket === epoch && sameCareSession(readSession(), current)) sources.value[name] = rows
    } catch {
      if (ticket === epoch && sameCareSession(readSession(), current)) errors.value.push(names[name] + '暂未读取成功')
    }
  }))
  if (ticket === epoch) {
    if (!sameCareSession(readSession(), current)) revoke()
    loading.value = false
  }
}
function mark(item: PendingWorkItem) {
  if (!session.value || !sameCareSession(readSession(), session.value)) { revoke(); return }
  try { markPendingRead(localStorage, session.value, item); readVersion.value++; readError.value = '' }
  catch { readError.value = '本机已读状态未能保存，事项仍保留，可继续进入办理。' }
}
function revoke() { epoch++; sources.value = {}; errors.value = []; loading.value = false; session.value = null; readError.value = '' }
function changed() {
  readVersion.value++
  if (!sameCareSession(readSession(), session.value)) void load()
}
onMounted(() => { void load(); window.addEventListener('focus', load); window.addEventListener('storage', changed); window.addEventListener('hulao:unauthorized', revoke) })
onBeforeUnmount(() => { epoch++; window.removeEventListener('focus', load); window.removeEventListener('storage', changed); window.removeEventListener('hulao:unauthorized', revoke) })
</script>
<template>
  <section class="pending-work" aria-label="待我处理">
    <header><h1>待我处理</h1><button class="icon-button" type="button" title="刷新待处理事项" aria-label="刷新待处理事项" :disabled="loading" @click="load"><RefreshCw :size="20" aria-hidden="true" /></button></header>
    <p class="scope">根据当前可查看的待核对记录、交班和安全事件汇总。已读仅保存在此浏览器，不代表已处理；办理状态以业务对象为准。</p>
    <p v-if="!permitted" role="alert">当前账号不能查看内部待处理事项。</p>
    <p v-else-if="session?.mode !== 'api'" role="status">当前为虚构演示环境，待处理汇总需要服务器账号；本机草稿可在恢复日志中继续编辑。</p>
    <template v-else>
      <div class="filters"><label>事项类型<select v-model="filter"><option value="">全部</option><option value="record">待核对记录</option><option value="handover">交班接续</option><option value="incident">照护安全</option></select></label><label class="unread"><input v-model="unreadOnly" type="checkbox" />只看本机未读</label></div>
      <p v-if="loading" role="status">正在核对服务器当前事项…</p>
      <p v-for="error in errors" :key="error" class="error" role="alert">{{ error }}，可刷新重试。</p>
      <p v-if="readError" class="error" role="alert">{{ readError }}</p>
      <p v-if="!loading && !visible.length" role="status">{{ errors.length ? '当前来源未完整载入，暂不能确认是否还有待处理事项。' : items.length ? '没有符合筛选条件的事项。' : '当前可查看范围内暂无待处理事项。' }}</p>
      <ul><li v-for="item in visible" :key="item.key">
        <RouterLink :to="pendingWorkLocation(item, props.mobile)" @click="mark(item)"><span><strong>{{ item.title }}</strong><small>{{ elders.get(item.elderId)?.name || '老人信息未提供' }} · {{ item.status }}</small><small v-if="item.dueAt">期限：{{ new Date(item.dueAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</small></span><ChevronRight :size="18" aria-hidden="true" /></RouterLink>
        <button class="icon-button" type="button" :disabled="isRead(item)" :title="isRead(item) ? '本机已读，仍待办理' : '标记本机已读'" :aria-label="isRead(item) ? '本机已读，仍待办理' : '标记本机已读'" @click="mark(item)"><CheckCheck :size="20" aria-hidden="true" /></button>
      </li></ul>
    </template>
  </section>
</template>
<style scoped>
.pending-work { min-width: 0; overflow-wrap: anywhere; }
header, .filters, li, li > a { display: flex; align-items: center; gap: 12px; }
header { justify-content: space-between; }
h1 { margin: 0; }
.scope, small { color: var(--hl-muted, #5f6b73); font-size: 14px; line-height: 1.6; }
.filters { flex-wrap: wrap; padding-block: 12px; border-block: 1px solid var(--hl-border, #dce3e7); }
.filters label { display: flex; align-items: center; gap: 8px; min-height: 44px; }
select { max-width: 100%; min-height: 40px; padding: 4px 8px; color: var(--hl-ink, #20282e); background: white; border: 1px solid var(--hl-border, #dce3e7); border-radius: 6px; }
ul { padding: 0; list-style: none; }
li { min-height: 88px; border-bottom: 1px solid var(--hl-border, #dce3e7); }
li > a { flex: 1; min-width: 0; justify-content: space-between; padding-block: 12px; color: var(--hl-ink, #20282e); text-decoration: none; }
li > a span { min-width: 0; } strong, small { display: block; }
li > a svg, button { flex-shrink: 0; }
.error { color: var(--hl-danger, #b52d38); }
</style>
