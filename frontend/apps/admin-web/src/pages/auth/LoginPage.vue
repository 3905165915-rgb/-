<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createApi } from '@hulao/api-client'

const router = useRouter()
const form = reactive({ username: '', password: '' })
const error = ref('')
const submitting = ref(false)
const api = createApi(import.meta.env.VITE_API_BASE_URL)

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    const result = await api.login(form)
    localStorage.setItem('hulao:session', JSON.stringify(result))
    await router.push('/dashboard')
  } catch {
    error.value = '登录失败，请检查账号、密码或网络连接。'
  } finally {
    submitting.value = false
  }
}
function demoLogin() {
  localStorage.setItem('hulao:session', JSON.stringify({ access_token: 'demo-token', role: '主管', demo: true }))
  router.push('/dashboard')
}
</script>

<template>
  <el-card class="login-card">
    <template #header>护老智交 · 管理端登录</template>
    <el-form @submit.prevent="submit">
      <el-form-item label="账号"><el-input v-model="form.username" autocomplete="username" /></el-form-item>
      <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password autocomplete="current-password" /></el-form-item>
      <el-alert v-if="error" :title="error" type="error" show-icon />
      <el-button class="login-button" type="primary" native-type="submit" :loading="submitting">登录</el-button>
      <el-button class="login-button" plain @click="demoLogin">使用演示主管账号</el-button>
    </el-form>
  </el-card>
</template>
