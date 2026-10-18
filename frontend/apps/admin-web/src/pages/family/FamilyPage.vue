<script setup lang="ts">
import { ref } from 'vue'
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'
const state = ref(readDemoState())
</script>

<template><section><DemoBanner /><h1>家属沟通</h1><el-card shadow="never" class="section-card"><el-table :data="state.familyCases.filter((item) => item.public)" border><el-table-column prop="subject" label="诉求" /><el-table-column prop="status" label="状态" /><el-table-column prop="reply" label="审核回复" min-width="300" /><el-table-column label="可见范围"><template #default><el-tag type="success">已审核可见</el-tag></template></el-table-column></el-table><el-alert class="section-action" title="已读不等于完成；真实推送接入前，页面会明确标注为演示通知。" type="info" show-icon /></el-card></section></template>
