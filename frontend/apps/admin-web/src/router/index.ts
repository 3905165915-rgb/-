import { createRouter, createWebHistory } from 'vue-router'
import { canAccess, clearSession, readSession, type Role } from '@hulao/shared'
import { mode, session, queryClient } from '../services/data'
import { homeForRole, internalRoles } from './access'

const router = createRouter({
  history: createWebHistory(
    import.meta.env.VITE_SAME_ORIGIN_DEMO === 'true'
      ? '/admin/'
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
      component: () => import('../layouts/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: () => homeForRole(readSession()?.role ?? null) },
        {
          path: 'dashboard',
          component: () => import('../pages/dashboard/DashboardPage.vue'),
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
          path: 'admission',
          component: () => import('../pages/admission/AdmissionPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'assessment',
          component: () => import('../pages/assessment/AssessmentPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'care-plan',
          component: () => import('../pages/care-plan/CarePlanPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'tasks',
          component: () => import('../pages/tasks/TasksPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'quality',
          component: () => import('../pages/quality/QualityPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'coverage',
          component: () => import('../pages/coverage/CoveragePage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'changes',
          component: () => import('../pages/changes/ChangesPage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'family',
          component: () => import('../pages/family/FamilyPage.vue'),
          meta: { roles: ['admin', 'supervisor', 'family'] },
        },
        {
          path: 'timeline/:id?',
          component: () => import('../pages/timeline/TimelinePage.vue'),
          meta: { roles: internalRoles },
        },
        {
          path: 'demo',
          component: () => import('../pages/demo/DemoPage.vue'),
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
