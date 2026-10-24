import { request } from './workflow/model'

export type ImpressionCategory =
  'preference' | 'habit' | 'routine' | 'communication' | 'attention'
export const impressionCategories: Record<ImpressionCategory, string> = {
  preference: '兴趣喜好',
  habit: '生活习惯',
  routine: '活动规律',
  communication: '沟通方式',
  attention: '照护关注',
}
export const impressionKinds = {
  trend: '多日记录支持',
  temporary: '特定时段意愿',
  conflict: '变化或分歧',
  observation: '待继续观察',
}
export interface ImpressionPoint {
  id: string
  category: ImpressionCategory
  kind: keyof typeof impressionKinds
  expressor: 'elder' | 'family' | 'staff' | 'varied' | 'unclear'
  text: string
  citations: { source_id: string; quote: string }[]
  status: 'candidate' | 'confirmed' | 'rejected'
  revision: number
  supporting_days: number
  supporting_records: number
  reviewed_at: string | null
  reviewed_by_name: string | null
  review_note: string | null
  care_memory?: { id: string; status: string; effective: boolean }
}
export interface ElderImpression {
  id: string
  elder_id: string
  created_at: string
  model_status: 'available' | 'demo'
  source_current: boolean
  review_due: boolean
  new_record_count: number
  review_due_at: string
  coverage: {
    record_count: number
    from: string
    to: string
    batch_count: number
    simulated_count: number
  }
  sources: {
    source_id: string
    text: string
    happened_at: string
    recorded_at: string
    simulated: boolean
    revision: number
  }[]
  points: ImpressionPoint[]
}
export interface ImpressionList {
  latest: ElderImpression | null
  history: { id: string; created_at: string; record_count: number }[]
}

const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const validDate = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v))
export function parseImpression(
  value: unknown,
  elderId: string,
): ElderImpression {
  const bad = () => {
    throw new Error('老人印象返回格式异常，请刷新后重试')
  }
  if (
    !obj(value) ||
    typeof value.id !== 'string' ||
    value.elder_id !== elderId ||
    !validDate(value.created_at) ||
    !validDate(value.review_due_at) ||
    !['available', 'demo'].includes(String(value.model_status)) ||
    typeof value.source_current !== 'boolean' ||
    typeof value.review_due !== 'boolean' ||
    !Number.isInteger(value.new_record_count) ||
    !obj(value.coverage) ||
    !validDate(value.coverage.from) ||
    !validDate(value.coverage.to) ||
    !['record_count', 'simulated_count', 'batch_count'].every((k) =>
      Number.isInteger(
        value.coverage && (value.coverage as Record<string, unknown>)[k],
      ),
    ) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.points)
  )
    return bad()
  const sources = new Map<string, string>()
  for (const s of value.sources) {
    if (
      !obj(s) ||
      typeof s.source_id !== 'string' ||
      typeof s.text !== 'string' ||
      !validDate(s.happened_at) ||
      !validDate(s.recorded_at) ||
      typeof s.simulated !== 'boolean' ||
      !Number.isInteger(s.revision)
    )
      return bad()
    sources.set(s.source_id, s.text)
  }
  for (const p of value.points) {
    if (
      !obj(p) ||
      typeof p.id !== 'string' ||
      typeof p.text !== 'string' ||
      !Object.hasOwn(impressionCategories, String(p.category)) ||
      !Object.hasOwn(impressionKinds, String(p.kind)) ||
      !['elder', 'family', 'staff', 'varied', 'unclear'].includes(
        String(p.expressor),
      ) ||
      !['candidate', 'confirmed', 'rejected'].includes(String(p.status)) ||
      !Number.isInteger(p.revision) ||
      !Number.isInteger(p.supporting_days) ||
      !Number.isInteger(p.supporting_records) ||
      (p.care_memory !== undefined && (!obj(p.care_memory) || typeof p.care_memory.id !== 'string' || typeof p.care_memory.status !== 'string' || typeof p.care_memory.effective !== 'boolean')) ||
      !Array.isArray(p.citations) ||
      !p.citations.length ||
      !p.citations.every(
        (c) =>
          obj(c) &&
          typeof c.source_id === 'string' &&
          typeof c.quote === 'string' &&
          c.quote.length >= 4 &&
          sources.get(c.source_id)?.includes(c.quote),
      )
    )
      return bad()
  }
  return value as unknown as ElderImpression
}
const base = (elderId: string) =>
  `/elders/${encodeURIComponent(elderId)}/impressions`
export async function listImpressions(
  elderId: string,
): Promise<ImpressionList> {
  const value = await request(base(elderId))
  if (
    !obj(value) ||
    !Array.isArray(value.history) ||
    !value.history.every(
      (h) =>
        obj(h) &&
        typeof h.id === 'string' &&
        validDate(h.created_at) &&
        Number.isInteger(h.record_count),
    )
  )
    throw new Error('印象版本列表格式异常')
  return {
    latest:
      value.latest === null ? null : parseImpression(value.latest, elderId),
    history: value.history,
  } as ImpressionList
}
export async function getImpression(elderId: string, reportId: string) {
  return parseImpression(
    await request(base(elderId) + '/' + encodeURIComponent(reportId)),
    elderId,
  )
}
export async function generateImpression(elderId: string) {
  return parseImpression(
    await request(
      base(elderId) + '/generate',
      'post',
      undefined,
      undefined,
      240000,
    ),
    elderId,
  )
}
export async function reviewImpression(
  elderId: string,
  reportId: string,
  point: ImpressionPoint,
  decision: 'confirmed' | 'rejected',
  note: string,
) {
  return parseImpression(
    await request(
      base(elderId) +
        '/' +
        encodeURIComponent(reportId) +
        '/points/' +
        encodeURIComponent(point.id) +
        '/review',
      'post',
      { expected_revision: point.revision, decision, note },
    ),
    elderId,
  )
}

export interface ImpressionMemoryInput {
  expected_revision: number
  content: string
  category: 'stable_preference' | 'communication'
  scenes: string[]
  attributed_to: 'elder' | 'family' | 'staff' | 'unknown'
  source_record_id: string
  source_revision: number
  source_field: 'observations'
  source_quote: string
  reason: string
  review_due_at?: string
}
export async function activateImpressionMemory(elderId: string, reportId: string, pointId: string, input: ImpressionMemoryInput, key: string) {
  const value = await request(base(elderId) + '/' + encodeURIComponent(reportId) + '/points/' + encodeURIComponent(pointId) + '/activate-memory', 'post', input, key)
  if (!obj(value) || typeof value.id !== 'string' || value.elder_id !== elderId || value.status !== 'confirmed' || typeof value.effective !== 'boolean') {
    throw new Error('照护记忆保存回执异常，请刷新记忆列表核对，勿重复新增')
  }
  return value as { id: string; status: 'confirmed'; effective: boolean }
}
