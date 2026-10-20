<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Activity, ArrowLeft, LogOut, UserRound, X } from 'lucide-vue-next'
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
const focused = computed(() =>
  /^\/(tasks\/|records\/|handover(?:\/|$)|timeline(?:\/|$))/.test(route.path),
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
function logout() {
  accountOpen.value = false
  auth.logout()
  void router.replace('/login')
}
</script>
<template>
  <main
    class="mobile-layout"
    :class="{ 'focus-layout': focused, 'keyboard-open': keyboardOpen }"
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
        <span
          v-if="mode === 'demo'"
          class="demo-marker"
        >虚构演示</span>
        <ClearLocalDraftsButton />
        <button
          type="button"
          class="icon-button account-trigger"
          title="账号与偏好"
          aria-label="账号与偏好"
          aria-haspopup="dialog"
          :aria-expanded="accountOpen"
          @click="accountOpen = true"
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
      v-if="!focused && !keyboardOpen"
      route
      class="hl-glass"
      aria-label="主导航"
    >
      <van-tabbar-item
        v-for="item in menu"
        :key="item.path"
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
