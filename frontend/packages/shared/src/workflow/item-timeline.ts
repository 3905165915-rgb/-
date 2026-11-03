import type { Row } from './model'
import { activityTimestamp, groupTimelineEvents } from './elder-activity'
export interface ItemTimelinePage { items: Row[]; total: number; offset: number; limit: number; has_more: boolean; unverified_total: number }
export function itemTimelineSubjectPath(id: string): string | null {
  const resources: Record<string, string> = { ELDER: 'elders', INCIDENT: 'incidents', TASK: 'tasks', REC: 'records', PLAN: 'care-plans', HO: 'handovers', MEMORY: 'memories' }
  const resource = resources[id.split('-')[0]]
  return resource ? '/' + resource + '/' + encodeURIComponent(id) : null
}
export function itemTimelineSubjectTitle(value: unknown, id: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Row).id !== id) return ''
  const row = value as Row
  const text = row.display_label || row.description || row.title || row.name || row.raw_text || row.summary
  return typeof text === 'string' ? text.trim().slice(0, 120) : ''
}
export function itemTimelinePage(value: unknown, offset: number, limit: number): ItemTimelinePage {
  const page = value as ItemTimelinePage & { timezone?: unknown }
  if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 ||
    page.offset !== offset || page.limit !== limit || page.timezone !== 'Asia/Shanghai' ||
    !Number.isSafeInteger(page.unverified_total) || page.unverified_total < 0 || page.unverified_total > page.total ||
    page.items.length > limit || offset + page.items.length > page.total || page.has_more !== offset + page.items.length < page.total ||
    page.items.some(row => typeof row.id !== 'string' || typeof row.label !== 'string' ||
      (row.recorded_at !== null && activityTimestamp(row.recorded_at) === null)))
    throw new Error('过程回放分页或登记时间异常，请重新读取。')
  return page
}
export function itemTimelineGroups(items: Row[]) {
  const dated = items.filter(row => activityTimestamp(row.recorded_at) !== null).map((row): Row & { recordedAt: string } => ({ ...row, recordedAt: String(row.recorded_at) }))
  const groups = groupTimelineEvents(dated)
  const unknown = items.filter(row => activityTimestamp(row.recorded_at) === null).map((row): Row & { recordedAt: string } => ({ ...row, recordedAt: '' }))
  return unknown.length ? [...groups, { date: '登记日期待核实', events: unknown }] : groups
}
