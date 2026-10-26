import type { Operation, Row } from './model'

export function isAdmissionCreate(op: Operation): boolean {
  return op.method === 'post' && op.path === '/elders/{elder_id}/admissions'
}
function hasOpenAdmission(elder: Row, catalogs: Record<string, Row[]>) {
  return Boolean(elder.current_admission_id || (catalogs.admissions || []).some(row =>
    row.elder_id === elder.id && ['active', 'out'].includes(String(row.status))))
}
export function admissionOptions(op: Operation, params: Row, body: Row, catalogs: Record<string, Row[]>): Record<string, Row[]> {
  if (isAdmissionCreate(op)) {
    const legacy = body.kind === 'legacy_registration'
    const elders = (catalogs.elders || []).filter(row => !hasOpenAdmission(row, catalogs) &&
      (legacy ? ['active', 'out'].includes(String(row.status || 'active')) : ['pending', 'discharged'].includes(String(row.status))))
    const elder = elders.find(row => row.id === params.elder_id)
    const beds = (catalogs.beds || []).filter(row => {
      if (!elder || row.enabled === false || ['inactive', 'conflict'].includes(String(row.status))) return false
      if (legacy && elder.bed_id && row.id !== elder.bed_id) return false
      const occupants = Array.isArray(row.occupant_ids) ? row.occupant_ids : row.elder_id ? [row.elder_id] : []
      if (legacy && row.status === 'occupied') return occupants.length === 1 && occupants[0] === elder.id
      return row.status === 'available' && !occupants.length
    })
    return { elder_id: elders, bed_id: beds }
  }
  if (op.method === 'post' && op.path === '/admissions/{admission_id}/actions' && body.action === 'transfer')
    return { bed_id: (catalogs.beds || []).filter(row => row.status === 'available' && row.enabled !== false && !row.elder_id && (!Array.isArray(row.occupant_ids) || !row.occupant_ids.length)) }
  return {}
}
export function admissionIssue(op: Operation, params: Row, body: Row, catalogs: Record<string, Row[]>): string {
  if (!isAdmissionCreate(op)) return ''
  const elder = (catalogs.elders || []).find(row => row.id === params.elder_id)
  if (!elder) return '请先选择已建档的老人。'
  if (hasOpenAdmission(elder, catalogs)) return '这位老人已经办理入住，请查看入住历史；换床或返院请使用“转床／外出／返院／离院”。'
  const choices = admissionOptions(op, params, body, catalogs)
  if (!choices.elder_id.some(row => row.id === elder.id))
    return body.kind === 'legacy_registration' ? '补登记仅用于缺少入住单的在院或外出老人。待入住老人请选择“新入住”。' : '这位老人已有在院状态但缺少入住单，请核实后选择“原有在院老人补登记”，不要重复办理新入住。'
  if (!choices.bed_id.length) return '当前没有可分配床位。请在“新建床位”中添加空床，或核对补登记老人原床位的占用关系。'
  if (body.bed_id && !choices.bed_id.some(row => row.id === body.bed_id)) return '所选床位已占用、停用或与当前老人不匹配，请重新选择可用床位。'
  const bed = choices.bed_id.find(row => row.id === body.bed_id)
  if (body.expected_elder_revision && Number(body.expected_elder_revision) !== Number(elder.revision || 1)) return '老人资料已更新，请刷新可选数据，核对后采用当前版本。'
  if (bed && body.expected_bed_revision && Number(body.expected_bed_revision) !== Number(bed.revision || 1)) return '床位资料已更新，请刷新可选数据，核对后采用当前版本。'
  return ''
}
