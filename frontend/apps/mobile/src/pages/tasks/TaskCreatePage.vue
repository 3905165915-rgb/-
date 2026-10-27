<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import WorkflowPanel from '@hulao/shared/workflow'
import DemoTaskCreate from '../../../../../packages/shared/src/workflow/DemoTaskCreate.vue'
import { mode } from '../../services/data'
import { ArrowLeft } from 'lucide-vue-next'
const route = useRoute()
const context = computed(() => typeof route.query.elder === 'string' ? { elder_id: route.query.elder } : {})
</script>

<template>
  <section class="task-create-page">
    <RouterLink class="back-link" to="/caregiver"><ArrowLeft :size="18" aria-hidden="true" />返回今日</RouterLink>
    <DemoTaskCreate v-if="mode === 'demo'" :key="String(route.query.elder || '')" :elder-id="typeof route.query.elder === 'string' ? route.query.elder : undefined" mobile />
    <WorkflowPanel v-else group="tasks" title="新建照护任务" initial-action="/tasks" :context="context" task-creation />
  </section>
</template>

<style scoped>
.task-create-page { min-width: 0; }
.back-link { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: #1767cf; }
</style>
