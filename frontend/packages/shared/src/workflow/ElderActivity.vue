<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { loadDemoState, subscribeDemo } from '../demo-store'
import { readSession, type AppMode, type FrontendSession } from '../session'
import { display, listAll, request } from './model'
import { sameCareSession } from './task-care-context'
import {
  activityFilterError,
  activityTypes,
  createElderActivity,
  filterElderActivity,
  type ActivityFilter,
  type ActivityReference,
} from './elder-activity'

const props = defineProps<{ elderId: string; mode: AppMode; session: FrontendSession | null }>()
const titleId = useId()
const filterId = useId()
const detailId = useId()
const context = createElderActivity({
  list: listAll, request,
  session: () => sameCareSession(readSession(), props.session) ? readSession() : null,
  demoTasks: async () => (await loadDemoState()).tasks,
})
const state = context.state
const detail = context.detail
const filter = ref<ActivityFilter>({ type: '', start: '', end: '' })
const limit = ref(30)
const lastReference = ref<ActivityReference>()
const detailRegion = ref<HTMLElement>()
let opener: HTMLElement | null = null
const items = computed(() => state.value.elderId === props.elderId
  ? Object.values(state.value.slots).flatMap((slot) => slot.items) : [])
const filtered = computed(() => filterElderActivity(items.value, props.elderId, filter.value))
const filterError = computed(() => activityFilterError(filter.value))
const missingTimes = computed(() => items.value.filter((item) => item.timestamp === null).length)
const failures = computed(() => Object.entries(state.value.slots).flatMap(([type, slot]) =>
  slot.status === 'error' || slot.status === 'denied'
    ? [`${activityTypes[type as keyof typeof activityTypes]}${slot.status === 'denied' ? '暂不可访问' : '加载失败'}`] : []))
function refresh() { void context.load(props.elderId, props.mode) }
function reset() { filter.value = { type: '', start: '', end: '' } }
function reload() {
  reset()
  lastReference.value = undefined
  refresh()
}
function revoke() { context.clear(true) }
function checkSession() {
  if (!sameCareSession(readSession(), props.session)) revoke()
}
function openDetail(reference: ActivityReference, event?: Event) {
  if (event?.currentTarget instanceof HTMLElement) opener = event.currentTarget
  lastReference.value = reference
  void context.openDetail(reference)
  void nextTick(() => detailRegion.value?.focus())
}
function closeDetail() {
  context.closeDetail()
  opener?.focus()
}
function time(value: string) {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}
watch(() => [props.elderId, props.mode, props.session?.mode, props.session?.accountKey,
  props.session?.role, props.session?.userId, props.session?.accessToken], reload,
  { immediate: true, flush: 'sync' })
watch(filter, () => { limit.value = 30 }, { deep: true })
const unsubscribe = subscribeDemo(() => { if (props.mode === 'demo') refresh() })
onMounted(() => {
  window.addEventListener('hulao:unauthorized', revoke)
  window.addEventListener('focus', checkSession)
  window.addEventListener('storage', checkSession)
})
onBeforeUnmount(() => {
  context.clear()
  unsubscribe()
  window.removeEventListener('hulao:unauthorized', revoke)
  window.removeEventListener('focus', checkSession)
  window.removeEventListener('storage', checkSession)
})
</script>

<template>
  <section class="elder-activity" :aria-labelledby="titleId">
    <header class="activity-heading">
      <h2 :id="titleId">老人动态</h2>
      <button type="button" :disabled="state.status === 'pending'" @click="refresh">刷新动态</button>
    </header>
    <p class="activity-scope">
      {{ mode === 'demo'
        ? '本地虚构演示：仅展示可关联的演示任务，未提供活动时间的任务不参加日期筛选。'
        : '汇总当前账号可访问的记录、任务、交班事项、安全事件和照护记忆列表，不代表完整历史时间线。' }}
    </p>
    <fieldset class="activity-filters" :aria-describedby="filterId">
      <legend>筛选老人动态</legend>
      <label>类型<select v-model="filter.type">
        <option value="">全部类型</option>
        <option v-for="(label, type) in activityTypes" :key="type" :value="type">{{ label }}</option>
      </select></label>
      <label>开始日期<input v-model="filter.start" type="date" :aria-invalid="!!filterError" /></label>
      <label>结束日期<input v-model="filter.end" type="date" :aria-invalid="!!filterError" /></label>
      <button type="button" @click="reset">重置筛选</button>
    </fieldset>
    <p :id="filterId" class="activity-scope">按每项首个有效活动时间筛选，北京时间，含结束日期当天。</p>
    <p v-if="filterError" role="alert">{{ filterError }}</p>
    <p v-if="missingTimes" class="activity-scope">{{ missingTimes }} 项未提供有效活动时间；选择日期后隐藏。</p>
    <p v-if="state.status === 'pending'" role="status">正在加载可访问的动态…</p>
    <p v-if="state.status === 'denied'" role="alert">登录或访问权限已变化，请重新登录后查看。</p>
    <div v-if="failures.length" class="activity-error" role="alert">
      <p>{{ state.status === 'error' ? '动态未能载入。' : '部分动态未载入，当前结果不完整。' }}{{ failures.join('；') }}。</p>
      <button type="button" :disabled="state.status === 'pending'" @click="refresh">重试加载动态</button>
    </div>
    <section
      v-if="detail.status !== 'idle'"
      :id="detailId"
      ref="detailRegion"
      class="activity-detail"
      tabindex="-1"
      aria-label="动态来源与详情"
    >
      <div class="activity-heading"><h3>来源与详情</h3><button type="button" @click="closeDetail">关闭详情</button></div>
      <p v-if="detail.status === 'pending'" role="status">正在读取详情…</p>
      <div v-else-if="detail.status === 'error'" role="alert">
        <p>详情未载入、不可访问或与当前老人不匹配。</p>
        <button v-if="lastReference" type="button" @click="openDetail(lastReference)">重试详情</button>
      </div>
      <template v-else-if="detail.item">
        <h4>{{ detail.item.title }}</h4>
        <p>{{ activityTypes[detail.item.type] }} · {{ display(detail.item.status, 'status') }}</p>
        <p class="activity-text">{{ detail.item.text || '未提供文字内容' }}</p>
        <p class="activity-scope">编号：{{ detail.item.reference.id }}</p>
        <p v-for="stamp in detail.item.times" :key="stamp.label" class="activity-scope">
          {{ stamp.label }}：{{ stamp.timestamp === null ? '时间格式异常，未参与筛选' : time(stamp.value) }}
        </p>
        <div class="activity-actions">
          <button v-for="(source, index) in detail.item.sources" :key="source.type + source.id" type="button" @click="openDetail(source)">查看来源{{ activityTypes[source.type] }}{{ detail.item.sources.length > 1 ? ' ' + (index + 1) : '' }}</button>
          <RouterLink v-if="detail.item.detailUrl" :to="detail.item.detailUrl">打开任务</RouterLink>
          <RouterLink v-if="detail.item.replayUrl" :to="detail.item.replayUrl">事项回放</RouterLink>
        </div>
      </template>
    </section>
    <p v-if="!filterError && (state.status === 'ready' || state.status === 'partial') && !filtered.length" role="status">
      {{ state.status === 'partial' ? '已载入部分暂无匹配动态，请重试未载入的列表。' : '当前可访问列表中暂无匹配动态。' }}
    </p>
    <p v-if="filtered.length" class="activity-scope" role="status">匹配 {{ filtered.length }} 项，显示 {{ Math.min(limit, filtered.length) }} 项</p>
    <ol v-if="!filterError && filtered.length" class="activity-list" aria-label="当前老人的可访问动态">
      <li v-for="item in filtered.slice(0, limit)" :key="item.key" class="activity-item">
        <p class="activity-kind">{{ activityTypes[item.type] }} · {{ display(item.status, 'status') }}</p>
        <h3>{{ item.title }}</h3>
        <p v-if="item.text" class="activity-text">{{ item.text.slice(0, 240) }}{{ item.text.length > 240 ? '…' : '' }}</p>
        <p v-if="!item.times.length" class="activity-scope">活动时间未提供</p>
        <p v-for="stamp in item.times" :key="stamp.label" class="activity-scope">
          {{ stamp.label }}：<time v-if="stamp.timestamp !== null" :datetime="stamp.value">{{ time(stamp.value) }}</time>
          <span v-else>时间格式异常，未参与筛选</span>
        </p>
        <div class="activity-actions">
          <RouterLink v-if="item.detailUrl" :to="item.detailUrl">任务详情</RouterLink>
          <button v-if="mode === 'api'" type="button" :aria-controls="detailId" @click="openDetail(item.reference, $event)">查看{{ activityTypes[item.type] }}详情</button>
          <template v-if="mode === 'api'">
            <button v-for="(source, index) in item.sources" :key="source.type + source.id" type="button" :aria-controls="detailId" @click="openDetail(source, $event)">查看来源{{ activityTypes[source.type] }}{{ item.sources.length > 1 ? ' ' + (index + 1) : '' }}</button>
          </template>
          <RouterLink v-if="item.replayUrl" :to="item.replayUrl">事项回放</RouterLink>
        </div>
      </li>
    </ol>
    <button v-if="filtered.length > limit" type="button" @click="limit += 30">显示更多动态</button>
  </section>
</template>

<style scoped>
.elder-activity { margin-top: 20px; border-top: 1px solid var(--hl-border, #cdd6e0); padding-top: 12px; color: var(--hl-ink, #172c45); overflow-wrap: anywhere; }
.activity-heading, .activity-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; }
.activity-heading { justify-content: space-between; }
.activity-heading h2, .activity-heading h3 { margin: 8px 0; }
.activity-scope, .activity-kind { font-size: 14px; color: var(--hl-muted, #4d6078); line-height: 1.6; }
.activity-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; border: 1px solid var(--hl-border, #cdd6e0); border-radius: 8px; padding: 12px; min-width: 0; }
.activity-filters label { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.activity-filters input, .activity-filters select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; color: inherit; background: var(--hl-surface, #fff); border: 1px solid var(--hl-border, #cdd6e0); border-radius: 6px; padding: 6px; font: inherit; }
.elder-activity button, .activity-actions a { min-height: 44px; display: inline-flex; align-items: center; color: var(--hl-primary, #1767cf); font: inherit; }
.elder-activity button { border: 1px solid var(--hl-border, #cdd6e0); border-radius: 6px; padding: 8px 12px; background: var(--hl-surface, #fff); cursor: pointer; }
.elder-activity button:disabled { color: var(--hl-muted, #4d6078); cursor: wait; }
.activity-list { list-style: none; padding: 0; margin: 12px 0; }
.activity-item { padding: 14px 0; border-bottom: 1px solid var(--hl-border, #cdd6e0); }
.activity-item h3 { font-size: 16px; margin: 6px 0; }
.activity-item p { margin: 6px 0; }
.activity-text { white-space: pre-wrap; line-height: 1.6; }
.activity-detail, .activity-error { border: 1px solid var(--hl-border, #cdd6e0); border-radius: 8px; padding: 12px; margin-top: 12px; background: var(--hl-surface, #fff); }
.elder-activity :is(button, a, input, select):focus-visible, .activity-detail:focus { outline: 3px solid var(--hl-primary, #1767cf); outline-offset: 2px; }
@media (max-width: 360px) { .activity-filters { grid-template-columns: minmax(0, 1fr); } }
</style>
