import { describe, expect, it } from 'vitest'
import { validateCareWorklist } from './care-worklist'

const item = { elder: { id: 'E1', name: '虚构老人', bed_id: null, status: 'active' }, scope_reasons: ['explicit_assignment'],
  open_tasks: [], assignment_ids: ['SCOPE-1'], pending_count: 0, overdue_count: 0 }

describe('server care worklist contract', () => {
  it('includes assigned elders even when no open task exists', () => {
    expect(validateCareWorklist({ scope_rule: '有效工作范围', items: [item] }).items[0]).toMatchObject({ elder: { id: 'E1' }, open_tasks: [], pending_count: 0 })
  })
  it('validates task ownership, unique elders, reasons, identifiers and server counts', () => {
    const validTask = { id: 'T1', elder_id: 'E1', title: '虚构待办', status: 'pending' }
    expect(() => validateCareWorklist({ scope_rule: '规则', items: [{ ...item, open_tasks: [validTask], pending_count: 1 }] })).not.toThrow()
    for (const value of [
      { scope_rule: '规则', items: [{ ...item, open_tasks: [{ ...validTask, elder_id: 'E2' }], pending_count: 1 }] },
      { scope_rule: '规则', items: [{ ...item, open_tasks: [validTask], pending_count: 2 }] },
      { scope_rule: '规则', items: [item, item] },
      { scope_rule: '规则', items: [{ ...item, overdue_count: 1 }] },
      { scope_rule: '规则', items: [{ ...item, scope_reasons: [] }] },
      { scope_rule: '', items: [] },
      { scope_rule: '规则', items: [{ ...item, scope_reasons: ['history_record'] }] },
      { scope_rule: '规则', items: [{ ...item, open_tasks: [{ ...validTask, status: 'completed' }], pending_count: 1 }] },
      { scope_rule: '规则', items: [{ ...item, open_tasks: [validTask, validTask], pending_count: 2 }] },
      { scope_rule: '规则', items: [{ ...item, open_tasks: [{ ...validTask, due_at: '2026-10-25T10:00:00' }], pending_count: 1 }] },
    ]) expect(() => validateCareWorklist(value)).toThrow()
  })
  it('honors the latest server scope after assignments expire or are revoked, including an empty scope', () => {
    const first = validateCareWorklist({ scope_rule: '当前范围', items: [item] })
    const revoked = validateCareWorklist({ scope_rule: '当前范围', items: [] })
    expect(first.items).toHaveLength(1)
    expect(revoked.items).toEqual([])
  })
})
