import type { Row } from './model'

export function eligibleRecordEvidence(records: Row[], elderId: unknown) {
  if (!elderId) return []
  return records.filter(row => row.elder_id === elderId && ['confirmed', 'corrected'].includes(String(row.status)) &&
    Number.isInteger(row.revision) && Array.isArray(row.observations) && row.observations.length)
}

export function chooseRecordEvidence(form: Row, record: Row | undefined): Row {
  return { ...form, source_record_id: record?.id || '', source_revision: record?.revision || '',
    source_field: 'observations', source_quote: '' }
}
