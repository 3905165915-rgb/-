import { describe, expect, it } from 'vitest'
import { checkResponse, validateCatalog } from './catalogs'

describe('formal workflow catalog validation', () => {
  it('rejects missing fields, duplicate identifiers and incorrect primitive types', () => {
    expect(() => validateCatalog('records', [{ id: 'REC-test', elder_id: 'E', raw_text: '虚构' }])).toThrow('created_by')
    expect(() => validateCatalog('elders', [{ id: 'E', name: '虚构' }, { id: 'E', name: '重复' }])).toThrow('.id')
    expect(() => validateCatalog('tasks', [{ id: 'T', elder_id: 'E', title: '虚构', updated_at: '2026-10-23T00:00:00Z', revision: '1' }])).toThrow()
    expect(() => validateCatalog('staff', [{ id: 'U', display_name: '虚构', role: 'unknown' }])).toThrow()
  })
  it('accepts nullable wire fields without rewriting them or injecting defaults', () => {
    const row = { id: 'E', name: '虚构', bed_id: null }
    expect(validateCatalog('elders', [row])[0]).toBe(row)
    checkResponse({ anyOf: [{ type: 'string' }, { type: 'null' }] }, null)
    expect(() => checkResponse({ type: 'boolean' }, 'false')).toThrow()
  })
  it('keeps an overnight shift as one interval and rejects reversed or invalid dates', () => {
    const row = { id: 'S', name: '虚构夜班', status: 'open', caregiver_ids: ['U'], start_at: '2026-10-23T20:00:00+08:00', end_at: '2026-10-24T08:00:00+08:00' }
    expect(validateCatalog('shifts', [row])).toHaveLength(1)
    expect(() => validateCatalog('shifts', [{ ...row, end_at: '2026-10-23T08:00:00+08:00' }])).toThrow()
    expect(() => checkResponse({ type: 'string', format: 'date' }, '2026-02-30')).toThrow()
  })
})
