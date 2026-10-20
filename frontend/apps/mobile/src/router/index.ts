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
          path: 'records/new',
          component: () => import('../pages/records/RecordPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'tasks/:id',
          component: () => import('../pages/tasks/TaskDetailPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'handover',
          component: () => import('../pages/handover/HandoverPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'family',
          component: () => import('../pages/family/FamilyPage.vue'),
          meta: { roles: ['family'] },
        },
        {
          path: 'timeline/:id?',
          component: () => import('../pages/timeline/TimelinePage.vue'),
          meta: { roles: internalRoles },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/403' },
  ],
})
router.beforeEach((to) => {
  const current = readSession()
  session.value = current
  if (current && current.mode !== mode) {
    clearSession()
    session.value = null
    queryClient.clear()
    return '/login'
  }
  if (to.meta.requiresAuth && !current) return '/login'
  if (to.path === '/login' && current) return homeForRole(current.role)
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
