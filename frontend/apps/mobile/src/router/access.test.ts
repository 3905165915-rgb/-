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
    expect(homeForRole(null)).toBe('/login')
  })
  it('every recognized role has an allowed home without redirect loops', () => {
    for (const role of [
      'admin',
      'supervisor',
      'caregiver',
      'family',
    ] as Role[]) {
      const home = homeForRole(role)
      expect(navigation.find((item) => item.path === home)?.roles).toContain(
        role,
      )
    }
  })
  it.each(['admin', 'supervisor', 'caregiver'] as Role[])(
    'gives %s the daily business tabs in order',
    (role) => {
      expect(
        allowedRoutes(role).map(({ path, label }) => ({ path, label })),
      ).toEqual([
        { path: '/caregiver', label: '今日工作' },
        { path: '/elders', label: '老人' },
        { path: '/records/new', label: '记录' },
        { path: '/handover', label: '交班' },
        { path: '/notifications', label: '待我处理' },
      ])
      expect(homeForRole(role)).toBe('/caregiver')
    },
  )
  it('keeps quick recording in the daily tabs without exposing staff tabs to family', () => {
    expect(navigation.some((item) => item.path === '/records/new')).toBe(true)
    expect(navigation.some((item) => item.path === '/handover')).toBe(true)
    expect(
      allowedRoutes('family').some((item) => item.path === '/records/new'),
    ).toBe(false)
    expect(
      allowedRoutes('family').some((item) => item.path === '/handover'),
    ).toBe(false)
  })
})
