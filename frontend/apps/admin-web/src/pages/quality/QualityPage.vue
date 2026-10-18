<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import DemoBanner from '../../components/DemoBanner.vue'
const items = ref([{ id: 'qc-1', title: '待办未出现在交班草稿', evidence: '“晚上联系女儿”尚未关联交班事项', status: '待处理' }, { id: 'qc-2', title: '记录缺少具体时间', evidence: '原文使用“晚上”，没有具体时刻', status: '待处理' }])
function handle(item: { status: string }, result: string) { item.status = result; ElMessage.success('已记录处理结果，原始提示仍保留。') }
</script>

<template><section><DemoBanner /><h1>质检台</h1><el-card shadow="never" class="section-card"><el-table :data="items" border><el-table-column prop="title" label="提示" min-width="220" /><el-table-column prop="evidence" label="原文依据" min-width="280" /><el-table-column prop="status" label="处理状态" /><el-table-column label="操作"><template #default="scope"><el-button size="small" @click="handle(scope.row, '已确认')">确认问题</el-button><el-button size="small" @click="handle(scope.row, '不适用')">说明不适用</el-button><el-button size="small" type="primary" @click="handle(scope.row, '退回补充')">退回补充</el-button></template></el-table-column></el-table></el-card></section></template>
