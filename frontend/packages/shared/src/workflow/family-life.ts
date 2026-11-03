import type { Row } from './model'

export interface FamilyMember {
  id: string
  elder_id: string
  elder_name: string
  admission_id: string | null
  demo_access?: boolean
  scopes: string[]
  expires_at: string
}
export interface FamilyPhoto {
  id: string
  caption: string
  occurred_at: string
  content_path: string
}
export interface FamilyMoment {
  id: string
  elder_id: string
  happened_at: string
  period_start: string
  period_end: string
  published_at: string
  title: string
  text: string
  kind: 'published_summary'
  photos: FamilyPhoto[]
}
export interface FamilyFeed {
  elder_id: string
  elder_name: string
  items: FamilyMoment[]
  total: number
}
export interface FamilyPoint {
  text: string
  citations: { source_id: string; quote: string }[]
}
export interface FamilyInsight {
  elder_id: string
  points: FamilyPoint[]
  model_status: 'available' | 'demo' | 'no_public_updates'
}
export interface FamilyMessage {
  id: string
  binding_id: string
  elder_id: string
  text: string
  status: 'open' | 'closed'
  created_at: string
  reply: string | null
  replied_at: string | null
}
const string = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim()
const aware = (value: unknown): value is string =>
  string(value) &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))
function fail(): never {
  throw new Error('家人动态暂时无法核对，请刷新后重试。')
}
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Row
}
export function familyMembers(value: unknown): FamilyMember[] {
  if (!Array.isArray(value)) fail()
  const rows = value.map((value) => {
    const row = object(value)
    if (
      ![row.id, row.elder_id, row.elder_name].every(string) ||
      (row.demo_access !== undefined && typeof row.demo_access !== 'boolean') ||
      !(
        string(row.admission_id) ||
        (row.demo_access === true && row.admission_id === null)
      ) ||
      !aware(row.expires_at) ||
      !Array.isArray(row.scopes) ||
      !row.scopes.length ||
      row.scopes.some(
        (scope) => !['summary', 'feedback'].includes(String(scope)),
      )
    )
      fail()
    return row as unknown as FamilyMember
  })
  if (new Set(rows.map((row) => row.id)).size !== rows.length) fail()
  return rows
}
export function familyFeed(value: unknown, member: FamilyMember): FamilyFeed {
  const row = object(value)
  if (
    row.elder_id !== member.elder_id ||
    row.elder_name !== member.elder_name ||
    !Array.isArray(row.items) ||
    !Number.isSafeInteger(row.total) ||
    Number(row.total) < row.items.length
  )
    fail()
  const items = row.items.map((value) => {
    const item = object(value)
    if (
      !string(item.id) ||
      item.elder_id !== member.elder_id ||
      !string(item.title) ||
      !string(item.text) ||
      ![
        item.happened_at,
        item.period_start,
        item.period_end,
        item.published_at,
      ].every(aware) ||
      Date.parse(String(item.period_start)) >=
        Date.parse(String(item.period_end)) ||
      item.kind !== 'published_summary' ||
      !Array.isArray(item.photos)
    )
      fail()
    for (const value of item.photos) {
      const photo = object(value)
      const expected = `/family/me/bindings/${encodeURIComponent(member.id)}/photos/${encodeURIComponent(String(photo.id))}/content`
      if (
        !string(photo.id) ||
        typeof photo.caption !== 'string' ||
        !aware(photo.occurred_at) ||
        photo.content_path !== expected
      )
        fail()
    }
    return item as unknown as FamilyMoment
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) fail()
  return {
    elder_id: member.elder_id,
    elder_name: member.elder_name,
    items,
    total: Number(row.total),
  }
}
export function familyInsight(value: unknown, feed: FamilyFeed): FamilyInsight {
  const row = object(value)
  if (
    row.elder_id !== feed.elder_id ||
    !Array.isArray(row.points) ||
    row.points.length > 30 ||
    !['available', 'demo', 'no_public_updates'].includes(
      String(row.model_status),
    )
  )
    fail()
  if (row.model_status === 'no_public_updates' && row.points.length) fail()
  const sources = new Map(feed.items.map((item) => [item.id, item.text]))
  for (const value of row.points) {
    const point = object(value)
    if (
      !string(point.text) ||
      !Array.isArray(point.citations) ||
      !point.citations.length
    )
      fail()
    for (const value of point.citations) {
      const citation = object(value)
      if (
        !string(citation.source_id) ||
        !string(citation.quote) ||
        !sources.get(citation.source_id)?.includes(citation.quote)
      )
        fail()
    }
  }
  return row as unknown as FamilyInsight
}
export function familyMessages(
  value: unknown,
  member: FamilyMember,
): FamilyMessage[] {
  if (!Array.isArray(value)) fail()
  return value.map((value) => {
    const item = object(value)
    if (
      !string(item.id) ||
      item.binding_id !== member.id ||
      item.elder_id !== member.elder_id ||
      !string(item.text) ||
      !['open', 'closed'].includes(String(item.status)) ||
      !aware(item.created_at) ||
      (item.reply !== null && typeof item.reply !== 'string') ||
      (item.replied_at !== null && !aware(item.replied_at))
    )
      fail()
    return item as unknown as FamilyMessage
  })
}

const sayings = [
  '慢一点也没关系，陪伴自有它的节奏。',
  '把平凡的一天，过成值得分享的小日子。',
  '一声问候，是心与心之间最近的路。',
  '关心不必很盛大，记得每一件小事就很好。',
  '日子细水长流，惦念一直都在。',
  '有人认真倾听，平常的故事也会发光。',
  '留一点时间，听听家人今天的小故事。',
]
export function familyDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
export function dailySaying(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value)
  const day = Math.floor(
    Date.UTC(part('year'), part('month') - 1, part('day')) / 86400000,
  )
  return sayings[day % sayings.length]!
}
export function familyDate(value: string, time = false) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    ...(time
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }
      : {}),
  }).format(new Date(value))
}
