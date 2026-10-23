import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendSession, Role } from '@hulao/shared'
import type { RouteRecordRaw, RouterOptions } from 'vue-router'

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  function withoutPages(routes: readonly RouteRecordRaw[]): RouteRecordRaw[] {
    return routes.map((route) => ({
      ...route,
      ...(route.component ? { component: {} } : {}),
      ...(route.children ? { children: withoutPages(route.children) } : {}),
    })) as RouteRecordRaw[]
  }
  return {
    ...actual,
    createWebHistory: actual.createMemoryHistory,
    createRouter: (options: RouterOptions) =>
      actual.createRouter({ ...options, routes: withoutPages(options.routes) }),
  }
})
vi.mock('../services/data', async () => {
  const { ref } = await import('vue')
  return { mode: 'api', session: ref(null), queryClient: { clear: vi.fn() } }
})
const key = 'hulao:session:v2'
function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
    removeItem: (name: string) => values.delete(name),
  }
}
async function open(path: string, role?: Role) {
  if (role) {
    const session: FrontendSession = { mode: 'api', accountKey: role, role, accessToken: 'test-token' }
    sessionStorage.setItem(key, JSON.stringify(session))
  }
  const { default: router } = await import('./index')
  await router.push(path)
  return router
}
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('localStorage', memoryStorage())
  const browser = Object.assign(new EventTarget(), { location: { replace: vi.fn() } })
  vi.stubGlobal('window', browser)
})
describe('management and mobile entry recovery', () => {
  it.each(['admin', 'supervisor'] as Role[])('recovers a %s bookmark at the old forbidden page', async (role) => {
    const router = await open('/403', role)
    expect(router.currentRoute.value.path).toBe('/dashboard')
  })
  it('returns an unauthenticated forbidden bookmark to login', async () => {
    expect((await open('/403')).currentRoute.value.path).toBe('/login')
  })
  it('keeps family out of management views and recovers to their authorized homepage', async () => {
    const router = await open('/403', 'family')
    expect(router.currentRoute.value.path).toBe('/family')
    await router.push('/workflows/staff')
    expect(router.currentRoute.value.path).toBe('/family')
    await router.push('/recovery')
    expect(router.currentRoute.value.path).toBe('/family')
  })
  it.each(['admin', 'supervisor'] as Role[])(
    'allows %s to open account-scoped local recovery journals',
    async (role) => {
      const router = await open('/recovery', role)
      expect(router.currentRoute.value.path).toBe('/recovery')
    },
  )
  it.each(['/login', '/403', '/dashboard', '/'])('takes a caregiver from %s to the mobile app without a redirect loop', async (path) => {
    await open(path, 'caregiver')
    expect(window.location.replace).toHaveBeenCalledWith('/mobile/')
  })
})
