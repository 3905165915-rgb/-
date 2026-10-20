<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'
import { homeForRole } from '../../router/access'
import { useRouter } from 'vue-router'
const auth = useAuthStore()
const router = useRouter()
function logout() {
  auth.logout()
  void router.replace('/login')
}
</script>
<template>
  <el-result
    icon="warning"
    title="无权访问"
    sub-title="当前账号没有此页面的权限。"
  >
    <template #extra>
      <el-button
        v-if="auth.role && homeForRole(auth.role) !== '/403'"
        @click="router.replace(homeForRole(auth.role))"
      >
        返回首页
      </el-button><el-button @click="logout">
        退出登录
      </el-button>
    </template>
  </el-result>
</template>
