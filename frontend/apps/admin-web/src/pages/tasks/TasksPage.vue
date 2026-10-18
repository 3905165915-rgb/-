<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { readDemoState, writeDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'
const state = ref(readDemoState()); const status = ref('全部'); const elder = ref('全部'); const submitting = ref<string | null>(null)
const tasks = computed(() => state.value.tasks.filter((task) => (status.value === '全部' || task.status === status.value) && (elder.value === '全部' || task.elderId === elder.value)))
function refresh() { state.value = readDemoState() }
async function complete(id: string) { if (submitting.value) return; submitting.value = id; await new Promise((resolve) => setTimeout(resolve, 500)); const task = state.value.tasks.find((item) => item.id === id); if (task && task.status !== 'completed') task.status = 'completed'; writeDemoState(state.value); submitting.value = null; ElMessage.success('任务状态已刷新，重复点击不会重复提交。') }
</script>

<template><section><DemoBanner /><div class="page-title-row"><div><h1>每日任务</h1><p class="muted">支持按老人、班次、责任人和状态筛选</p></div><el-button @click="refresh">刷新状态</el-button></div><el-card shadow="never" class="section-card"><el-form inline><el-form-item label="老人"><el-select v-model="elder"><el-option label="全部" value="全部" /><el-option v-for="item in state.elders" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="状态"><el-select v-model="status"><el-option v-for="item in ['全部', 'pending', 'in_progress', 'completed', 'overdue', 'not_done', 'transferred']" :key="item" :label="item" :value="item" /></el-select></el-form-item></el-form><el-table :data="tasks" border><el-table-column prop="title" label="任务" min-width="220" /><el-table-column prop="shift" label="班次" /><el-table-column prop="assignee" label="责任人" /><el-table-column prop="dueAt" label="截止时间" /><el-table-column prop="status" label="状态" /><el-table-column label="操作"><template #default="scope"><el-button v-if="scope.row.status !== 'completed'" type="primary" size="small" :loading="submitting === scope.row.id" @click="complete(scope.row.id)">完成</el-button><el-tag v-else type="success">已完成</el-tag></template></el-table-column></el-table></el-card></section></template>
