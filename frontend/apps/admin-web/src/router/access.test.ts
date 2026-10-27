import { describe, expect, it } from 'vitest'
import {
  navigation,
  homeForRole,
  allowedRoutes,
  allowedNavigationGroups,
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
  it.each(['admin', 'supervisor'] as Role[])(
    'starts %s navigation at the dashboard and groups every route by business',
    (role) => {
      const groups = allowedNavigationGroups(role, true)
      expect(allowedRoutes(role)[0]?.path).toBe('/dashboard')
      expect(allowedRoutes(role)[0]?.path).toBe(homeForRole(role))
      expect(groups.map((group) => group.label)).toEqual([
        '工作台',
        '老人照护',
        '当班工作',
        '照护跟进',
        '家属沟通',
        '机构管理',
      ])
      expect(groups[0]?.items.map((item) => item.path)).toEqual(['/dashboard'])
      expect(
        groups
          .find((group) => group.label === '照护跟进')
          ?.items.map((item) => item.path),
      ).toEqual(['/notifications'])
      const paths = groups.flatMap((group) =>
        group.items.map((item) => item.path),
      )
      expect(paths).toEqual(
        allowedRoutes(role)
          .filter((item) => !item.internalOnly)
          .map((item) => item.path),
      )
      expect(new Set(paths).size).toBe(paths.length)
      expect([...paths].sort()).toEqual(
        [
          '/dashboard',
          '/notifications',
          '/elders',
          '/admission',
          '/assessment',
          '/care-plan',
          '/tasks',
          '/family',
          '/demo',
          '/recovery',
          '/workflows/records',
          '/workflows/shifts',
          '/workflows/handovers',
          '/workflows/memories',
          '/workflows/staff',
          '/workflows/reports',
        ].sort(),
      )
    },
  )
  it.each(['admin', 'supervisor'] as Role[])(
    'retains %s legacy tools as authorized internal entries',
    (role) => {
      const tools = [
        '/quality',
        '/coverage',
        '/changes',
        '/workflows/incidents',
        '/timeline',
      ]
      expect(
        allowedRoutes(role)
          .filter((item) => item.internalOnly)
          .map((item) => item.path),
      ).toEqual(tools)
      const sidebar = allowedNavigationGroups(role, true).flatMap((group) =>
        group.items.map((item) => item.path),
      )
      for (const path of tools) expect(sidebar).not.toContain(path)
    },
  )
  it('keeps the family group isolated and omits groups with no authorized routes', () => {
    expect(allowedNavigationGroups('family', true)).toEqual([
      {
        label: '家属沟通',
        items: [navigation.find((item) => item.path === '/family')],
      },
    ])
    expect(allowedNavigationGroups('caregiver', true)).toEqual([])
    expect(allowedNavigationGroups(null, true)).toEqual([])
  })
  it('keeps recovery logs out of the family navigation', () => {
    expect(allowedRoutes('family').map((item) => item.path)).toEqual([
      '/family',
    ])
  })
  it('shows the demo tool only when demo navigation is requested', () => {
    const paths = (demo: boolean) =>
      allowedNavigationGroups('admin', demo).flatMap((group) =>
        group.items.map((item) => item.path),
      )
    expect(paths(false)).not.toContain('/demo')
    expect(paths(true)).toContain('/demo')
    expect(paths(false)).toEqual(paths(true).filter((path) => path !== '/demo'))
  })
})
