<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { readDemoState } from '@hulao/shared'
import DemoBanner from '../../components/DemoBanner.vue'

const state = ref(readDemoState()); const submitting = ref(false)
const form = reactive({ elderId: state.value.elders[0]?.id ?? '', action: '转床', bed: '305床', reason: '' })
async function submit() {
  await ElMessageBox.confirm(`确认执行“${form.action}”并保留历史记录吗？`, '二次确认', { type: 'warning' })
  submitting.value = true; await new Promise((resolve) => setTimeout(resolve, 500)); submitting.value = false; ElMessage.success('演示操作已记录，原有历史不会被覆盖。')
}
</script>

<template><section><DemoBanner /><h1>入住与床位</h1><el-card shadow="never" class="section-card"><el-form label-width="100px" @submit.prevent="submit"><el-form-item label="老人"><el-select v-model="form.elderId"><el-option v-for="elder in state.elders" :key="elder.id" :label="`${elder.name} · ${elder.id}`" :value="elder.id" /></el-select></el-form-item><el-form-item label="变更类型"><el-radio-group v-model="form.action"><el-radio-button label="入住" /><el-radio-button label="转床" /><el-radio-button label="外出" /><el-radio-button label="返回" /><el-radio-button label="离院" /></el-radio-group></el-form-item><el-form-item label="目标床位"><el-input v-model="form.bed" /></el-form-item><el-form-item label="原因"><el-input v-model="form.reason" type="textarea" placeholder="重要变更请填写原因" /></el-form-item><el-button type="primary" native-type="submit" :loading="submitting">提交并确认</el-button></el-form></el-card></section></template>
