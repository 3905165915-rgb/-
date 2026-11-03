<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  compactReference,
  formatBusinessTime,
  groupTimelineEvents,
} from '@hulao/shared'
import { useTasks, useTimeline } from '../../services/data'
import QueryFeedback from '../../components/QueryFeedback.vue'
const route = useRoute()
const router = useRouter()
const tasks = useTasks()
const search = ref('')
const itemId = computed(() =>
  typeof route.params.id === 'string' ? route.params.id : '',
)
const items = computed(() => [
  ...new Map(
    (tasks.data.value ?? [])
      .filter((task) => task.itemId)
      .map((task) => [task.itemId!, { id: task.itemId!, title: task.title }]),
  ).values(),
])
const recentItems = computed(() => items.value.filter(item => !search.value.trim() ||
  (item.title+' '+item.id).toLowerCase().includes(search.value.trim().toLowerCase())))
const timeline = useTimeline(() => itemId.value)
const timelineGroups = computed(() => {
  const events = (timeline.data.value ?? []).map((event) => ({
    ...event,
    recordedAt: event.recordedAt || event.enteredAt || '',
  }))
  const groups = groupTimelineEvents(events)
  const groupedIds = new Set(
    groups.flatMap((group) => group.events.map((event) => event.id)),
  )
  const uncertain = events.filter((event) => !groupedIds.has(event.id))
  return uncertain.length
    ? [...groups, { date: '登记日期待核实', events: uncertain }]
    : groups
})
function select(value: string) {
  void router.push(
    value ? '/timeline/' + encodeURIComponent(value) : '/timeline',
  )
}
</script>
<template>
  <section>
    <h1>过程回放</h1>
    <div class="data-section timeline-content">
      <el-form label-position="top" class="timeline-filter">
        <el-form-item label="事项">
          <el-select
            :model-value="itemId"
            clearable
            filterable
            placeholder="请选择事项"
            @change="select"
          >
            <el-option
              v-if="itemId && !items.some((item) => item.id === itemId)"
              :label="compactReference(itemId)"
              :value="itemId"
            /><el-option
              v-for="item in items"
              :key="item.id"
              :value="item.id"
              :label="item.title"
            />
          </el-select>
        </el-form-item> </el-form
      ><QueryFeedback
        :loading="tasks.isPending.value"
        :error="tasks.error.value"
        @retry="tasks.refetch()"
      /><section v-if="!itemId && !tasks.isPending.value && !tasks.error.value" aria-label="可回放事项">
        <h2>可回放事项</h2><p>从已载入且具有明确事项关联的任务进入；事件顺序以服务器登记时间为准。</p>
        <el-input v-model="search" placeholder="搜索事项标题或编号" clearable />
        <p v-if="!recentItems.length">{{items.length ? '没有匹配事项，请调整搜索。' : '尚无可回放的关联事项。'}}</p>
        <ul><li v-for="item in recentItems.slice(0, 20)" :key="item.id"><RouterLink :to="'/timeline/'+encodeURIComponent(item.id)">{{item.title}}</RouterLink></li></ul>
        <p v-if="recentItems.length > 20">显示前 20 项，共 {{recentItems.length}} 项；可输入标题缩小范围。</p>
      </section><template v-if="itemId">
        <details>
          <summary>事项标识</summary>
          <p>{{ compactReference(itemId) }}</p>
        </details>
        <QueryFeedback
          :loading="timeline.isPending.value"
          :error="timeline.error.value"
          :empty="
            !timeline.isPending.value &&
            !timeline.error.value &&
            !timeline.data.value?.length
          "
          @retry="timeline.refetch()"
        />
        <section
          v-if="!timeline.isPending.value && !timeline.error.value"
          class="timeline-groups"
        >
          <section v-for="group in timelineGroups" :key="group.date">
            <h2>{{ group.date }}</h2>
            <el-timeline>
              <el-timeline-item
                v-for="event in group.events"
                :key="event.id"
                :timestamp="
                  '登记：' +
                  (event.recordedAt
                    ? formatBusinessTime(event.recordedAt, true)
                    : '时间待核实')
                "
              >
                <h3>{{ event.label }}</h3>
                <p>{{ event.detail }}</p>
                <p v-if="event.happenedAt" class="muted">
                  实际发生：{{ formatBusinessTime(event.happenedAt, true) }}
                </p>
                <p class="muted">
                  {{ event.actor || '操作者未提供' }}
                  <el-tag
                    v-if="event.source === 'demo'"
                    type="warning"
                    size="small"
                    >演示</el-tag
                  >
                </p>
              </el-timeline-item>
            </el-timeline>
          </section>
        </section>
      </template>
    </div>
  </section>
</template>
