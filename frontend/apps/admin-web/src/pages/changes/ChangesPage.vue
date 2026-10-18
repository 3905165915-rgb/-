<script setup lang="ts">
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'
const state = readDemoState()
const changes = [{ type: '新增', title: '午餐进食观察记录', detail: '王阿姨 · 305床 · 今天12:30' }, { type: '遗留', title: '晚餐不足时联系女儿', detail: '待晚班执行，不能被已读隐藏' }, { type: '待确认', title: 'AI草稿仍需人工确认', detail: `${state.drafts.length} 条草稿待处理` }]
</script>

<template><section><DemoBanner /><h1>变化简报</h1><el-row :gutter="16" class="metric-grid"><el-col v-for="item in changes" :key="item.title" :xs="24" :md="8"><el-card shadow="never"><el-tag>{{ item.type }}</el-tag><h3>{{ item.title }}</h3><p class="muted">{{ item.detail }}</p></el-card></el-col></el-row></section></template>
