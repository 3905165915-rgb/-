<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity,
  ArrowLeftRight,
  BedDouble,
  Bell,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  Files,
  FlaskConical,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessagesSquare,
  NotebookPen,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-vue-next'
import { getReducedTransparency, setReducedTransparency } from '@hulao/shared'
import { useAuthStore, roleLabels } from '../stores/auth'
import { allowedNavigationGroups, homeForRole } from '../router/access'
import { mode } from '../services/data'
import ClearLocalDraftsButton from '../components/ClearLocalDraftsButton.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const navigationOpen = ref(false)
const accountOpen = ref(false)
const accountElement = ref<HTMLElement>()
const drafts = ref<InstanceType<typeof ClearLocalDraftsButton>>()
const reducedTransparency = ref(getReducedTransparency())
const preferenceError = ref('')
const groups = computed(() =>
  allowedNavigationGroups(auth.role, mode === 'demo'),
)
const menu = computed(() => groups.value.flatMap((group) => group.items))
const activeItem = computed(() =>
  menu.value.find(
    (item) =>
      route.path === item.path || route.path.startsWith(item.path + '/'),
  ),
)
const activeGroup = computed(
  () =>
    groups.value.find((group) =>
      group.items.some((item) => item.path === activeItem.value?.path),
    )?.label,
)
const icons = {
  '/dashboard': LayoutDashboard,
  '/tasks': ListChecks,
  '/elders': ContactRound,
  '/admission': BedDouble,
  '/assessment': ClipboardCheck,
  '/care-plan': ClipboardList,
  '/quality': ShieldCheck,
  '/coverage': ArrowLeftRight,
  '/changes': NotebookPen,
  '/family': MessagesSquare,
  '/timeline': History,
  '/demo': FlaskConical,
  '/workflows/records': NotebookPen,
  '/workflows/shifts': ClipboardCheck,
  '/workflows/handovers': ClipboardList,
  '/workflows/memories': ContactRound,
  '/workflows/staff': UsersRound,
  '/workflows/incidents': ShieldCheck,
  '/workflows/reports': LayoutDashboard,
  '/recovery': History,
  '/notifications': Bell,
}
function changeTransparency(event: Event) {
  const value = (event.target as HTMLInputElement).checked
  reducedTransparency.value = value
  preferenceError.value = setReducedTransparency(value)
    ? ''
    : '设置已应用，本机保存失败，刷新后可能恢复。'
}
function showDrafts() {
  navigationOpen.value = false
  drafts.value?.show()
}
function logout() {
  accountOpen.value = false
  auth.logout()
  void router.replace('/login')
}
watch(
  () => route.fullPath,
  () => {
    navigationOpen.value = false
    accountOpen.value = false
  },
)
function leaveAccount(event: FocusEvent) {
  if (!accountElement.value?.contains(event.relatedTarget as Node | null))
    accountOpen.value = false
}
</script>

<template>
  <div class="admin-layout">
    <aside
      id="admin-navigation"
      class="admin-sidebar"
      :class="{ 'is-open': navigationOpen }"
      aria-label="管理端导航"
    >
      <RouterLink
        :to="homeForRole(auth.role)"
        class="brand"
      >
        <span class="brand-mark"><Activity
          :size="24"
          aria-hidden="true"
        /></span>
        <span class="brand-copy">护老智交<small>护理协作管理</small></span>
      </RouterLink>
      <nav
        class="side-menu"
        aria-label="业务导航"
      >
        <div
          v-for="group in groups"
          :key="group.label"
          class="nav-group"
        >
          <p class="nav-group-label">
            {{ group.label }}
          </p>
          <RouterLink
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="nav-link"
            :class="{ 'is-active': activeItem?.path === item.path }"
            :aria-current="activeItem?.path === item.path ? 'page' : undefined"
            :title="item.label"
          >
            <component
              :is="icons[item.path as keyof typeof icons]"
              :size="18"
              aria-hidden="true"
            />
            <span>{{ item.label }}</span>
          </RouterLink>
        </div>
      </nav>
      <div class="sidebar-tools">
        <button
          class="nav-link"
          type="button"
          title="打开本机草稿"
          @click="showDrafts"
        >
          <Files
            :size="18"
            aria-hidden="true"
          /><span>草稿管理</span>
        </button>
      </div>
      <div class="sidebar-foot">
        <span class="status-dot" /><span>管理端</span><span>{{ mode === 'demo' ? '演示模式' : '正式模式' }}</span>
      </div>
    </aside>
    <button
      v-if="navigationOpen"
      class="navigation-backdrop"
      aria-label="收起导航"
      @click="navigationOpen = false"
    />
    <div class="admin-workspace">
      <header class="page-header hl-glass">
        <button
          class="icon-button navigation-toggle"
          type="button"
          :aria-expanded="navigationOpen"
          aria-controls="admin-navigation"
          :aria-label="navigationOpen ? '收起导航' : '展开导航'"
          @click="navigationOpen = !navigationOpen"
        >
          <component
            :is="navigationOpen ? X : Menu"
            :size="20"
            aria-hidden="true"
          />
        </button>
        <div class="breadcrumb">
          <span>{{ activeGroup }}</span><ChevronRight
            :size="14"
            aria-hidden="true"
          /><strong>{{
            activeItem?.label || '管理端'
          }}</strong>
        </div>
        <div class="header-actions">
          <button
            type="button"
            class="identity-switch"
            @click="logout"
          >
            <ArrowLeftRight
              :size="17"
              aria-hidden="true"
            /><span>切换身份</span>
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
            class="mode-label"
            :class="{ 'is-demo': mode === 'demo' }"
          ><FlaskConical
            v-if="mode === 'demo'"
            :size="14"
            aria-hidden="true"
          />{{ mode === 'demo' ? '虚构演示' : '正式模式' }}</span>
          <ClearLocalDraftsButton ref="drafts" />
          <div
            ref="accountElement"
            class="account-menu"
            @focusout="leaveAccount"
            @keydown.esc="accountOpen = false"
          >
            <button
              type="button"
              class="account-button"
              :aria-label="
                '当前账号 · ' +
                  (auth.role ? roleLabels[auth.role] : '权限未识别')
              "
              :aria-expanded="accountOpen"
              aria-controls="account-panel"
              @click="accountOpen = !accountOpen"
            >
              <span class="account-avatar">{{
                (auth.session?.accountKey || '账').slice(0, 1).toUpperCase()
              }}</span>
              <span class="account-role">{{
                auth.role ? roleLabels[auth.role] : '权限未识别'
              }}</span><ChevronDown
                :size="14"
                aria-hidden="true"
              />
            </button>
            <div
              v-if="accountOpen"
              id="account-panel"
              class="account-panel hl-glass"
            >
              <p class="account-id">
                {{ auth.session?.accountKey }}
              </p>
              <p class="muted">
                管理端 · {{ auth.role ? roleLabels[auth.role] : '权限未识别' }}
              </p>
              <label class="preference-toggle"><span>降低透明度</span><input
                type="checkbox"
                role="switch"
                :checked="reducedTransparency"
                @change="changeTransparency"
              ></label>
              <p
                v-if="preferenceError"
                class="warning-text preference-error"
                role="status"
              >
                {{ preferenceError }}
              </p>
              <button
                type="button"
                class="account-logout"
                @click="logout"
              >
                <LogOut
                  :size="17"
                  aria-hidden="true"
                />退出登录
              </button>
            </div>
          </div>
        </div>
      </header>
      <main class="admin-main">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.sidebar-tools {
  padding: 8px 12px 0;
  border-top: 1px solid var(--hl-border, #dce3e7);
}
</style>
