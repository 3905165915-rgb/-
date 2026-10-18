<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'
const route = useRoute(); const state = readDemoState(); const elder = computed(() => state.elders.find((item) => item.id === route.params.id) ?? state.elders[0])
</script>

<template><section><DemoBanner /><h1>过程回放 · {{ elder?.name }}</h1><el-alert title="时间线区分发生时间与录入时间" type="info" show-icon :closable="false" class="section-card" /><el-card shadow="never" class="section-card"><el-timeline><el-timeline-item v-for="event in state.timeline" :key="event.id" :timestamp="`${event.happenedAt} · 录入 ${event.enteredAt}`" placement="top"><el-card shadow="never"><h3>{{ event.label }}</h3><p>{{ event.detail }}</p><span class="muted">操作者：{{ event.actor }}</span></el-card></el-timeline-item></el-timeline></el-card></section></template>
