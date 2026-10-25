<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import WorkflowPanel from '@hulao/shared/workflow'

const route = useRoute()
const group = computed(() => String(route.params.group))
const titles: Record<string, string> = { family: '家属沟通办理', memories: '照护记忆核对', changes: '来源变更核验' }
</script>

<template>
  <section>
    <RouterLink to="/notifications">返回待我处理</RouterLink>
    <h1>{{ titles[group] }}</h1>
    <WorkflowPanel :key="route.fullPath" :group="group" :context="route.query" :initial-action="typeof route.query.action === 'string' ? route.query.action : ''" :auto-read="route.query.read === '1'" />
  </section>
</template>
