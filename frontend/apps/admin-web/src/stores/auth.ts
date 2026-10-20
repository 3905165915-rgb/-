import { defineStore } from 'pinia'
import { computed } from 'vue'
import {
  clearSession,
  normalizeRole,
  saveSession,
  type Role,
  type FrontendSession,
} from '@hulao/shared'
import { gateway, mode, session, queryClient } from '../services/data'

export const roleLabels: Record<Role, string> = {
  admin: '管理员',
  supervisor: '主管',
  caregiver: '护理员',
  family: '家属',
}
export const useAuthStore = defineStore('auth', () => {
  const role = computed(() => session.value?.role ?? null)
  async function login(username: string, password: string) {
    if (!username.trim() || !password) throw new Error('请填写账号和密码。')
    const result = await gateway.login({ username: username.trim(), password })
    const next: FrontendSession = {
      mode,
      accountKey: username.trim(),
      role: normalizeRole(result.role),
      accessToken: mode === 'api' ? result.access_token : undefined,
    }
    if (mode === 'api' && !next.accessToken)
      throw new Error('登录响应缺少凭证。')
    saveSession(next)
    session.value = next
    queryClient.clear()
  }
  function demoLogin(selected: Role) {
    if (mode !== 'demo') return
    const next: FrontendSession = {
      mode,
      accountKey: 'demo-' + selected,
      role: selected,
    }
    saveSession(next)
    session.value = next
    queryClient.clear()
  }
  function logout() {
    clearSession()
    session.value = null
    queryClient.clear()
  }
  return { session, role, login, demoLogin, logout }
})
