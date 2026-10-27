<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Activity, LogIn } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import type { Role } from '@hulao/shared'
import { useAuthStore, roleLabels } from '../../stores/auth'
import { homeForRole } from '../../router/access'
import { mode, errorMessage } from '../../services/data'
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const form = reactive({ username: '', password: '' })
const selected = ref<Role>('supervisor')
const error = ref('')
const submitting = ref(false)
async function submit() {
  if (submitting.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.login(form.username, form.password)
    if (
      mode === 'api' &&
      route.query.view !== 'admin' &&
      window.matchMedia('(max-width: 768px)').matches
    ) {
      window.location.replace('/mobile/')
      return
    }
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
  <section
    class="login-card"
    aria-labelledby="login-title"
  >
    <div class="login-brand">
      <span class="brand-mark"><Activity
        :size="24"
        aria-hidden="true"
      /></span>
      <div>
        <h1 id="login-title">
          护老智交
        </h1>
        <p>管理端登录 · {{ mode === 'demo' ? '虚构演示' : '正式模式' }}</p>
      </div>
    </div>
    <p><a href="/mobile/login">打开手机护理端</a></p>
    <el-form
      label-position="top"
      @submit.prevent="submit"
    >
      <el-form-item label="账号">
        <el-input
          v-model="form.username"
          autocomplete="username"
        />
      </el-form-item>
      <el-form-item label="密码">
        <el-input
          v-model="form.password"
          type="password"
          show-password
          autocomplete="current-password"
        />
      </el-form-item>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      />
      <el-button
        class="login-button"
        type="primary"
        native-type="submit"
        :loading="submitting"
      >
        <LogIn
          :size="17"
          aria-hidden="true"
        />登录
      </el-button>
      <template v-if="mode === 'demo'">
        <el-divider>虚构演示</el-divider><p>仅使用本机王爷爷样本。演示按北京时间每日重建，旧样本与草稿留存本机归档；不会修改服务器数据。</p><el-select
          v-model="selected"
          aria-label="演示角色"
        >
          <el-option
            v-for="(label, key) in roleLabels"
            :key="key"
            :value="key"
            :label="label"
          />
        </el-select><el-button
          class="login-button"
          plain
          @click="demoLogin"
        >
          进入演示
        </el-button>
      </template>
    </el-form>
  </section>
</template>
