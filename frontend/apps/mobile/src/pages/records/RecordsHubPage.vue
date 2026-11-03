<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import WorkflowPanel from '@hulao/shared/workflow'
import DemoRecordsHub from '../../../../../packages/shared/src/workflow/DemoRecordsHub.vue'
import { mode } from '../../services/data'
const route = useRoute()
const action = computed(() => route.query.tab === 'drafts' ? '/records/drafts' : route.query.tab === 'history' ? '/records' : '/records/context-extract')
</script>
<template>
  <section><h1>记录</h1><DemoRecordsHub v-if="mode === 'demo'" mobile /><WorkflowPanel v-else group="records" title="记录" :context="route.query" :initial-action="action" :auto-read="route.query.tab === 'history' || route.query.tab === 'drafts'" /></section>
</template>
