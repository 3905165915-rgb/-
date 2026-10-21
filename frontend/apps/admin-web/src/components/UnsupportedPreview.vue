<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { loadDemoState } from '@hulao/shared'
import { mode, queryKey } from '../services/data'
import QueryFeedback from './QueryFeedback.vue'
import StatusLabel from './StatusLabel.vue'
defineProps<{
  title: string
  kind:
    | 'admission'
    | 'assessment'
    | 'care-plan'
    | 'quality'
    | 'coverage'
    | 'changes'
}>()
const state = useQuery({
  queryKey: computed(() => queryKey('demo-preview')),
  queryFn: loadDemoState,
  enabled: mode === 'demo',
})
const warnings = computed(
  () =>
    state.data.value?.drafts.flatMap((draft) =>
      draft.warnings.map((warning, index) => ({
        id: draft.id + ':' + index,
        warning,
        evidence: draft.originalText,
        status: draft.status,
      })),
    ) ?? [],
)
</script>
<template>
  <section>
    <h1>{{ title }}</h1>
    <div class="data-section">
      <el-empty
        v-if="mode === 'api'"
        description="此功能暂未接入，当前不可操作"
      /><template v-else>
        <el-alert
          title="只读演示预览"
          class="unsupported-notice"
          type="info"
          :closable="false"
        /><QueryFeedback
          :loading="state.isPending.value"
          :error="state.error.value"
          @retry="state.refetch()"
        />
        <template v-if="state.data.value">
          <el-table
            v-if="kind === 'admission' || kind === 'assessment'"
            :data="state.data.value.elders"
            stripe
          >
            <el-table-column
              prop="name"
              label="姓名"
              min-width="120"
            /><el-table-column
              prop="bedLabel"
              label="床位"
              min-width="100"
            /><el-table-column
              prop="status"
              label="入住状态"
              min-width="100"
            /><el-table-column
              v-if="kind === 'assessment'"
              prop="risk"
              label="模拟风险"
              min-width="100"
            /><el-table-column
              prop="notes"
              label="注意事项"
              min-width="240"
            />
          </el-table>
          <el-table
            v-if="kind === 'care-plan' || kind === 'coverage'"
            :data="state.data.value.tasks"
            stripe
          >
            <el-table-column
              prop="title"
              :label="kind === 'care-plan' ? '模拟服务项目' : '待核对任务'"
              min-width="240"
            /><el-table-column
              prop="assignee"
              label="责任人"
              min-width="100"
            /><el-table-column
              prop="dueAt"
              label="期限"
              min-width="150"
            /><el-table-column
              prop="result"
              label="已记录结果"
              min-width="240"
            />
          </el-table>
          <p
            v-if="kind === 'coverage'"
            class="muted"
          >
            空白结果表示缺少记录，不能据此判定未服务。
          </p>
          <el-table
            v-if="kind === 'quality'"
            :data="warnings"
            stripe
            empty-text="暂无模拟提示"
          >
            <el-table-column
              prop="warning"
              label="待核对提示"
              min-width="240"
            /><el-table-column
              prop="evidence"
              label="原文"
              min-width="280"
            /><el-table-column
              label="草稿状态"
              min-width="120"
            >
              <template #default="{ row }">
                <StatusLabel
                  :status="row.status"
                  kind="draft"
                />
              </template>
            </el-table-column>
          </el-table>
          <el-timeline
            v-if="kind === 'changes'"
            class="section-content"
          >
            <el-timeline-item
              v-for="event in state.data.value.timeline"
              :key="event.id"
              :timestamp="event.enteredAt"
            >
              <b>{{ event.label }}</b>
              <p>{{ event.detail }}</p>
              <el-button
                v-if="event.itemId"
                link
                @click="
                  $router.push('/timeline/' + encodeURIComponent(event.itemId))
                "
              >
                查看事项回放
              </el-button>
            </el-timeline-item>
          </el-timeline>
        </template>
      </template>
    </div>
  </section>
</template>
