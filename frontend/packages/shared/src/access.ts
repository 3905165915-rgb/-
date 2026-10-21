import type { Role } from './session'
export function canAccess(role: Role | null, allowed: readonly Role[]) {
  return role !== null && allowed.includes(role)
}
