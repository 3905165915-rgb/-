import { canAccess, type Role } from '@hulao/shared'
export const internalRoles: readonly Role[] = [
  'admin',
  'caregiver',
  'nurse',
  'supervisor',
]
export interface NavigationItem {
  path: string
  label: string
  roles: readonly Role[]
  icon?: string
  menuOnly?: boolean
}
export const navigation: NavigationItem[] = [
  { path: '/caregiver', label: '今日', icon: 'home-o', roles: internalRoles },
  { path: '/records', label: '记录', icon: 'notes-o', roles: internalRoles },
  {
    path: '/elders',
    label: '老人',
    menuOnly: true,
    icon: 'friends-o',
    roles: internalRoles,
  },
  {
    path: '/handover',
    label: '交班',
    icon: 'todo-list-o',
    roles: internalRoles,
  },
  {
    path: '/notifications',
    label: '照护跟进',
    icon: 'bell',
    roles: internalRoles,
  },
  {
    path: '/account',
    label: '我的',
    icon: 'user-o',
    roles: internalRoles,
    menuOnly: true,
  },
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
export function allowedBottomRoutes(role: Role | null) {
  return allowedRoutes(role).filter((item) => !item.menuOnly)
}
export function allowedMenuRoutes(role: Role | null) {
  return allowedRoutes(role).filter((item) => item.menuOnly)
}
