import { describe, expect, it } from 'vitest'
import { navigation, homeForRole, allowedRoutes } from './access'
import type { Role } from '@hulao/shared'
describe('route and menu policy', () => {
  it('gives family only the public family route', () => {
    expect(allowedRoutes('family').map((item) => item.path)).toEqual([
      '/family',
    ])
    expect(homeForRole('family')).toBe('/family')
  })
  it('fails closed for an unknown role', () => {
    expect(allowedRoutes(null)).toEqual([])
    expect(homeForRole(null)).toBe('/403')
  })
  it('every recognized role has an allowed home without redirect loops', () => {
    for (const role of ['admin', 'supervisor', 'family'] as Role[]) {
      const home = homeForRole(role)
      expect(navigation.find((item) => item.path === home)?.roles).toContain(
        role,
      )
    }
  })
  it('denies caregiver management routes and homepage', () => {
    expect(allowedRoutes('caregiver')).toEqual([])
    expect(homeForRole('caregiver')).toBe('/403')
  })
})
