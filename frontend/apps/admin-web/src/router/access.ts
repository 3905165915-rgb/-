import { canAccess, type Role } from '@hulao/shared'
export const internalRoles: readonly Role[] = ['admin', 'supervisor']
export const supervisorHiddenPaths = new Set([
  '/settings',
  '/demo',
  '/recovery',
  '/workflows/staff',
  '/workflows/memories',
])
const navigationGroups = [
  '今日工作',
  '老人',
  '任务与交班',
  '质量与安全',
  '统计报表',
  '机构管理',
  '家属沟通',
] as const
export interface NavigationItem {
  path: string
  label: string
  roles: readonly Role[]
  group: (typeof navigationGroups)[number]
  icon?: string
  internalOnly?: boolean
}
export const navigation: NavigationItem[] = [
  {
    path: '/dashboard',
    label: '今日工作',
    group: '今日工作',
    roles: internalRoles,
  },
  {
    path: '/elders',
    label: '老人',
    group: '老人',
    roles: internalRoles,
  },
  {
    path: '/tasks',
    label: '任务与交班',
    group: '任务与交班',
    roles: internalRoles,
  },
  {
    path: '/quality',
    label: '质量与安全',
    group: '质量与安全',
    roles: internalRoles,
  },
  {
    path: '/workflows/reports',
    label: '统计报表',
    group: '统计报表',
    roles: internalRoles,
  },
  {
    path: '/settings',
    label: '机构管理',
    group: '机构管理',
    roles: internalRoles,
  },
  // The remaining entries stay authorized and are reached from object pages
  // or the institution workspace rather than expanding the primary sidebar.
  {
    path: '/admission',
    label: '入住与床位',
    group: '老人',
    roles: internalRoles,
  },
  {
    path: '/assessment',
    label: '评估',
    group: '老人',
    roles: internalRoles,
  },
  {
    path: '/care-plan',
    label: '照护计划',
    group: '老人',
    roles: internalRoles,
  },
  {
    path: '/workflows/records',
    label: '记录',
    group: '任务与交班',
    roles: internalRoles,
  },
  {
    path: '/workflows/shifts',
    label: '班次管理',
    group: '任务与交班',
    roles: internalRoles,
  },
  {
    path: '/workflows/handovers',
    label: '跨班交接',
    group: '任务与交班',
    roles: internalRoles,
  },
  {
    path: '/notifications',
    label: '消息',
    group: '质量与安全',
    roles: internalRoles,
  },
  {
    path: '/coverage',
    label: '双向核对',
    group: '质量与安全',
    internalOnly: true,
    roles: internalRoles,
  },
  {
    path: '/changes',
    label: '变化简报',
    group: '质量与安全',
    internalOnly: true,
    roles: internalRoles,
  },
  {
    path: '/workflows/incidents',
    label: '安全事件处置',
    group: '质量与安全',
    internalOnly: true,
    roles: internalRoles,
  },
  {
    path: '/timeline',
    label: '过程回放',
    group: '质量与安全',
    internalOnly: true,
    roles: internalRoles,
  },
  {
    path: '/family',
    label: '家属沟通',
    group: '家属沟通',
    roles: ['admin', 'supervisor', 'family'],
  },
  {
    path: '/workflows/memories',
    label: '既有照护资料管理',
    group: '机构管理',
    roles: internalRoles,
  },
  {
    path: '/workflows/staff',
    label: '员工账号与责任清单',
    group: '机构管理',
    roles: internalRoles,
  },
  {
    path: '/followups',
    label: '照护跟进',
    group: '质量与安全',
    roles: internalRoles,
  },
  { path: '/demo', label: '演示保障', group: '机构管理', roles: internalRoles },
  {
    path: '/recovery',
    label: '本机恢复日志',
    group: '机构管理',
    roles: internalRoles,
  },
]
export function homeForRole(role: Role | null) {
  if (role === 'family') return '/family'
  if (canAccess(role, internalRoles)) return '/dashboard'
  return role ? '/403' : '/login'
}
export function allowedRoutes(role: Role | null) {
  return navigation.filter(
    (item) =>
      canAccess(role, item.roles) &&
      !(role === 'supervisor' && supervisorHiddenPaths.has(item.path)),
  )
}
export function allowedNavigationGroups(
  role: Role | null,
  includeDemo = false,
) {
  const items = allowedRoutes(role).filter(
    (item) =>
      (includeDemo || item.path !== '/demo') &&
      (role === 'family'
        ? item.path === '/family'
        : [
            '/dashboard',
            '/elders',
            '/tasks',
            '/quality',
            '/workflows/reports',
            ...(role === 'admin' ? ['/settings'] : []),
            ...(includeDemo ? ['/demo'] : []),
          ].includes(item.path)),
  )
  return navigationGroups
    .map((label) => ({
      label,
      items: items.filter((item) => item.group === label),
    }))
    .filter((group) => group.items.length)
}
