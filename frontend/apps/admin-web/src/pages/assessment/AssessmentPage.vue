<script setup lang="ts">
import { ref } from 'vue'
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'
const elder = ref(readDemoState().elders[0])
const score = ref(62)
</script>

<template><section><DemoBanner /><div class="page-title-row"><div><h1>评估与风险</h1><p class="muted">分数和规则以后端结果为准，前端只呈现版本和提示</p></div><el-tag type="warning">复评日期：2026-11-18</el-tag></div><el-card shadow="never" class="section-card"><el-descriptions :column="2" border><el-descriptions-item label="老人">{{ elder.name }} · {{ elder.id }}</el-descriptions-item><el-descriptions-item label="版本">评估 v1.2</el-descriptions-item><el-descriptions-item label="后端分数"><el-progress :percentage="score" :color="score > 70 ? '#f56c6c' : '#e6a23c'" /></el-descriptions-item><el-descriptions-item label="风险提示"><el-tag type="warning">中风险 · 需关注进食</el-tag></el-descriptions-item></el-descriptions></el-card><el-card shadow="never" class="section-card"><template #header>历史版本</template><el-timeline><el-timeline-item timestamp="2026-10-18">v1.2 · 后端算分 · 当前</el-timeline-item><el-timeline-item timestamp="2026-09-18">v1.1 · 已归档</el-timeline-item></el-timeline></el-card></section></template>
