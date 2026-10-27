<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { compactReference, formatBusinessTime } from '@hulao/shared'
import { useTasks, useTimeline } from '../../services/data'
import QueryFeedback from '../../components/QueryFeedback.vue'
const route = useRoute()
const router = useRouter()
const tasks = useTasks()
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
const timeline = useTimeline(() => itemId.value)
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
      <el-form
        label-position="top"
        class="timeline-filter"
      >
        <el-form-item label="事项">
          <el-select
            :model-value="itemId"
            clearable
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
        </el-form-item>
      </el-form><QueryFeedback
        :loading="tasks.isPending.value"
        :error="tasks.error.value"
        @retry="tasks.refetch()"
      /><el-empty
        v-if="!itemId && !tasks.isPending.value && !tasks.error.value"
        description="请选择有事项编号的任务"
      /><template v-if="itemId">
        <details><summary>事项标识</summary><p>{{ compactReference(itemId) }}</p></details>
        <QueryFeedback
          :loading="timeline.isPending.value"
          :error="timeline.error.value"
          :empty="
            !timeline.isPending.value &&
              !timeline.error.value &&
              !timeline.data.value?.length
          "
          @retry="timeline.refetch()"
        /><el-timeline
          v-if="!timeline.isPending.value && !timeline.error.value"
        >
          <el-timeline-item
            v-for="event in timeline.data.value"
            :key="event.id"
            :timestamp="
              '发生：' +
                (event.happenedAt ? formatBusinessTime(event.happenedAt, true) : '未提供') +
                ' · 录入：' +
                (event.enteredAt ? formatBusinessTime(event.enteredAt, true) : '未提供')
            "
          >
            <h3>{{ event.label }}</h3>
            <p>{{ event.detail }}</p>
            <p class="muted">
              {{ event.actor || '操作者未提供' }}
              <el-tag
                v-if="event.source === 'demo'"
                type="warning"
                size="small"
              >
                演示
              </el-tag>
            </p>
          </el-timeline-item>
        </el-timeline>
      </template>
    </div>
  </section>
</template>
