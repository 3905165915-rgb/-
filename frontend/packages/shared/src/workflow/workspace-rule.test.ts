import { describe, expect, it } from 'vitest'
import { matchesRuleReceipt } from './workspace-rule'
const attempt = {
  path: '/elders/ELDER-test/automation',
  key: 'synthetic-key',
  body: {
    expected_revision: 2,
    enabled: true,
    permitted_actions: ['preference_check', 'activity_invitation'],
    reason: '虚构授权说明',
  },
}
const row = {
  elder_id: 'ELDER-test',
  approved_by: 'USER-test',
  revision: 3,
  enabled: true,
  permitted_actions: ['activity_invitation', 'preference_check'],
  reason: '虚构授权说明',
}
describe('exact automation receipt verification', () => {
  it('accepts only the exact body, actor and next revision after a lost receipt', () => {
    expect(matchesRuleReceipt(row, attempt, 'USER-test')).toBe(true)
    for (const changed of [
      { ...row, revision: 4 },
      { ...row, reason: '其他说明' },
      { ...row, enabled: false },
      { ...row, approved_by: 'OTHER' },
      { ...row, permitted_actions: [] },
    ])
      expect(matchesRuleReceipt(changed, attempt, 'USER-test')).toBe(false)
    expect(matchesRuleReceipt(row, attempt, undefined)).toBe(false)
  })
  it('keeps another plan, shift or assignee from settling the saved rule', () => {
    const saved = {
      ...attempt,
      path: '/elders/ELDER-test/plan-automation',
      body: {
        ...attempt.body,
        plan_id: 'PLAN-test',
        shift_id: 'SHIFT-test',
        assigned_to: 'PERSON-test',
      },
    }
    const rule = {
      ...row,
      plan_id: 'PLAN-test',
      shift_id: 'SHIFT-test',
      assigned_to: 'PERSON-test',
    }
    expect(matchesRuleReceipt(rule, saved, 'USER-test')).toBe(true)
    expect(
      matchesRuleReceipt({ ...rule, assigned_to: 'OTHER' }, saved, 'USER-test'),
    ).toBe(false)
  })
})
