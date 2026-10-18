<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'

const route = useRoute(); const router = useRouter(); const state = readDemoState()
const elder = computed(() => state.elders.find((item) => item.id === route.params.id) ?? state.elders[0])
const tasks = computed(() => state.tasks.filter((task) => task.elderId === elder.value?.id))
</script>

<template>
  <section v-if="elder">
    <DemoBanner />
    <div class="page-title-row"><div><el-button link @click="router.push('/elders')">返回档案列表</el-button><h1>{{ elder.name }} · {{ elder.bedLabel }}</h1></div><el-tag>{{ elder.id }}</el-tag></div>
    <el-row :gutter="16"><el-col :xs="24" :md="12"><el-card shadow="never"><template #header>基本信息</template><el-descriptions :column="1" border><el-descriptions-item label="老人编号">{{ elder.id }}</el-descriptions-item><el-descriptions-item label="年龄">{{ elder.age }}岁</el-descriptions-item><el-descriptions-item label="状态">{{ elder.status }}</el-descriptions-item><el-descriptions-item label="联系人">{{ elder.contact }}</el-descriptions-item><el-descriptions-item label="注意事项">{{ elder.notes }}</el-descriptions-item></el-descriptions></el-card></el-col><el-col :xs="24" :md="12"><el-card shadow="never"><template #header>关联任务</template><el-timeline><el-timeline-item v-for="task in tasks" :key="task.id" :type="task.status === 'completed' ? 'success' : 'primary'">{{ task.title }} · {{ task.status }}<div class="muted">{{ task.dueAt }} · {{ task.assignee }}</div></el-timeline-item></el-timeline></el-card></el-col></el-row>
  </section>
</template>
