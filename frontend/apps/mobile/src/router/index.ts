import { createRouter, createWebHistory } from 'vue-router'
import { canAccess, clearSession, readSession, type Role } from '@hulao/shared'
import { mode, session, queryClient } from '../services/data'
import { homeForRole, internalRoles } from './access'

const router = createRouter({
  history: createWebHistory(
    import.meta.env.VITE_SAME_ORIGIN_DEMO === 'true'
      ? '/mobile/'
      : import.meta.env.BASE_URL,
  ),
  routes: [
    {
      path: '/login',
      component: () => import('../layouts/AuthLayout.vue'),
      children: [
        { path: '', component: () => import('../pages/auth/LoginPage.vue') },
      ],
    },
    {
      path: '/403',
      component: () => import('../pages/auth/ForbiddenPage.vue'),
    },
    {
      path: '/',
      component: () => import('../layouts/MobileLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: () => homeForRole(readSession()?.role ?? null) },
        {
          path: 'caregiver',
          component: () => import('../pages/caregiver/CaregiverPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'elders',
          component: () => import('../pages/elders/EldersPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'elders/:id',
          component: () => import('../pages/elders/ElderDetailPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'account',
          component: () => import('../pages/account/AccountPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'account/recovery',
          component: () => import('../pages/recovery/RecoveryPage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
        {
          path: 'records',
          component: () => import('../pages/records/RecordsHubPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'records/drafts',
          redirect: (to) => ({
            path: '/records',
            query: { ...to.query, tab: 'drafts' },
          }),
          meta: { roles: internalRoles },
        },
        {
          path: 'records/history',
          redirect: (to) => ({
            path: '/records',
            query: { ...to.query, tab: 'history' },
          }),
          meta: { roles: internalRoles },
        },
        {
          path: 'records/new',
          component: () => import('../pages/records/RecordPage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
        {
          path: 'tasks/new',
          component: () => import('../pages/tasks/TaskCreatePage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
        {
          path: 'tasks/:id',
          component: () => import('../pages/tasks/TaskDetailPage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
        {
          path: 'handover',
          component: () => import('../pages/handover/HandoverPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'safety',
          component: () => import('../pages/safety/SafetyPage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
        {
          path: 'notifications',
          component: () =>
            import('../pages/notifications/NotificationsPage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
        {
          path: 'notifications/business/:group(family|memories|changes)',
          component: () =>
            import('../pages/notifications/NotificationBusinessPage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
        {
          path: 'family',
          component: () => import('../pages/family/FamilyPage.vue'),
          meta: { roles: ['family'] },
        },
        {
          path: 'timeline/:id?',
          component: () => import('../pages/timeline/TimelinePage.vue'),
          meta: { roles: internalRoles, focused: true },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/403' },
  ],
})
router.beforeEach((to) => {
  let current = readSession()
  if (
    !current ||
    current.mode !== mode ||
    !current.role ||
    (mode === 'api' && !current.accessToken?.trim())
  ) {
    clearSession()
    current = null
    queryClient.clear()
  }
  session.value = current
  if (to.meta.requiresAuth && !current) return '/login'
  if (to.path === '/login' && current) return homeForRole(current.role)
  // Recover bookmarks and open tabs left on the old mobile forbidden page.
  if (to.path === '/403') return homeForRole(current?.role ?? null)
  const roles = to.meta.roles as readonly Role[] | undefined
  if (roles && !canAccess(current?.role ?? null, roles)) return '/403'
})
window.addEventListener('hulao:unauthorized', () => {
  clearSession()
  session.value = null
  queryClient.clear()
  void router.replace('/login')
})
export default router
