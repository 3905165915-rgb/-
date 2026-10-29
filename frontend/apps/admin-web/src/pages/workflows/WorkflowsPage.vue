<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import WorkflowPanel from '@hulao/shared/workflow'
import DemoRecordsHub from '../../../../../packages/shared/src/workflow/DemoRecordsHub.vue'
import DemoHandovers from '../../../../../packages/shared/src/workflow/DemoHandovers.vue'
import { mode } from '../../services/data'
import CareSafety from '@hulao/shared/care-safety'
import ElderRecordEntry from '../../../../../packages/shared/src/workflow/ElderRecordEntry.vue'
import ChangeReviewCenter from '../../../../../packages/shared/src/workflow/ChangeReviewCenter.vue'
const route = useRoute()
const group = computed(() => String(route.params.group || 'records'))
const quickRecord = computed(
  () =>
    group.value === 'records' &&
    !['record_id', 'draft_id', 'attachment_id', 'analysis_id', 'read'].some(
      (key) => typeof route.query[key] === 'string',
    ) &&
    (!route.query.action || route.query.action === '/records/manual'),
)
const titles: Record<string, string> = {
  elders: '老人档案办理',
  admission: '入住与床位',
  assessments: '人工评估',
  plans: '照护计划',
  records: '记录',
  tasks: '任务处理与依据核验',
  shifts: '班次管理',
  handovers: '跨班交接',
  quality: '质量检查',
  memories: '个性化照护记忆',
  changes: '来源变更核验',
  family: '家属授权与沟通',
  incidents: '安全事件处置',
  reports: '运营指标与证据导出',
  staff: '员工账号与责任清单',
}
</script>
<template>
  <section>
    <CareSafety
      v-if="group === 'incidents'"
      :context="route.query"
      record-path="/workflows/records"
      :report="route.query.report === '1'"
    />
    <ChangeReviewCenter
      v-else-if="group === 'changes'"
      :context="route.query"
    />
    <DemoRecordsHub
      v-else-if="group === 'records' && mode === 'demo'"
    /><DemoHandovers v-else-if="group === 'handovers' && mode === 'demo'" />
    <template v-else-if="quickRecord">
      <ElderRecordEntry
        :key="String(route.query.elder || route.query.elder_id || 'choose')"
        :elder-id="
          typeof route.query.elder === 'string'
            ? route.query.elder
            : typeof route.query.elder_id === 'string'
              ? route.query.elder_id
              : undefined
        "
      />
    </template>
    <template v-else>
      <h1>{{ titles[group] || '业务办理' }}</h1>
      <WorkflowPanel
        :key="group"
        :group="group"
        :context="route.query"
        :initial-action="
          typeof route.query.action === 'string' ? route.query.action : ''
        "
        :auto-read="route.query.read === '1'"
      />
    </template>
  </section>
</template>
