<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'

const router = useRouter()
const state = ref(readDemoState())
const pendingTasks = computed(() => state.value.tasks.filter((task) => task.status !== 'completed').length)
const overdueTasks = computed(() => state.value.tasks.filter((task) => task.status === 'overdue').length)
const pendingDrafts = computed(() => state.value.drafts.filter((draft) => draft.status === 'pending_review').length)
</script>

<template>
  <section>
    <DemoBanner />
    <div class="page-title-row"><div><h1>工作台</h1><p class="muted">入住、空床、待办、交班与质检集中入口</p></div><el-button @click="router.push('/demo')">重置演示</el-button></div>
    <el-row :gutter="16" class="metric-grid">
      <el-col :xs="12" :sm="6"><el-card shadow="never" class="metric-card" @click="router.push('/elders')"><b>{{ state.elders.length }}</b><span>在住老人</span></el-card></el-col>
      <el-col :xs="12" :sm="6"><el-card shadow="never" class="metric-card" @click="router.push('/tasks')"><b>{{ pendingTasks }}</b><span>待处理任务</span></el-card></el-col>
      <el-col :xs="12" :sm="6"><el-card shadow="never" class="metric-card" @click="router.push('/tasks?status=overdue')"><b>{{ overdueTasks }}</b><span>逾期任务</span></el-card></el-col>
      <el-col :xs="12" :sm="6"><el-card shadow="never" class="metric-card" @click="router.push('/quality')"><b>{{ pendingDrafts }}</b><span>待核对草稿</span></el-card></el-col>
    </el-row>
    <el-card shadow="never" class="section-card"><template #header>今日提醒</template><el-alert v-for="item in state.notifications" :key="item" :title="item" type="info" show-icon :closable="false" /></el-card>
    <el-card shadow="never" class="section-card"><template #header>核心演示链</template><el-steps :active="2" finish-status="success" align-center><el-step title="护理记录" description="原文输入与AI草稿" /><el-step title="人工确认" description="修改、确认或放弃" /><el-step title="交班接收" description="下一班逐项接收" /><el-step title="主管回放" description="查看完整时间线" /></el-steps></el-card>
  </section>
</template>
