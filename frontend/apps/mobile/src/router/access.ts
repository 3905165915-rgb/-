import { canAccess, type Role } from '@hulao/shared'
export const internalRoles: readonly Role[] = [
  'admin',
  'caregiver',
  'supervisor',
]
export interface NavigationItem {
  path: string
  label: string
  roles: readonly Role[]
  icon?: string
}
export const navigation: NavigationItem[] = [
  { path: '/caregiver', label: '今日', icon: 'home-o', roles: internalRoles },
  {
    path: '/elders',
    label: '老人',
    icon: 'friends-o',
    roles: internalRoles,
  },
  {
    path: '/handover',
    label: '交班',
    icon: 'todo-list-o',
    roles: internalRoles,
  },
  { path: '/account', label: '我的', icon: 'user-o', roles: internalRoles },
  { path: '/family', label: '家属动态', icon: 'chat-o', roles: ['family'] },
]
export function homeForRole(role: Role | null) {
  if (role === 'family') return '/family'
  if (canAccess(role, internalRoles)) return '/caregiver'
  return '/login'
}
export function allowedRoutes(role: Role | null) {
  return navigation.filter((item) => canAccess(role, item.roles))
}
