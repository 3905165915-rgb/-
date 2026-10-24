import { describe, expect, it } from 'vitest'
import { chooseRecordEvidence, eligibleRecordEvidence } from './record-evidence'

describe('care memory evidence selection', () => {
  const records = [
    {id: 'R1', elder_id: 'E1', status: 'confirmed', revision: 1, observations: ['午后听戏']},
    {id: 'R2', elder_id: 'E2', status: 'confirmed', revision: 3, observations: ['另一个老人']},
    {id: 'R3', elder_id: 'E1', status: 'draft', revision: 1, observations: ['未确认']},
  ]
  it('only offers the selected elder and confirmed current records', () => {
    expect(eligibleRecordEvidence(records, 'E1').map(r => r.id)).toEqual(['R1'])
    expect(eligibleRecordEvidence(records, '')).toEqual([])
  })
  it('automatically changes version but never carries an old quote into a new record', () => {
    const form = chooseRecordEvidence({content: '保留编辑内容', source_quote: '旧句子'}, records[1])
    expect(form).toMatchObject({content: '保留编辑内容', source_revision: 3, source_quote: '', source_field: 'observations'})
    expect(chooseRecordEvidence(form, undefined).source_revision).toBe('')
  })
})
