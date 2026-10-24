import { describe, expect, it } from 'vitest'
import { operations } from './model'
import {
  areaId,
  operationTitle,
  recordModeValue,
  workflowAreas,
} from './navigation'

describe('workflow navigation consolidation', () => {
  it('exposes one record creation area and keeps legacy extraction recoverable', () => {
    const records = operations.filter(
      (op) => op.group === 'records' && op.roles.includes('caregiver'),
    )
    const areas = workflowAreas(records)
    expect(areas.map((area) => area.title)).toEqual([
      '新增记录',
      '记录',
      '草稿',
      '更多',
    ])
    expect(areas[0].entry.path).toBe('/records/context-extract')
    expect(
      areas
        .flatMap((area) => area.actions)
        .filter((op) => op.path === '/records/extract'),
    ).toHaveLength(0)
    expect(areaId(records.find((op) => op.path === '/records/extract')!)).toBe(
      'new',
    )
    for (const path of [
      '/records',
      '/records/{record_id}',
      '/records/{record_id}/history',
      '/records/{record_id}/corrections',
    ])
      expect(
        areas
          .find((area) => area.id === 'records')!
          .actions.some((op) => op.path === path),
      ).toBe(true)
  })
  it('preserves access to every other authorized operation exactly once', () => {
    for (const role of [
      'admin',
      'supervisor',
      'caregiver',
      'family',
    ] as const) {
      for (const group of new Set(operations.map((op) => op.group))) {
        const permitted = operations.filter(
          (op) => op.group === group && op.roles.includes(role),
        )
        const visible = workflowAreas(permitted).flatMap((area) => area.actions)
        expect(visible.map((op) => op.id).sort()).toEqual(
          permitted
            .filter((op) => op.path !== '/records/extract')
            .map((op) => op.id)
            .sort(),
        )
        expect(new Set(visible.map((op) => op.id)).size).toBe(visible.length)
      }
    }
  })
  it('keeps manual entry free of generated observations and inferred task assignments', () => {
    const manual = recordModeValue(
      {
        elder_id: 'E',
        shift_id: 'S',
        text: '明天再看看',
        observations: ['模型推断'],
        task_candidates: [{ assigned_to: 'guess' }],
      },
      'manual',
    )
    expect(manual).toEqual({
      elder_id: 'E',
      shift_id: 'S',
      raw_text: '明天再看看',
      observations: [],
      task_candidates: [],
      happened_at: '',
    })
    expect(recordModeValue(manual, 'assisted')).toEqual({
      elder_id: 'E',
      shift_id: 'S',
      text: '明天再看看',
      scene: '',
    })
  })
  it('uses work-oriented titles while preserving endpoint identities', () => {
    const contexts = operations.filter(
      (op) =>
        op.path === '/records/context-extract' ||
        op.path === '/records/extract' ||
        op.path === '/records/manual',
    )
    expect(contexts.map(operationTitle)).toEqual([
      '新增记录',
      '新增记录',
      '新增记录',
    ])
    expect(new Set(contexts.map((op) => op.path)).size).toBe(3)
  })
})
