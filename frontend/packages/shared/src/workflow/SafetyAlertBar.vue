<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { readSession } from '../session'
import { request } from './model'
import { sameCareSession } from './task-care-context'
import {
  isUrgentNotification,
  notificationLocation,
  validateNotifications,
  type ServerNotification,
} from './pending-work'

const items = ref<ServerNotification[]>([])
const count = ref(0)
const error = ref('')
let epoch = 0
let timer: ReturnType<typeof setInterval> | undefined
async function refresh() {
  const ticket = ++epoch
  const session = readSession()
  if (
    session?.mode !== 'api' ||
    !['admin', 'supervisor'].includes(session.role || '')
  ) {
    items.value = []
    count.value = 0
    error.value = ''
    return
  }
  try {
    const page = validateNotifications(
      await request(
        '/notifications?pending=true&limit=3&offset=0',
        'get',
        undefined,
        undefined,
        15000,
      ),
    )
    if (ticket !== epoch || !sameCareSession(session, readSession())) return
    items.value = page.items.filter(isUrgentNotification)
    count.value = page.urgent_total ?? items.value.length
    error.value = ''
  } catch {
    if (ticket === epoch && sameCareSession(session, readSession()))
      error.value = '紧急事件通知刷新失败，请刷新核查。'
  }
}
function visibleRefresh() {
  if (document.visibilityState === 'visible') void refresh()
}
function revoke() {
  epoch++
  items.value = []
  count.value = 0
  error.value = ''
}
onMounted(() => {
  void refresh()
  timer = setInterval(visibleRefresh, 30000)
  window.addEventListener('focus', visibleRefresh)
  window.addEventListener('storage', refresh)
  window.addEventListener('hulao:unauthorized', revoke)
  document.addEventListener('visibilitychange', visibleRefresh)
})
onBeforeUnmount(() => {
  epoch++
  clearInterval(timer)
  window.removeEventListener('focus', visibleRefresh)
  window.removeEventListener('storage', refresh)
  window.removeEventListener('hulao:unauthorized', revoke)
  document.removeEventListener('visibilitychange', visibleRefresh)
})
</script>
<template>
  <aside
    v-if="count || error"
    class="safety-alert-bar"
    aria-label="紧急安全事件通知"
    aria-live="polite"
  >
    <div v-if="count">
      <strong>⚠ {{ count }} 条紧急安全事件待处理</strong>
      <p>请立即查看事件详情，安排分级、处置与复查。</p>
    </div>
    <RouterLink v-if="items[0]" :to="notificationLocation(items[0], false)"
      >立即查看事件 →</RouterLink
    >
    <p v-if="error">
      {{ error }} <button type="button" @click="refresh">重试</button>
    </p>
  </aside>
</template>
<style scoped>
.safety-alert-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #f3a59b;
  border-left: 5px solid #b42318;
  border-radius: 8px;
  background: #fff1ef;
  color: #7a271a;
  padding: 16px 20px;
  margin-bottom: 20px;
  overflow-wrap: anywhere;
}
p {
  margin: 6px 0 0;
  line-height: 1.6;
}
a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 16px;
  border-radius: 6px;
  background: #b42318;
  color: white;
  text-decoration: none;
  font-weight: 700;
}
</style>
