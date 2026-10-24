<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { compactReference } from '@hulao/shared'
import { useTasks, useTimeline, mode } from '../../services/data'
import FeedbackState from '../../components/FeedbackState.vue'
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
  <section class="timeline-page">
    <h1>过程回放</h1>
    <label class="select-field">事项<select
      :value="itemId"
      :disabled="tasks.isPending.value || !!tasks.error.value"
      @change="select(($event.target as HTMLSelectElement).value)"
    >
      <option value="">请选择事项</option>
      <option
        v-if="itemId && !items.some((item) => item.id === itemId)"
        :value="itemId"
      >
        {{ compactReference(itemId) }}
      </option>
      <option
        v-for="item in items"
        :key="item.id"
        :value="item.id"
      >
        {{ item.title }} · {{ compactReference(item.id) }}
      </option>
    </select></label><FeedbackState
      :loading="tasks.isPending.value"
      :error="tasks.error.value"
      @retry="tasks.refetch()"
    /><van-empty
      v-if="!itemId && !tasks.isPending.value && !tasks.error.value"
      description="请选择有事项编号的任务"
    /><template v-if="itemId">
      <p class="muted">
        事项编号：{{ compactReference(itemId) }}
      </p>
      <FeedbackState
        :loading="timeline.isPending.value"
        :error="timeline.error.value"
        :empty="
          !timeline.isPending.value &&
            !timeline.error.value &&
            !timeline.data.value?.length
        "
        @retry="timeline.refetch()"
      />
      <ol
        v-if="
          !timeline.isPending.value &&
            !timeline.error.value &&
            timeline.data.value?.length
        "
        class="timeline-events"
        aria-label="事项时间线"
      >
        <li
          v-for="event in timeline.data.value"
          :key="event.id"
        >
          <h2>{{ event.label }}</h2>
          <p class="timeline-detail">
            {{ event.detail }}
          </p>
          <p class="muted">
            发生：{{ event.happenedAt || '未提供' }}
          </p>
          <p class="muted">
            录入：{{ event.enteredAt || '未提供' }} ·
            {{ event.actor || '操作者未提供' }}
          </p>
          <van-tag
            v-if="mode === 'demo' && event.source === 'demo'"
            type="warning"
          >
            演示
          </van-tag>
        </li>
      </ol>
    </template>
  </section>
</template>
