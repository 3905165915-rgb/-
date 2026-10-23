<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import WorkflowPanel from '@hulao/shared/workflow'
const route = useRoute()
const group = computed(() => String(route.params.group || 'records'))
const titles: Record<string, string> = {
  elders: '老人档案办理',
  admission: '入住与床位',
  assessments: '人工评估',
  plans: '照护计划',
  records: '照护记录与AI助手',
  tasks: '任务处理与依据核验',
  shifts: '班次管理',
  handovers: '跨班交接与AI摘要',
  quality: '规则与AI质检',
  memories: '个性化照护记忆',
  changes: '来源变更核验',
  family: '家属授权与沟通',
  incidents: '不良事件与整改',
  reports: '运营指标与证据导出',
  staff: '员工账号与责任清单',
}
</script>
<template>
  <section>
    <h1>{{ titles[group] || '业务办理' }}</h1>
    <WorkflowPanel :key="group" :group="group" :context="route.query" />
  </section>
</template>
