<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { display, request, type Row } from './model'
import { activityTypes, activityFilterError } from './elder-activity'
import { itemTimelineGroups, itemTimelinePage, itemTimelineSubjectPath, itemTimelineSubjectTitle } from './item-timeline'
import { useWorkspaceScope } from './workspace-scope'
import WorkflowResult from './WorkflowResult.vue'
const props = defineProps<{ itemId: string; title?: string }>()
const emit = defineEmits<{ subject: [string] }>()
const subjectTitle = ref('')
const scope = useWorkspaceScope()
const items = ref<Row[]>([]), total = ref(0), unverified = ref(0), more = ref(false), loading = ref(false), error = ref('')
const filter = ref({ type: '' as keyof typeof activityTypes | '', start: '', end: '' })
const groups = computed(() => itemTimelineGroups(items.value))
let epoch = 0
const limit = 50
async function load(append = false) {
  if (loading.value || !props.itemId || !scope.valid()) return
  const problem = activityFilterError(filter.value)
  if (problem) { error.value = problem; return }
  const ticket = ++epoch, itemId = props.itemId
  if (!append) { items.value = []; total.value = 0; more.value = false; unverified.value = 0 }
  const offset = append ? items.value.length : 0
  loading.value = true; error.value = ''
  const query = new URLSearchParams({ envelope: 'true', limit: String(limit), offset: String(offset) })
  if (filter.value.type) query.append('event_type', filter.value.type)
  if (filter.value.start) query.set('start', new Date(filter.value.start + 'T00:00:00+08:00').toISOString())
  if (filter.value.end) query.set('end', new Date(Date.parse(filter.value.end + 'T00:00:00+08:00') + 86400000).toISOString())
  try {
    const subjectPath = !append ? itemTimelineSubjectPath(itemId) : null
    const [response, subject] = await Promise.all([request('/items/' + encodeURIComponent(itemId) + '/timeline?' + query), subjectPath ? request(subjectPath).catch(() => null) : Promise.resolve(null)])
    const page = itemTimelinePage(response, offset, limit)
    if (ticket !== epoch || props.itemId !== itemId || !scope.valid()) return
    const title = itemTimelineSubjectTitle(subject, itemId)
    if (title) { subjectTitle.value = title; emit('subject', title) }
    const merged = append ? [...items.value, ...page.items] : page.items
    if (new Set(merged.map(row => row.id)).size !== merged.length) throw new Error('回放节点发生变化，请重新读取。')
    items.value = merged; total.value = page.total; more.value = page.has_more; unverified.value = page.unverified_total
  } catch (failure) { if (ticket === epoch && scope.valid()) error.value = (failure as Error).message }
  finally { if (ticket === epoch) loading.value = false }
}
function reset() { epoch++; items.value = []; total.value = 0; unverified.value = 0; more.value = false; error.value = ''; loading.value = false; subjectTitle.value = ''; emit('subject', '') }
watch(() => props.itemId, () => { reset(); filter.value = { type: '', start: '', end: '' }; void load() }, { immediate: true })
watch(scope.active, value => { if (!value) reset() })
onBeforeUnmount(() => epoch++)
</script>
<template>
  <section
    v-if="scope.active.value"
    class="item-replay"
    aria-label="事项连续过程回放"
  >
    <header>
      <div><h2>{{ title || subjectTitle || '事项办理过程' }}</h2><p>已载入 {{ items.length }} / {{ total }} 个节点<span v-if="unverified"> · {{ unverified }} 个登记时间待核实</span></p></div><button
        type="button"
        :disabled="loading"
        @click="load()"
      >
        刷新过程
      </button>
    </header>
    <form
      class="replay-filters"
      @submit.prevent="load()"
    >
      <label>操作类型<CareSelect v-model="filter.type"><option value="">全部类型</option><option
        v-for="(name,key) in activityTypes"
        :key="key"
        :value="key"
      >{{ name }}</option></CareSelect></label><label>登记开始日期<CareDateTime
        v-model="filter.start"
        type="date"
      /></label><label>登记结束日期（含）<CareDateTime
        v-model="filter.end"
        type="date"
      /></label><button
        type="submit"
        :disabled="loading"
      >
        应用筛选
      </button>
    </form>
    <p
      v-if="loading"
      role="status"
    >
      正在读取办理过程…
    </p><p
      v-if="error"
      class="replay-error"
      role="alert"
    >
      {{ error }} <button
        type="button"
        :disabled="loading"
        @click="load(items.length > 0)"
      >
        重新读取
      </button>
    </p>
    <p v-if="!loading && !error && !items.length">
      当前筛选范围暂无过程记录。
    </p>
    <section
      v-for="group in groups"
      :key="group.date"
      class="replay-group"
    >
      <h3>{{ group.date }}</h3><ol>
        <li
          v-for="event in group.events"
          :key="String(event.id)"
        >
          <article>
            <header>
              <h4>{{ event.label }}</h4><span
                v-if="event.recorded_state"
                class="replay-state"
              >当时状态：{{ display(event.recorded_state, 'status') }}</span>
            </header><p>{{ event.detail }}</p><p class="replay-meta">
              登记：{{ event.recorded_at ? display(event.recorded_at, 'recorded_at') : '待核实' }} · {{ event.actor || '历史人员待核实' }}
            </p><p
              v-if="event.happened_at"
              class="replay-meta"
            >
              实际发生：{{ display(event.happened_at, 'happened_at') }}
            </p><details v-if="event.before || event.after || event.evidence || event.correction || event.decision">
              <summary>查看当时的依据与变更</summary><WorkflowResult :value="{ before: event.before, after: event.after, evidence: event.evidence, correction: event.correction, decision: event.decision }" />
            </details>
          </article>
        </li>
      </ol>
    </section>
    <button
      v-if="more"
      type="button"
      :disabled="loading"
      @click="load(true)"
    >
      加载后续过程
    </button>
  </section>
</template>
<style scoped>
.item-replay{min-width:0;overflow-wrap:anywhere}.item-replay header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.item-replay h2,.item-replay h4{margin:0}.item-replay h4{font-size:16px}.item-replay p{line-height:1.65;margin:8px 0}.replay-filters{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:18px 0}.replay-filters label{display:flex;flex-direction:column;gap:7px;flex:1;min-width:160px}.item-replay button{min-height:44px;padding:9px 14px;border:1px solid var(--hl-border,#ccdcd1);border-radius:9px;background:white;color:var(--hl-primary,#236852);font:inherit;cursor:pointer}.replay-group ol{padding:0 0 0 19px;border-left:2px solid #d7e5dc;list-style:none;margin-left:7px}.replay-group li{position:relative;margin:14px 0}.replay-group li:before{content:'';position:absolute;width:10px;height:10px;left:-25px;top:20px;background:#4a8068;border:2px solid white;border-radius:50%}.replay-group article{background:white;border:1px solid var(--hl-border,#dce5df);padding:16px;border-radius:13px}.replay-meta{color:var(--hl-text-secondary,#53675b);font-size:14px}.replay-state{color:#345f4e;background:#edf5ef;border-radius:6px;padding:3px 7px;font-size:13px}.replay-error{color:#a42b26}.item-replay summary{min-height:44px;display:flex;align-items:center;cursor:pointer}@media(max-width:500px){.replay-filters{display:grid;grid-template-columns:1fr}.replay-filters label{min-width:0}.replay-group article{padding:12px}}
</style>
