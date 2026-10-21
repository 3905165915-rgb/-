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
  <main class="forbidden-page">
    <van-empty description="当前账号无权访问此页面">
      <div class="action-row">
        <van-button
          v-if="auth.role && homeForRole(auth.role) !== '/403'"
          @click="router.replace(homeForRole(auth.role))"
        >
          返回首页
        </van-button><van-button
          icon="revoke"
          @click="logout"
        >
          退出登录
        </van-button>
      </div>
    </van-empty>
  </main>
</template>
