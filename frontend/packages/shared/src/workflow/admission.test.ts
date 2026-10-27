import { describe, expect, it } from 'vitest'
import { admissionIssue, admissionOptions } from './admission'
import { operations } from './model'
const op = operations.find(
  (row) =>
    row.method === 'post' && row.path === '/elders/{elder_id}/admissions',
)!
const catalogs = {
  elders: [
    { id: 'E1', name: '王阿姨', status: 'pending', revision: 1 },
    { id: 'E2', name: '张阿姨', status: 'active', current_admission_id: 'A2' },
    { id: 'E3', name: '李爷爷', status: 'out', bed_id: 'B3' },
  ],
  beds: [
    {
      id: 'B1',
      label: '201床',
      status: 'available',
      revision: 1,
      enabled: true,
      occupant_ids: [],
    },
    { id: 'B2', status: 'occupied', elder_id: 'E2' },
    { id: 'B3', status: 'occupied', elder_id: 'E3', occupant_ids: ['E3'] },
    { id: 'B4', status: 'inactive' },
    { id: 'B5', status: 'conflict' },
  ],
  admissions: [{ id: 'A2', elder_id: 'E2', status: 'active' }],
}
describe('admission form follows lifecycle rules', () => {
  it('only offers pending or discharged residents and available beds for new admission', () => {
    const choices = admissionOptions(
      op,
      { elder_id: 'E1' },
      { kind: 'admit' },
      catalogs,
    )
    expect(choices.elder_id.map((row) => row.id)).toEqual(['E1'])
    expect(choices.bed_id.map((row) => row.id)).toEqual(['B1'])
    expect(
      admissionIssue(
        op,
        { elder_id: 'E1' },
        {
          kind: 'admit',
          bed_id: 'B1',
          expected_elder_revision: 1,
          expected_bed_revision: 1,
        },
        catalogs,
      ),
    ).toBe('')
  })
  it('blocks already-admitted residents and occupied beds before submitting', () => {
    expect(
      admissionIssue(op, { elder_id: 'E2' }, { kind: 'admit' }, catalogs),
    ).toContain('已经办理入住')
    expect(
      admissionIssue(
        op,
        { elder_id: 'E1' },
        { kind: 'admit', bed_id: 'B2' },
        catalogs,
      ),
    ).toContain('床位已占用')
  })
  it('allows explicit legacy registration only in the existing bed', () => {
    expect(
      admissionOptions(
        op,
        { elder_id: 'E3' },
        { kind: 'legacy_registration' },
        catalogs,
      ).bed_id.map((row) => row.id),
    ).toEqual(['B3'])
    expect(
      admissionIssue(op, { elder_id: 'E3' }, { kind: 'admit' }, catalogs),
    ).toContain('补登记')
    expect(
      admissionIssue(
        op,
        { elder_id: 'E1' },
        { kind: 'legacy_registration' },
        catalogs,
      ),
    ).toContain('仅用于')
  })
  it('does not reuse an old bed revision after catalog refresh', () => {
    expect(
      admissionIssue(
        op,
        { elder_id: 'E1' },
        { kind: 'admit', bed_id: 'B1', expected_bed_revision: 8 },
        catalogs,
      ),
    ).toContain('床位资料已更新')
  })
  it('explains how to proceed when all beds are occupied', () => {
    expect(
      admissionIssue(
        op,
        { elder_id: 'E1' },
        { kind: 'admit' },
        { ...catalogs, beds: catalogs.beds.slice(1) },
      ),
    ).toContain('新建床位')
  })
})
