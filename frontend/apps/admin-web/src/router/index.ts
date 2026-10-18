import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: () => import('../layouts/AuthLayout.vue'),
      children: [{ path: '', component: () => import('../pages/auth/LoginPage.vue') }],
    },
    {
      path: '/',
      component: () => import('../layouts/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: () => import('../pages/dashboard/DashboardPage.vue') },
        { path: 'elders', component: () => import('../pages/elders/EldersPage.vue') },
        { path: 'elders/:id', component: () => import('../pages/elders/ElderDetailPage.vue') },
        { path: 'admission', component: () => import('../pages/admission/AdmissionPage.vue') },
        { path: 'assessment', component: () => import('../pages/assessment/AssessmentPage.vue') },
        { path: 'care-plan', component: () => import('../pages/care-plan/CarePlanPage.vue') },
        { path: 'tasks', component: () => import('../pages/tasks/TasksPage.vue') },
        { path: 'quality', component: () => import('../pages/quality/QualityPage.vue') },
        { path: 'coverage', component: () => import('../pages/coverage/CoveragePage.vue') },
        { path: 'changes', component: () => import('../pages/changes/ChangesPage.vue') },
        { path: 'family', component: () => import('../pages/family/FamilyPage.vue') },
        { path: 'timeline/:id', component: () => import('../pages/timeline/TimelinePage.vue') },
        { path: 'demo', component: () => import('../pages/demo/DemoPage.vue') },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const hasSession = Boolean(localStorage.getItem('hulao:session'))
  if (to.meta.requiresAuth && !hasSession) return '/login'
  if (to.path === '/login' && hasSession) return '/dashboard'
})

export default router
