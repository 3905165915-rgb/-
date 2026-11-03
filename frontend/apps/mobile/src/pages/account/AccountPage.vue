<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, LogOut, UserRound } from 'lucide-vue-next'
import { showToast } from 'vant'
import { getReducedTransparency, setReducedTransparency } from '@hulao/shared'
import { useAuthStore, roleLabels } from '../../stores/auth'
import { mode } from '../../services/data'
import ClearLocalDraftsButton from '../../components/ClearLocalDraftsButton.vue'

const auth = useAuthStore()
const router = useRouter()
const reducedTransparency = ref(getReducedTransparency())
function updateTransparency(value: boolean) {
  reducedTransparency.value = value
  if (!setReducedTransparency(value))
    showToast('偏好已应用，但未能保存到本机。')
}
function logout() {
  auth.logout()
  void router.replace('/login')
}
</script>

<template>
  <section class="account-page">
    <h1>我的</h1>
    <div class="account-person">
      <UserRound
        :size="28"
        aria-hidden="true"
      />
      <div class="account-identity">
        <strong>{{ auth.session?.accountKey || '账号未提供' }}</strong>
        <p class="muted">
          {{ auth.role ? roleLabels[auth.role] : '角色未提供' }}
        </p>
      </div>
    </div>
    <dl class="session-details">
      <div v-if="auth.session?.userId">
        <dt>用户编号</dt>
        <dd>{{ auth.session.userId }}</dd>
      </div>
      <div>
        <dt>当前环境</dt>
        <dd :class="{ 'demo-state': mode === 'demo' }">
          {{ mode === 'demo' ? '虚构演示 · 本机数据' : '正式 API' }}
        </dd>
      </div>
    </dl>
    <RouterLink class="account-link" to="/safety?report=1"><span>照护安全与事件上报</span><ChevronRight :size="18" aria-hidden="true" /></RouterLink>
    <RouterLink class="account-link" to="/notifications"><span>待我处理</span><ChevronRight :size="18" aria-hidden="true" /></RouterLink>
    <section
      class="account-tools"
      aria-labelledby="account-tools-title"
    >
      <h2 id="account-tools-title">
        本机与偏好
      </h2>
      <div class="preference-row">
        <span>本机草稿</span>
        <ClearLocalDraftsButton />
      </div>
      <div class="preference-row">
        <label for="account-transparency">降低透明度</label>
        <van-switch
          id="account-transparency"
          :model-value="reducedTransparency"
          size="24"
          aria-label="降低透明度"
          @update:model-value="updateTransparency"
        />
      </div>
      <RouterLink
        class="account-link"
        to="/account/recovery"
      >
        <span>恢复日志</span>
        <ChevronRight
          :size="18"
          aria-hidden="true"
        />
      </RouterLink>
    </section>
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
  </section>
</template>

<style scoped>
.account-person {
  align-items: flex-start;
  padding: 16px 0;
}
.account-identity {
  min-width: 0;
}
.account-identity strong {
  font-size: 18px;
}
.account-identity p {
  margin: 4px 0 0;
}
.session-details {
  padding-bottom: 16px;
  margin: 0;
}
.session-details > div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 12px;
  padding: 8px 0;
}
.session-details dt {
  color: var(--hl-muted);
}
.session-details dd {
  margin: 0;
}
.demo-state {
  color: var(--hl-warning);
}
.account-tools {
  margin-bottom: 24px;
  border-top: 1px solid var(--hl-border);
}
.account-tools .preference-row {
  min-height: 64px;
  gap: 16px;
}
.account-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  color: var(--hl-ink);
  text-decoration: none;
  border-top: 1px solid var(--hl-border);
}
</style>
