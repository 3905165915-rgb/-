<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'

const router = useRouter()
const state = ref(readDemoState())
const keyword = ref('')
const status = ref('全部')
const filtered = computed(() => state.value.elders.filter((elder) => {
  const matchesKeyword = !keyword.value || `${elder.name}${elder.id}${elder.bedLabel}`.includes(keyword.value)
  const matchesStatus = status.value === '全部' || elder.status === status.value
  return matchesKeyword && matchesStatus
}))
</script>

<template>
  <section>
    <DemoBanner />
    <div class="page-title-row"><div><h1>老人档案</h1><p class="muted">稳定老人编号，转床与历史记录保持连续</p></div><el-button type="primary" @click="router.push('/admission')">入住与床位</el-button></div>
    <el-card shadow="never" class="section-card">
      <el-form inline><el-form-item label="搜索"><el-input v-model="keyword" placeholder="姓名、编号或床位" clearable /></el-form-item><el-form-item label="状态"><el-select v-model="status"><el-option v-for="item in ['全部', '入住', '外出', '离院']" :key="item" :label="item" :value="item" /></el-select></el-form-item></el-form>
      <el-table :data="filtered" stripe empty-text="暂无匹配老人">
        <el-table-column prop="id" label="老人编号" min-width="180" />
        <el-table-column prop="name" label="姓名" />
        <el-table-column prop="bedLabel" label="床位" />
        <el-table-column prop="status" label="入住状态" />
        <el-table-column prop="risk" label="风险提示" />
        <el-table-column prop="lastUpdate" label="最近更新" />
        <el-table-column label="操作" fixed="right"><template #default="scope"><el-button link type="primary" @click="router.push(`/elders/${scope.row.id}`)">查看详情</el-button></template></el-table-column>
      </el-table>
    </el-card>
  </section>
</template>
