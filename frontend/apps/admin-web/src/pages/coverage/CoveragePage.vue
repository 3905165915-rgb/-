<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import DemoBanner from '../../components/DemoBanner.vue'
const rows = ref([{ requirement: '记录进食观察', actual: '午餐约半量', status: '部分覆盖', evidence: '午餐只吃一半' }, { requirement: '晚餐不足时联系家属', actual: '尚未发生', status: '缺记录', evidence: '计划要求，暂无结果' }])
function mark(row: { status: string }, status: string) { row.status = status; ElMessage.success('已保存人工说明，原始记录保持不变。') }
</script>

<template><section><DemoBanner /><h1>双向核对</h1><p class="muted">缺记录只提示候选，不直接判定未服务。</p><el-card shadow="never" class="section-card"><el-table :data="rows" border><el-table-column prop="requirement" label="计划要求" min-width="220" /><el-table-column prop="actual" label="实际记录" min-width="220" /><el-table-column prop="status" label="覆盖状态" /><el-table-column prop="evidence" label="证据" min-width="220" /><el-table-column label="处理"><template #default="scope"><el-button size="small" @click="mark(scope.row, '覆盖')">标记覆盖</el-button><el-button size="small" @click="mark(scope.row, '不适用')">不适用</el-button></template></el-table-column></el-table></el-card></section></template>
