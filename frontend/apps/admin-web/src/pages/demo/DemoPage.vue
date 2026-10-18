<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { resetDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'
async function reset() { await ElMessageBox.confirm('将恢复305床王阿姨的完整演示链，是否继续？', '重置演示数据', { type: 'warning' }); resetDemoState(); ElMessage.success('演示数据已重置。') }
</script>

<template><section><DemoBanner /><h1>演示保障</h1><el-row :gutter="16" class="metric-grid"><el-col :xs="24" :md="8"><el-card shadow="never"><h3>管理端</h3><p>工作台、档案、计划、任务、质检、家属与回放。</p></el-card></el-col><el-col :xs="24" :md="8"><el-card shadow="never"><h3>护理员端</h3><p>记录 → AI草稿 → 人工确认 → 交班 → 接班。</p></el-card></el-col><el-col :xs="24" :md="8"><el-card shadow="never"><h3>降级方案</h3><p>AI或网络失败时保留原文，并允许人工记录和重试。</p></el-card></el-col></el-row><el-card shadow="never" class="section-card"><el-alert title="全部数据均为虚构演示数据" description="不要录入真实老人资料、录音或密钥。" type="warning" show-icon :closable="false" /><el-button class="section-action" type="primary" @click="reset">重置305床案例</el-button></el-card></section></template>
