import { describe, expect, it } from 'vitest'
import { careContextOptions, incidentEvidenceIssue, updateCareContext } from './care-context'

const catalogs = {
  elders: [{ id: 'E1', current_admission_id: 'A1' }, { id: 'E2', current_admission_id: 'A2' }],
  records: [{ id: 'R1', elder_id: 'E1', admission_id: 'A1', revision: 2, status: 'confirmed', observations: ['人工核对事实'] },
    { id: 'R2', elder_id: 'E2', admission_id: 'A2', revision: 1, status: 'confirmed', observations: ['其他老人'] },
    { id: 'R3', elder_id: 'E1', admission_id: 'A1', revision: 1, status: 'draft', observations: ['未核对'] }],
}
const valid = { elder_id: 'E1', admission_id: 'A1', evidence: [{ record_id: 'R1', revision: 2, field: 'observations', quote: '人工核对事实' }] }
describe('elder-scoped task and safety forms', () => {
  it('only offers formal records and admission for the chosen elder', () => {
    expect(careContextOptions('E1', catalogs).record_id.map(row => row.id)).toEqual(['R1'])
    expect(careContextOptions('E1', catalogs).admission_id.map(row => row.id)).toEqual(['A1'])
    expect(careContextOptions('', catalogs).record_id).toEqual([])
    expect(careContextOptions('', catalogs).admission_id).toEqual([])
  })
  it('clears evidence and task content when changing the task elder', () => {
    const next = updateCareContext({ elder_id: 'E1' }, { ...valid, elder_id: 'E2', raw_text: '原老人安排', title: '原老人任务', task_candidates: [{}] }, catalogs, true)
    expect(next.admission_id).toBe('A2')
    expect(next.evidence).toEqual([])
    expect(next.task_candidates).toEqual([])
    expect(next.title).toBe('')
    expect(next.raw_text).toBe('')
    expect(updateCareContext({}, { elder_id: 'E1', raw_text: '新内容' }, catalogs, true).raw_text).toBe('新内容')
  })
  it('rejects cross-elder evidence, stale revisions and invented quotes', () => {
    expect(incidentEvidenceIssue(valid, catalogs)).toBe('')
    expect(incidentEvidenceIssue({ ...valid, admission_id: 'A2' }, catalogs)).toContain('入住关系')
    expect(incidentEvidenceIssue({ ...valid, evidence: [{ ...valid.evidence[0], record_id: 'R2' }] }, catalogs)).toContain('证据记录')
    expect(incidentEvidenceIssue({ ...valid, evidence: [{ ...valid.evidence[0], revision: 1 }] }, catalogs)).toContain('版本')
    expect(incidentEvidenceIssue({ ...valid, evidence: [{ ...valid.evidence[0], quote: '模型猜测' }] }, catalogs)).toContain('原文')
    expect(incidentEvidenceIssue({ ...valid, evidence: [] }, catalogs)).toContain('无需等待AI')
  })
})
