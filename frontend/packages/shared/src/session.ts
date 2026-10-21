export type Role = 'admin' | 'supervisor' | 'caregiver' | 'family'
export type AppMode = 'api' | 'demo'
export interface FrontendSession {
  mode: AppMode
  accountKey: string
  accessToken?: string
  role: Role | null
}
const key = 'hulao:session:v2'
const roles: Record<string, Role> = {
  admin: 'admin',
  supervisor: 'supervisor',
  caregiver: 'caregiver',
  family: 'family',
  管理员: 'admin',
  主管: 'supervisor',
  护理员: 'caregiver',
  家属: 'family',
}
export function normalizeRole(raw: unknown): Role | null {
  return typeof raw === 'string' && Object.hasOwn(roles, raw)
    ? roles[raw]
    : null
}
export function readSession(): FrontendSession | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as FrontendSession
    if (
      !['api', 'demo'].includes(value.mode) ||
      typeof value.accountKey !== 'string' ||
      !value.accountKey
    )
      return null
    if (
      value.accessToken !== undefined &&
      typeof value.accessToken !== 'string'
    )
      return null
    return { ...value, role: normalizeRole(value.role) }
  } catch {
    return null
  }
}
export function saveSession(session: FrontendSession) {
  sessionStorage.setItem(key, JSON.stringify(session))
  localStorage.removeItem('hulao:session')
}
export function clearSession() {
  sessionStorage.removeItem(key)
  localStorage.removeItem('hulao:session')
}
