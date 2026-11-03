import { describe, expect, it } from 'vitest'
import {
  navigation,
  homeForRole,
  allowedRoutes,
  allowedBottomRoutes,
  allowedMenuRoutes,
} from './access'
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
        { path: '/caregiver', label: '今日' },
        { path: '/records', label: '记录' },
        { path: '/elders', label: '老人' },
        { path: '/handover', label: '交班' },
        { path: '/notifications', label: '照护跟进' },
        { path: '/account', label: '我的' },
      ])
      expect(homeForRole(role)).toBe('/caregiver')
    },
  )
  it('keeps focused record editing below the record work entry', () => {
    expect(navigation.some((item) => item.path === '/records')).toBe(true)
    expect(navigation.some((item) => item.path === '/records/new')).toBe(false)
  })
  it.each([
    'admin',
    'supervisor',
    'caregiver',
    'family',
    null,
  ] as (Role | null)[])(
    'limits %s bottom navigation to five items including more',
    (role) => {
      const bottom = allowedBottomRoutes(role)
      const more = allowedMenuRoutes(role)
      expect(bottom.length + (more.length ? 1 : 0)).toBeLessThanOrEqual(5)
      expect(new Set([...bottom, ...more].map((item) => item.path))).toEqual(
        new Set(allowedRoutes(role).map((item) => item.path)),
      )
      if (role && role !== 'family') {
        expect(bottom.map((item) => item.path)).toEqual([
          '/caregiver',
          '/records',
          '/handover',
          '/notifications',
        ])
        expect(more.map((item) => item.path)).toEqual(['/elders', '/account'])
      } else expect(more).toEqual([])
    },
  )
})
