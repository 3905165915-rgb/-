<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DemoBanner from '../../components/DemoBanner.vue'
const published = ref(false); const version = ref('v3')
async function publish() { await ElMessageBox.confirm('发布前将影响未来任务和责任人，是否继续？', '影响预览', { type: 'warning' }); published.value = true; ElMessage.success('演示计划已发布，历史完成任务保持原版。') }
</script>

<template><section><DemoBanner /><div class="page-title-row"><div><h1>照护计划</h1><p class="muted">计划版本、服务项目和发布影响范围</p></div><el-tag :type="published ? 'success' : 'warning'">{{ published ? '已发布' : '草稿' }} · {{ version }}</el-tag></div><el-card shadow="never" class="section-card"><el-table :data="[{ name: '进食观察', time: '午餐/晚餐', frequency: '每日', owner: '护理员' }, { name: '家属沟通', time: '晚餐不足时', frequency: '按需', owner: '主管' }]" border><el-table-column prop="name" label="服务项目" /><el-table-column prop="time" label="时段" /><el-table-column prop="frequency" label="频次" /><el-table-column prop="owner" label="责任岗位" /></el-table><el-divider /><el-alert title="影响预览" description="将生成 2 条未来任务，1 位责任人需重新确认；已完成任务不会被改写。" type="info" show-icon /><el-button type="primary" class="section-action" @click="publish">发布计划</el-button></el-card></section></template>
