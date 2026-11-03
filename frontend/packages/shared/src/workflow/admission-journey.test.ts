import { describe, expect, it } from 'vitest'
import { admissionBeds, admissionCandidates, createdElderReceipt, newAdmissionPayload, newAdmissionReceipt } from './admission-journey'
describe('new admission guide', () => {
  it('builds a new stay from selected current elder and empty bed revisions', () => {
    const elder = { id: 'E-synthetic', name: '虚构老人', status: 'pending', revision: 1, current_admission_id: null, bed_id: null }
    const bed = { id: 'B-synthetic', room: '测试房', label: '测试床', revision: 2, status: 'available', enabled: true, occupant_ids: [] }
    expect(admissionCandidates([elder, { ...elder, id: 'E-active', status: 'active', current_admission_id: 'A1' }])).toEqual([elder])
    expect(admissionBeds([bed, { ...bed, id: 'B-occupied', status: 'occupied', occupant_ids: ['E-other'] }])).toEqual([bed])
    const payload = newAdmissionPayload(elder, bed, '已核对本次入住')
    expect(payload).toEqual({ kind: 'admit', expected_elder_revision: 1, bed_id: 'B-synthetic', expected_bed_revision: 2, reason: '已核对本次入住' })
    expect(createdElderReceipt(elder, { name: '虚构老人' })).toBe(elder)
    const response = { elder: { ...elder, status: 'active', revision: 2, current_admission_id: 'A-synthetic' }, admission: { id: 'A-synthetic', elder_id: elder.id, bed_id: bed.id, status: 'active' }, bed: { ...bed, revision: 3, elder_id: elder.id, status: 'occupied' } }
    expect(newAdmissionReceipt(response, elder.id, payload)).toBe(response)
  })
})
