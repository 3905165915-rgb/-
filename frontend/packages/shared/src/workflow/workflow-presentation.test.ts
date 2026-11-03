import { describe, expect, it } from 'vitest'
import { operations } from './model'
import { incidentTitle, workflowHint, workflowOperation } from './workflow-presentation'
import { incidentActions } from './result-actions'
describe('current workflow presentation', () => {
  it('uses the server primary action and keeps a closed incident reopen secondary', () => {
    const allowed = operations.filter(op => op.roles.includes('supervisor'))
    const primary = { code: 'triage', label: '分级并安排整改', path: '/incidents/INCIDENT-synthetic/triage', method: 'POST' }
    expect(workflowOperation(primary, allowed)?.path).toBe('/incidents/{incident_id}/triage')
    expect(incidentActions({ workflow: { primary_action: primary } }, allowed)).toHaveLength(1)
    const closed = { workflow: { state_label: '已关闭', primary_action: null, secondary_actions: [{ ...primary, code: 'reopen' }] } }
    expect(incidentActions(closed, allowed)).toEqual([])
    expect(workflowHint(closed)?.secondary_actions).toHaveLength(1)
  })
  it('uses incident content as its title, including empty historical content', () => {
    expect(incidentTitle({ description: '虚构老人活动时失去平衡，已协助坐稳' })).toContain('失去平衡')
    expect(incidentTitle({ description: '' })).toBe('事件内容待补充')
  })
})
