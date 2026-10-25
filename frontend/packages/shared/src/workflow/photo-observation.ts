import type { Role } from '../session'
import type { Row } from './model'

function invalid(): never { throw new Error('照片数据格式或归属异常，请刷新核实。') }
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Row
}
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 1
const aware = (value: unknown) => text(value) && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
function strings(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(text)
}
export type PhotoRecovery = {
  upload?: { key: string; signature: string; query: string; type: 'image/jpeg' | 'image/png' }
  analyze?: { key: string; attachmentId: string; id?: string }
  review?: { key: string; id: string; payload: Row }
}
export function parsePhotoRecovery(raw: string, elderId: string): PhotoRecovery {
  const saved = object(JSON.parse(raw))
  if (saved.upload !== undefined) {
    const item = object(saved.upload), query = new URLSearchParams(String(item.query))
    if (!text(item.key) || !text(item.signature) || typeof item.query !== 'string' || query.get('elder_id') !== elderId ||
      !aware(query.get('occurred_at')) || !['image/jpeg', 'image/png'].includes(String(item.type))) return invalid()
  }
  if (saved.analyze !== undefined) {
    const item = object(saved.analyze)
    if (!text(item.key) || !text(item.attachmentId) || (item.id !== undefined && !text(item.id))) return invalid()
  }
  if (saved.review !== undefined) {
    const item = object(saved.review), payload = object(item.payload)
    if (!text(item.key) || !text(item.id) || !revision(payload.expected_revision) || !['confirm', 'reject', 'request_management'].includes(String(payload.decision)) ||
      !strings(payload.observations, 20) || !text(payload.note)) return invalid()
  }
  return saved as PhotoRecovery
}
export function photoFileIssue(file: Pick<File, 'type' | 'size'>): string {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return '仅支持JPEG和PNG照片。'
  return !file.size || file.size > 4 * 1024 * 1024 ? '照片不能为空且不能超过4MiB。' : ''
}
export function validatePhoto(value: unknown, elderId: string, id?: string): Row {
  const row = object(value)
  if (!text(row.id) || (id && row.id !== id) || row.elder_id !== elderId || !text(row.admission_id) ||
    !revision(row.revision) || !['pending_review', 'approved', 'rejected'].includes(String(row.status)) ||
    !aware(row.occurred_at) || !aware(row.created_at) || typeof row.caption !== 'string' ||
    !Array.isArray(row.reviews) || !Array.isArray(row.links) || row.mime !== 'image/jpeg' ||
    !Number.isSafeInteger(row.size_bytes) || Number(row.size_bytes) <= 0) return invalid()
  return row
}
export function validatePhotoPage(value: unknown, elderId: string): Row[] {
  const page = object(value)
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || Number(page.total) < page.items.length || page.items.length > 100) return invalid()
  const rows = page.items.map(item => validatePhoto(item, elderId))
  if (new Set(rows.map(row => row.id)).size !== rows.length) return invalid()
  return rows
}
export function validatePhotoAnalysis(value: unknown, elderId: string, attachmentId?: string, id?: string): Row {
  const row = object(value)
  if (!text(row.id) || (id && row.id !== id) || row.elder_id !== elderId || !text(row.attachment_id) ||
    (attachmentId && row.attachment_id !== attachmentId) || !text(row.admission_id) || !revision(row.revision) ||
    !['processing', 'pending_review', 'pending_management', 'confirmed', 'rejected', 'discarded'].includes(String(row.status)) ||
    !['processing', 'visible_observations', 'unable_to_determine', 'failed', 'unavailable'].includes(String(row.model_status)) ||
    !aware(row.created_at) || !Array.isArray(row.reviews) || row.reviews.some(review => !review || typeof review !== 'object' || Array.isArray(review)) ||
    (row.status === 'confirmed' && !text(row.record_id))) return invalid()
  if (row.output !== null) {
    const output = object(row.output)
    if (!['visible_observations', 'unable_to_determine'].includes(String(output.status)) ||
      !strings(output.observations, 15) || !strings(output.missing_information, 10) || !strings(output.verification_items, 10) ||
      typeof output.requires_professional_review !== 'boolean') return invalid()
  }
  return row
}
export function reviewedObservations(row: Row): string[] {
  const reviews = row.reviews as Row[]
  const latest = [...reviews].reverse().find(review => Array.isArray(review.observations) && strings(review.observations, 20))
  return latest ? [...latest.observations as string[]] : [...((row.output as Row | null)?.observations as string[] || [])]
}
export function canReviewPhoto(row: Row, role: Role | null, decision: string): boolean {
  if (!['pending_review', 'pending_management'].includes(String(row.status))) return false
  if (role === 'admin' || role === 'supervisor') return ['confirm', 'reject'].includes(decision)
  if (role !== 'caregiver' || row.status === 'pending_management') return false
  const professional = (row.output as Row | null)?.requires_professional_review === true
  return decision === 'reject' || (professional ? decision === 'request_management' : decision === 'confirm')
}
