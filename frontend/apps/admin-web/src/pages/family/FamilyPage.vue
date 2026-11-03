<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { loadDemoState } from '@hulao/shared'
import { RefreshCw } from 'lucide-vue-next'
import {
  familyDemoRecords,
  demoTime,
} from '../../../../../packages/shared/src/demo-metrics'
import { useFamilyCases, mode, queryKey, session } from '../../services/data'
import QueryFeedback from '../../components/QueryFeedback.vue'
import StatusLabel from '../../components/StatusLabel.vue'
const cases = useFamilyCases()
const demo = useQuery({
  queryKey: computed(() => queryKey('family-life-preview')),
  queryFn: loadDemoState,
  enabled: computed(
    () =>
      mode === 'demo' &&
      session.value?.mode === 'demo' &&
      ['admin', 'supervisor', 'family'].includes(session.value?.role ?? ''),
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
</script>
<template>
  <section class="family-page">
    <div class="page-title-row">
      <h1>{{ mode === 'demo' ? '王爷爷近况' : '家属沟通' }}</h1>
      <el-button
        class="icon-button"
        title="刷新家属沟通"
        aria-label="刷新家属沟通"
        :loading="fetching"
        @click="refresh"
      >
        <RefreshCw
          :size="18"
          aria-hidden="true"
        />
      </el-button>
    </div>
    <template v-if="mode === 'demo'">
      <p class="muted">
        虚构演示 · 仅展示已授权的生活记录，按发生时间从近到远排列。
      </p>
      <QueryFeedback
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
        <li
          v-for="record in lifeRecords"
          :key="record.id"
        >
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
      <div class="data-section">
        <QueryFeedback
          :loading="cases.isPending.value"
          :error="cases.error.value"
          @retry="cases.refetch()"
        /><el-table
          v-if="!cases.isPending.value && !cases.error.value"
          :data="cases.data.value ?? []"
          empty-text="暂无公开内容"
        >
          <el-table-column
            prop="subject"
            label="诉求"
            min-width="200"
          /><el-table-column
            label="状态"
            min-width="100"
          >
            <template #default="{ row }">
              <StatusLabel
                :status="row.status"
                kind="family"
              />
            </template>
          </el-table-column><el-table-column
            prop="reply"
            label="公开回复"
            min-width="280"
          />
        </el-table>
      </div>
      <p class="muted">
        在下方新建家属账号、授权老人、编写并审核简报，以及回复家属问题。
      </p>
      <WorkflowPanel
        group="family"
        title="家属账号、授权与服务沟通"
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
  padding: 14px;
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
