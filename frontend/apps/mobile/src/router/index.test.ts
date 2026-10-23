import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendSession, Role } from '@hulao/shared'
import type { RouteRecordRaw, RouterOptions } from 'vue-router'

// Keep the production route tree and guards, replacing only browser history
// and page rendering so redirects can be exercised without a DOM.
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
  const data = new Map<string, string>()
  return {
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => data.set(name, value),
    removeItem: (name: string) => data.delete(name),
  }
}
function loginSession(role: Role): FrontendSession {
  return { mode: 'api', accountKey: role, role, accessToken: 'test-token' }
}
async function open(path: string, saved?: unknown) {
  if (saved !== undefined) sessionStorage.setItem(key, JSON.stringify(saved))
  const { default: router } = await import('./index')
  await router.push(path)
  await router.isReady()
  return router
}
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', new EventTarget())
})

describe('mobile entry and session recovery', () => {
  it.each([
    '/',
    '/records/new',
    '/tasks/new',
    '/elders',
    '/elders/test',
    '/account',
    '/account/recovery',
    '/handover',
    '/403',
  ])('opens login for fresh %s', async (path) => {
    expect((await open(path)).currentRoute.value.path).toBe('/login')
  })
  it.each(['admin', 'supervisor', 'caregiver'] as Role[])(
    'opens the staff homepage for %s and permits mobile workflows',
    async (role) => {
      const router = await open('/', loginSession(role))
      expect(router.currentRoute.value.path).toBe('/caregiver')
      for (const path of [
        '/elders',
        '/elders/test',
        '/account',
        '/account/recovery',
        '/records/new',
        '/tasks/new',
        '/handover',
        '/tasks/test',
        '/timeline/test',
      ]) {
        await router.push(path)
        expect(router.currentRoute.value.path).toBe(path)
      }
    },
  )
  it('recovers an administrator tab already at the old forbidden URL', async () => {
    expect(
      (await open('/403', loginSession('admin'))).currentRoute.value.path,
    ).toBe('/caregiver')
  })
  it('routes family to their homepage and retains family data isolation', async () => {
    const router = await open('/', loginSession('family'))
    expect(router.currentRoute.value.path).toBe('/family')
    for (const path of [
      '/caregiver',
      '/elders',
      '/elders/test',
      '/account',
      '/account/recovery',
      '/records/new',
      '/tasks/new',
      '/handover',
      '/tasks/test',
      '/timeline/test',
    ]) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe('/403')
    }
    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/family')
  })
  it('keeps navigation visible on workbench and handover pages', async () => {
    const router = await open('/handover', loginSession('caregiver'))
    for (const path of [
      '/caregiver',
      '/elders',
      '/elders/test',
      '/account',
      '/handover',
    ]) {
      await router.push(path)
      expect(router.currentRoute.value.meta.focused).not.toBe(true)
    }
    for (const path of [
      '/tasks/new',
      '/tasks/test',
      '/records/new',
      '/account/recovery',
      '/timeline',
      '/timeline/test',
    ]) {
      await router.push(path)
      expect(router.currentRoute.value.meta.focused).toBe(true)
    }
  })
  it('resolves task creation before task detail and preserves elder context', async () => {
    const router = await open('/tasks/new?elder=elder-a', loginSession('caregiver'))
    const route = router.currentRoute.value
    expect(route.matched.at(-1)?.path).toBe('/tasks/new')
    expect(route.params.id).toBeUndefined()
    expect(route.query.elder).toBe('elder-a')
    expect(route.meta.focused).toBe(true)
    const paths = router.options.routes
      .find((record) => record.path === '/')
      ?.children?.map((record) => record.path) ?? []
    expect(paths.indexOf('tasks/new')).toBeGreaterThan(-1)
    expect(paths.indexOf('tasks/new')).toBeLessThan(paths.indexOf('tasks/:id'))
  })
  it.each(['admin', 'supervisor', 'caregiver'] as Role[])(
    'keeps the family route unavailable to %s',
    async (role) => {
      const router = await open('/family', loginSession(role))
      expect(router.currentRoute.value.path).toBe('/caregiver')
    },
  )
  it.each([
    { mode: 'api', accountKey: 'old', role: null, accessToken: 'old' },
    { mode: 'api', accountKey: 'old', role: 'root', accessToken: 'old' },
    { mode: 'api', accountKey: 'old', role: 'admin' },
    { mode: 'api', accountKey: 'old', role: 'admin', accessToken: '  ' },
    { mode: 'demo', accountKey: 'old', role: 'admin' },
    {},
  ])(
    'clears an unusable session without a redirect loop: %j',
    async (saved) => {
      expect((await open('/', saved)).currentRoute.value.path).toBe('/login')
      expect(sessionStorage.getItem(key)).toBeNull()
    },
  )
})
