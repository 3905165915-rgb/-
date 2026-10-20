import { canAccess, type Role } from '@hulao/shared'
export const internalRoles: readonly Role[] = ['caregiver', 'supervisor']
export interface NavigationItem {
  path: string
  label: string
  roles: readonly Role[]
  icon?: string
}
export const navigation: NavigationItem[] = [
  { path: '/caregiver', label: '工作台', icon: 'home-o', roles: internalRoles },
  {
    path: '/records/new',
    label: '快速记录',
    icon: 'edit',
    roles: internalRoles,
  },
  {
    path: '/handover',
    label: '交接班',
    icon: 'todo-list-o',
    roles: internalRoles,
  },
  { path: '/family', label: '家属动态', icon: 'chat-o', roles: ['family'] },
]
export function homeForRole(role: Role | null) {
  if (role === 'family') return '/family'
  if (canAccess(role, internalRoles)) return '/caregiver'
  return '/403'
}
export function allowedRoutes(role: Role | null) {
  return navigation.filter((item) => canAccess(role, item.roles))
}
