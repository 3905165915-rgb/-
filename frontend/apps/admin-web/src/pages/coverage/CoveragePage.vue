<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
</script>
<template>
  <section>
    <h1>双向核对</h1>
    <WorkflowPanel
      group="coverage"
      title="计划要求与实际登记结果"
    /><WorkflowPanel group="tasks" title="按任务核对个性化、条件和计划依据" />
  </section>
</template>
