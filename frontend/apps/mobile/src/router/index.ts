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
      component: () => import('../layouts/MobileLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/caregiver' },
        { path: 'caregiver', component: () => import('../pages/caregiver/CaregiverPage.vue') },
        { path: 'records/new', component: () => import('../pages/records/RecordPage.vue') },
        { path: 'handover', component: () => import('../pages/handover/HandoverPage.vue') },
        { path: 'family', component: () => import('../pages/family/FamilyPage.vue') },
        { path: 'timeline/:id', component: () => import('../pages/timeline/TimelinePage.vue') },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const hasSession = Boolean(localStorage.getItem('hulao:session'))
  if (to.meta.requiresAuth && !hasSession) return '/login'
  if (to.path === '/login' && hasSession) return '/caregiver'
})

export default router
