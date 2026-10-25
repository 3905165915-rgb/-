import type { Row } from './model'

export function careContextOptions(elderId: unknown, catalogs: Record<string, Row[]>): Record<string, Row[]> {
  const records = (catalogs.records || []).filter(row => !!elderId && row.elder_id === elderId && ['confirmed', 'corrected'].includes(String(row.status)))
  const elder = (catalogs.elders || []).find(row => row.id === elderId)
  const admissions = (catalogs.admissions || []).filter(row => !!elderId && row.elder_id === elderId)
  if (elder?.current_admission_id && !admissions.some(row => row.id === elder.current_admission_id))
    admissions.push({ id: elder.current_admission_id, elder_id: elder.id, status: 'active', name: '当前入住关系' })
  return { record_id: records, source_record_id: records, admission_id: admissions }
}

export function updateCareContext(previous: Row, next: Row, catalogs: Record<string, Row[]>, taskCreation = false): Row {
  const value = { ...next }
  if (previous.elder_id && previous.elder_id !== next.elder_id) {
    for (const field of ['admission_id', 'source_record_id', 'source_revision', 'record_id'])
      if (field in value) value[field] = ''
    for (const field of ['evidence', 'task_candidates']) if (field in value) value[field] = []
    if (taskCreation)
      for (const field of ['raw_text', 'title', 'assigned_to', 'due_at', 'completion_criteria']) value[field] = ''
  }
  if ('admission_id' in value && !value.admission_id) {
    const elder = catalogs.elders?.find(row => row.id === value.elder_id)
    if (elder?.current_admission_id) value.admission_id = elder.current_admission_id
  }
  return value
}

export function incidentEvidenceIssue(payload: Row, catalogs: Record<string, Row[]>): string {
  const eligible = careContextOptions(payload.elder_id, catalogs)
  if (!eligible.admission_id.some(row => row.id === payload.admission_id)) return '请核对所选老人对应的入住关系，不能关联其他老人。'
  if (!Array.isArray(payload.evidence) || !payload.evidence.length) return '当前上报接口需要至少一条已确认记录作为事实依据，请先人工记一条，无需等待AI。'
  for (const source of payload.evidence as Row[]) {
    const record = eligible.record_id.find(row => row.id === source.record_id && row.admission_id === payload.admission_id)
    if (!record || record.revision !== source.revision) return '证据记录不属于当前老人或入住关系，或版本已变化，请重新核对。'
    const text = source.field === 'raw_text' ? record.raw_text : Array.isArray(record.observations) ? record.observations.join('\n') : ''
    if (typeof source.quote !== 'string' || !source.quote.trim() || typeof text !== 'string' || !text.includes(source.quote)) return '证据引文必须来自所选正式记录原文，请重新核对。'
  }
  return ''
}
