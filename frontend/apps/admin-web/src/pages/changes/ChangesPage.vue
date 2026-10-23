<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
</script>
<template>
  <section>
    <h1>变化简报与变更核验</h1>
    <WorkflowPanel group="brief" title="新增、更正和重要遗留" /><WorkflowPanel
      group="changes"
      title="受影响任务的指派、核验和独立复查"
    />
  </section>
</template>
