<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity,
  ArrowLeft,
  ArrowLeftRight,
  Bell,
  LogOut,
  UserRound,
  X,
} from 'lucide-vue-next'
import { showToast } from 'vant'
import { getReducedTransparency, setReducedTransparency } from '@hulao/shared'
import { useAuthStore, roleLabels } from '../stores/auth'
import { allowedRoutes, homeForRole } from '../router/access'
import { mode } from '../services/data'
import ClearLocalDraftsButton from '../components/ClearLocalDraftsButton.vue'
import { useMobileViewport } from '../composables/useMobileViewport'
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const menu = computed(() => allowedRoutes(auth.role))
const focused = computed(() => route.meta.focused === true)
const activeTab = computed(
  () =>
    menu.value.find(
      (item) =>
        route.path === item.path || route.path.startsWith(item.path + '/'),
    )?.path,
)
const accountOpen = ref(false)
const reducedTransparency = ref(getReducedTransparency())
const { keyboardOffset, keyboardOpen } = useMobileViewport()
function updateTransparency(value: boolean) {
  reducedTransparency.value = value
  if (!setReducedTransparency(value))
    showToast('偏好已应用，但未能保存到本机。')
}
function back() {
  void router.push(homeForRole(auth.role))
}
function openAccount() {
  if (auth.role === 'family') {
    reducedTransparency.value = getReducedTransparency()
    accountOpen.value = true
  } else void router.push('/account')
}
function logout() {
  accountOpen.value = false
  auth.logout()
  void router.replace('/login')
}
</script>
<template>
  <main
    class="mobile-layout"
    :class="{ 'focus-layout': focused, 'keyboard-open': keyboardOpen, 'family-layout': auth.role === 'family' }"
    :style="{ '--mobile-keyboard-offset': `${keyboardOffset}px` }"
  >
    <header class="mobile-header hl-glass">
      <button
        v-if="focused"
        type="button"
        class="icon-button"
        title="返回工作台"
        aria-label="返回工作台"
        @click="back"
      >
        <ArrowLeft
          :size="20"
          aria-hidden="true"
        />
      </button>
      <RouterLink
        :to="homeForRole(auth.role)"
        class="mobile-brand"
        aria-label="护老智交 首页"
      >
        <Activity
          :size="24"
          aria-hidden="true"
        /><span>护老智交</span>
      </RouterLink>
      <div class="header-tools">
        <button
          type="button"
          class="icon-button"
          title="切换身份"
          aria-label="切换身份"
          @click="logout"
        >
          <ArrowLeftRight
            :size="19"
            aria-hidden="true"
          />
        </button>
        <RouterLink
          v-if="auth.role && auth.role !== 'family'"
          to="/notifications"
          class="icon-button"
          title="待我处理"
          aria-label="待我处理"
        >
          <Bell
            :size="20"
            aria-hidden="true"
          />
        </RouterLink>
        <span
          v-if="mode === 'demo'"
          class="demo-marker"
        >虚构演示</span>
        <ClearLocalDraftsButton v-if="auth.role !== 'family'" />
        <button
          type="button"
          class="icon-button account-trigger"
          :title="auth.role === 'family' ? '账号与偏好' : '我的'"
          :aria-label="auth.role === 'family' ? '账号与偏好' : '我的'"
          :aria-haspopup="auth.role === 'family' ? 'dialog' : undefined"
          :aria-expanded="auth.role === 'family' ? accountOpen : undefined"
          @click="openAccount"
        >
          <UserRound
            :size="20"
            aria-hidden="true"
          />
        </button>
      </div>
    </header>
    <section class="mobile-content">
      <RouterView />
    </section>
    <van-tabbar
      v-if="!focused && !keyboardOpen && auth.role !== 'family'"
      :model-value="activeTab"
      class="hl-glass"
      aria-label="主导航"
    >
      <van-tabbar-item
        v-for="item in menu"
        :key="item.path"
        :name="item.path"
        replace
        :to="item.path"
        :icon="item.icon"
      >
        {{ item.label }}
      </van-tabbar-item>
    </van-tabbar>
    <van-popup
      v-model:show="accountOpen"
      position="bottom"
      class="mobile-sheet hl-glass"
      aria-label="账号与偏好"
      close-on-popstate
    >
      <header class="sheet-heading">
        <h2>账号与偏好</h2>
        <button
          type="button"
          class="icon-button"
          title="关闭账号菜单"
          aria-label="关闭账号菜单"
          @click="accountOpen = false"
        >
          <X
            :size="20"
            aria-hidden="true"
          />
        </button>
      </header>
      <div class="sheet-body">
        <div class="account-person">
          <UserRound
            :size="28"
            aria-hidden="true"
          />
          <div>
            <strong>{{ auth.session?.accountKey }}</strong>
            <p class="muted">
              {{ auth.role ? roleLabels[auth.role] : '角色未提供'
              }}<span v-if="mode === 'demo'"> · 虚构演示</span>
            </p>
          </div>
        </div>
        <div class="preference-row">
          <label for="mobile-transparency">降低透明度</label><van-switch
            id="mobile-transparency"
            :model-value="reducedTransparency"
            size="24"
            aria-label="降低透明度"
            @update:model-value="updateTransparency"
          />
        </div>
        <van-button
          block
          plain
          class="logout-button"
          @click="logout"
        >
          <LogOut
            :size="18"
            aria-hidden="true"
          />退出登录
        </van-button>
      </div>
    </van-popup>
  </main>
</template>

<style scoped>
.family-layout { background:radial-gradient(ellipse at 0 10%,#e6eddb80,transparent 50%),radial-gradient(ellipse at 100% 45%,#f1e6ce60,transparent 45%),#f4f6ef; min-height:100dvh; }
.family-layout .mobile-header { background:#ffffffb8; border-bottom:1px solid #e1e6d8; box-shadow:0 3px 20px #6f7f5610; }
.family-layout .mobile-brand { color:#426d54; }
.family-layout .mobile-content { padding-bottom:calc(20px + env(safe-area-inset-bottom)); }
</style>
