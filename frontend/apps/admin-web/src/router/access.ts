import { canAccess, type Role } from '@hulao/shared'
export const internalRoles: readonly Role[] = ['admin', 'supervisor']
export interface NavigationItem {
  path: string
  label: string
  roles: readonly Role[]
  icon?: string
}
export const navigation: NavigationItem[] = [
  { path: '/dashboard', label: '工作台', roles: internalRoles },
  { path: '/elders', label: '老人档案', roles: internalRoles },
  { path: '/admission', label: '入住与床位', roles: internalRoles },
  { path: '/assessment', label: '评估', roles: internalRoles },
  { path: '/care-plan', label: '照护计划', roles: internalRoles },
  { path: '/tasks', label: '每日任务', roles: internalRoles },
  { path: '/quality', label: '质检台', roles: internalRoles },
  { path: '/coverage', label: '双向核对', roles: internalRoles },
  { path: '/changes', label: '变化简报', roles: internalRoles },
  {
    path: '/family',
    label: '家属沟通',
    roles: ['admin', 'supervisor', 'family'],
  },
  { path: '/timeline', label: '过程回放', roles: internalRoles },
  { path: '/demo', label: '演示保障', roles: internalRoles },
]
export function homeForRole(role: Role | null) {
  if (role === 'family') return '/family'
  if (canAccess(role, internalRoles)) return '/dashboard'
  return '/403'
}
export function allowedRoutes(role: Role | null) {
  return navigation.filter((item) => canAccess(role, item.roles))
}
