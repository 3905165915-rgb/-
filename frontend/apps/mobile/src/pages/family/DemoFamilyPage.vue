<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { RefreshCw } from 'lucide-vue-next'
import {
  familyCaseStatusMeta,
  resolveStatus,
  loadDemoState,
} from '@hulao/shared'
import {
  familyDemoRecords,
  demoTime,
} from '../../../../../packages/shared/src/demo-metrics'
import { useFamilyCases, mode, queryKey, session } from '../../services/data'
import FeedbackState from '../../components/FeedbackState.vue'
const cases = useFamilyCases()
const demo = useQuery({
  queryKey: computed(() => queryKey('family-life-preview')),
  queryFn: loadDemoState,
  enabled: computed(
    () =>
      mode === 'demo' &&
      session.value?.mode === 'demo' &&
      session.value?.role === 'family',
  ),
})
const lifeRecords = computed(() =>
  familyDemoRecords(!demo.error.value ? demo.data.value : undefined),
)
const fetching = computed(() =>
  mode === 'demo' ? demo.isFetching.value : cases.isFetching.value,
)
function refresh() {
  return mode === 'demo' ? demo.refetch() : cases.refetch()
}
function statusMeta(status: unknown) {
  return resolveStatus(familyCaseStatusMeta, status)
}
</script>
<template>
  <section class="family-page">
    <div class="page-title-row">
      <h1>{{ mode === 'demo' ? '王爷爷近况' : '家属动态' }}</h1>
      <button
        type="button"
        class="icon-button"
        title="刷新家属动态"
        aria-label="刷新家属动态"
        :disabled="fetching"
        @click="refresh"
      >
        <RefreshCw
          :size="20"
          :class="{ 'is-spinning': fetching }"
          aria-hidden="true"
        />
      </button>
    </div>
    <template v-if="mode === 'demo'">
      <p class="muted">
        虚构演示 · 仅展示已授权的生活记录，按发生时间从近到远排列。
      </p>
      <FeedbackState
        :loading="demo.isPending.value"
        :error="demo.error.value"
        :empty="
          !demo.isPending.value && !demo.error.value && !lifeRecords.length
        "
        empty-text="暂无已授权生活记录"
        @retry="demo.refetch()"
      />
      <ol
        v-if="!demo.isPending.value && !demo.error.value && lifeRecords.length"
        class="life-timeline"
        aria-label="王爷爷已授权生活时间线"
      >
        <li v-for="record in lifeRecords" :key="record.id">
          <article class="family-life-record">
            <time :datetime="record.happenedAt">{{
              demoTime(record.happenedAt)
            }}</time>
            <h2>{{ record.title }}</h2>
            <p>{{ record.content }}</p>
            <p class="muted">
              {{ record.category }} · {{ record.actor || '记录人未提供' }}
            </p>
          </article>
        </li>
      </ol>
    </template>
    <template v-else>
      <FeedbackState
        :loading="cases.isPending.value"
        :error="cases.error.value"
        :empty="
          !cases.isPending.value &&
          !cases.error.value &&
          !cases.data.value?.length
        "
        empty-text="暂无已授权内容"
        @retry="cases.refetch()"
      />
      <div
        v-if="
          !cases.isPending.value &&
          !cases.error.value &&
          cases.data.value?.length
        "
        class="family-feed"
      >
        <article
          v-for="item in cases.data.value"
          :key="item.id"
          class="family-item"
        >
          <h2>{{ item.subject }}</h2>
          <span
            class="status-label"
            :data-tone="statusMeta(item.status).tone"
            :title="
              statusMeta(item.status).known ? undefined : String(item.status)
            "
            >{{ statusMeta(item.status).label }}</span
          >
          <p class="family-reply">
            {{ item.reply || '暂无回复' }}
          </p>
        </article>
      </div>
      <p class="muted">
        仅显示授权范围内的已审核简报与反馈，可在下方提交问题和查看回复。
      </p>
      <WorkflowPanel
        group="family"
        title="我的授权、服务简报与问题沟通"
        @changed="cases.refetch()"
      />
    </template>
  </section>
</template>
<style scoped>
.family-page {
  min-width: 0;
  overflow-wrap: anywhere;
}
.life-timeline {
  list-style: none;
  margin: 20px 0;
  padding: 0 0 0 16px;
  border-left: 2px solid #c8d9ef;
}
.life-timeline li {
  position: relative;
  padding: 0 0 20px;
}
.life-timeline li::before {
  content: '';
  position: absolute;
  left: -22px;
  top: 5px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #1767cf;
}
.family-life-record {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--hl-border, #dce1e8);
  border-radius: 10px;
  background: white;
}
.family-life-record time {
  color: #52657b;
  font-size: 13px;
}
.family-life-record h2 {
  margin: 8px 0;
  font-size: 17px;
}
.family-life-record p {
  margin: 8px 0 0;
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
