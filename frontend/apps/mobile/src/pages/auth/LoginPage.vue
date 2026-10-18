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
    await router.push('/caregiver')
  } catch {
    error.value = '登录失败，请检查账号、密码或网络连接。'
  } finally {
    submitting.value = false
  }
}
function demoLogin() {
  localStorage.setItem('hulao:session', JSON.stringify({ access_token: 'demo-token', role: '护理员', demo: true }))
  router.push('/caregiver')
}
</script>

<template>
  <van-form @submit="submit">
    <h1>移动端登录</h1>
    <van-cell-group inset>
      <van-field v-model="form.username" name="username" label="账号" placeholder="请输入账号" />
      <van-field v-model="form.password" name="password" type="password" label="密码" placeholder="请输入密码" />
    </van-cell-group>
    <p v-if="error" class="error-text">{{ error }}</p>
    <div class="form-actions"><van-button block type="primary" native-type="submit" :loading="submitting">登录</van-button></div>
    <div class="form-actions"><van-button block plain type="primary" @click="demoLogin">使用演示护理员账号</van-button></div>
  </van-form>
</template>
