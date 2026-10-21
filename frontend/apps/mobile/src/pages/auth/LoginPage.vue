<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Activity } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import type { Role } from '@hulao/shared'
import { useAuthStore, roleLabels } from '../../stores/auth'
import { homeForRole } from '../../router/access'
import { mode, errorMessage } from '../../services/data'
const router = useRouter()
const auth = useAuthStore()
const form = reactive({ username: '', password: '' })
const selected = ref<Role>('caregiver')
const error = ref('')
const submitting = ref(false)
async function submit() {
  if (submitting.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.login(form.username, form.password)
    await router.replace(homeForRole(auth.role))
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    submitting.value = false
  }
}
async function demoLogin() {
  auth.demoLogin(selected.value)
  await router.replace(homeForRole(auth.role))
}
</script>
<template>
  <van-form
    class="login-form"
    @submit="submit"
  >
    <header class="login-heading">
      <div class="login-brand">
        <Activity
          :size="28"
          aria-hidden="true"
        />
        <h1>护老智交</h1>
      </div>
      <p>移动护理工作台</p>
    </header>
    <van-cell-group>
      <van-field
        v-model="form.username"
        label="账号"
        autocomplete="username"
        placeholder="请输入账号"
        required
        :disabled="submitting"
      /><van-field
        v-model="form.password"
        label="密码"
        type="password"
        autocomplete="current-password"
        placeholder="请输入密码"
        required
        :disabled="submitting"
      />
    </van-cell-group>
    <p
      v-if="error"
      class="error-text"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="form-actions">
      <van-button
        block
        type="primary"
        native-type="submit"
        :loading="submitting"
        :disabled="!form.username.trim() || !form.password"
      >
        登录
      </van-button>
    </div>
    <div
      v-if="mode === 'demo'"
      class="demo-login"
    >
      <p class="muted">
        虚构演示
      </p>
      <label class="select-field">角色<select v-model="selected">
        <option
          v-for="(label, key) in roleLabels"
          :key="key"
          :value="key"
        >
          {{ label }}
        </option>
      </select></label><van-button
        block
        plain
        native-type="button"
        @click="demoLogin"
      >
        进入演示
      </van-button>
    </div>
  </van-form>
</template>
