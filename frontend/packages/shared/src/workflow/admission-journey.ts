import type { Row } from './model'
export function admissionCandidates(elders: Row[]): Row[] {
  return elders.filter(row => ['pending', 'discharged'].includes(String(row.status)) && !row.current_admission_id && !row.bed_id)
}
export function admissionBeds(beds: Row[]): Row[] {
  return beds.filter(row => row.status === 'available' && row.enabled !== false && !row.elder_id && (!Array.isArray(row.occupant_ids) || row.occupant_ids.length === 0))
}
export function newAdmissionPayload(elder: Row | undefined, bed: Row | undefined, reason: string): Row {
  if (!elder || !admissionCandidates([elder]).length || !Number.isSafeInteger(elder.revision)) throw new Error('请选择待入住或已离院且没有有效入住单的老人。')
  if (!bed || !admissionBeds([bed]).length || !Number.isSafeInteger(bed.revision)) throw new Error('请选择当前可分配的空闲床位。')
  if (!reason.trim()) throw new Error('请填写本次入住说明。')
  return { kind: 'admit', expected_elder_revision: elder.revision, bed_id: bed.id, expected_bed_revision: bed.revision, reason: reason.trim() }
}
export function createdElderReceipt(value: unknown, payload: Row): Row {
  const row = value as Row
  if (!row || typeof row.id !== 'string' || !row.id || row.name !== payload.name || !Number.isSafeInteger(row.revision) || row.status !== 'pending' || row.current_admission_id || row.bed_id)
    throw new Error('建档回执待核实，请保留原请求并查询。')
  return row
}
export function newAdmissionReceipt(value: unknown, elderId: string, payload: Row): Row {
  const row = value as Row
  const elder = row?.elder as Row | undefined, admission = row?.admission as Row | undefined, bed = row?.bed as Row | undefined
  if (!elder || !admission || !bed || elder.id !== elderId || admission.elder_id !== elderId ||
      admission.bed_id !== payload.bed_id || bed.id !== payload.bed_id || bed.elder_id !== elderId ||
      typeof admission.id !== 'string' || !admission.id || elder.current_admission_id !== admission.id ||
      admission.status !== 'active' || elder.status !== 'active' ||
      Number(elder.revision) <= Number(payload.expected_elder_revision) || Number(bed.revision) <= Number(payload.expected_bed_revision))
    throw new Error('入住回执与当前老人或床位不一致，请保留原请求核实。')
  return row
}
