import { shallowRef } from 'vue'

export interface FamilyRecipient {
  id: string
  display_name: string
}
export interface SummaryRecord {
  record_id: string
  happened_at: string | null
  recorded_at: string | null
  public_fragments: string[]
  suggested_quote: string
  selectable: boolean
  unavailable_reason: string | null
}
export interface SummaryWorkspace {
  elder: { id: string; name: string }
  current_admission_id: string | null
  context_notice: string | null
  items: SummaryRecord[]
  total: number
  offset: number
  limit: number
  period_start: string
  period_end: string
  recipients: FamilyRecipient[]
  recipient_count: number
  can_publish: boolean
}
export interface PublicSelection {
  record_id: string
  public_quote: string
}
export interface SelectionPayload {
  elder_id: string
  period_start: string
  period_end: string
  selections: PublicSelection[]
  text: string
  public_quotes_confirmed: true
}
export interface SummaryPreview {
  context_token: string
  family_preview: {
    elder_id: string
    period_start: string
    period_end: string
    text: string
  }
  recipients: FamilyRecipient[]
  recipient_count: number
  can_publish: boolean
}
export interface FamilySummary {
  id: string
  elder_id: string
  admission_id: string
  period_start: string
  period_end: string
  text: string
  status: 'draft' | 'published' | 'withdrawn' | 'rejected'
  revision: number
  created_at?: string
  reviewed_at?: string
}
type ObjectRow = Record<string, unknown>
function row(value: unknown): ObjectRow {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('简报数据格式异常，请刷新后核对。')
  return value as ObjectRow
}
function string(value: unknown): value is string {
  return typeof value === 'string'
}
function id(value: unknown): value is string {
  return string(value) && value.trim().length > 0
}
function instant(value: unknown): value is string {
  return (
    string(value) &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
function recipients(value: unknown): FamilyRecipient[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => !id(row(item).id) || !id(row(item).display_name))
  )
    throw new Error('家属名单读取异常，请刷新后核对。')
  return value as FamilyRecipient[]
}
function period(value: ObjectRow) {
  if (
    !instant(value.period_start) ||
    !instant(value.period_end) ||
    Date.parse(value.period_start) >= Date.parse(value.period_end)
  )
    throw new Error('简报时段读取异常，请重新选择。')
}
export function summaryWorkspace(
  value: unknown,
  elderId: string,
): SummaryWorkspace {
  const result = row(value)
  const elder = row(result.elder)
  period(result)
  if (
    elder.id !== elderId ||
    !id(elder.name) ||
    !(
      result.current_admission_id === null || id(result.current_admission_id)
    ) ||
    !(result.context_notice === null || string(result.context_notice)) ||
    !count(result.total) ||
    !count(result.offset) ||
    !count(result.limit) ||
    result.limit < 1 ||
    !Array.isArray(result.items) ||
    result.items.length > result.limit ||
    typeof result.can_publish !== 'boolean'
  )
    throw new Error('简报工作区与所选老人不一致，请刷新后核对。')
  for (const item of result.items) {
    const candidate = row(item)
    if (
      !id(candidate.record_id) ||
      !Array.isArray(candidate.public_fragments) ||
      candidate.public_fragments.some((fragment) => !string(fragment)) ||
      !string(candidate.suggested_quote) ||
      typeof candidate.selectable !== 'boolean' ||
      !(candidate.happened_at === null || instant(candidate.happened_at)) ||
      !(candidate.recorded_at === null || string(candidate.recorded_at)) ||
      !(
        candidate.unavailable_reason === null ||
        string(candidate.unavailable_reason)
      )
    )
      throw new Error('候选记录读取异常，请刷新后核对。')
  }
  const audience = recipients(result.recipients)
  if (
    result.recipient_count !== audience.length ||
    result.can_publish !== audience.length > 0
  )
    throw new Error('家属授权名单读取异常，请刷新后核对。')
  return result as unknown as SummaryWorkspace
}
export function selectionPayload(
  workspace: SummaryWorkspace,
  selections: PublicSelection[],
  text: string,
  confirmed: boolean,
): SelectionPayload {
  if (!workspace.current_admission_id)
    throw new Error('该老人暂无有效入住，无法创建本次简报。')
  if (!confirmed) throw new Error('请先核对选中记录中的公开片段。')
  if (
    !selections.length ||
    selections.length > 10 ||
    new Set(selections.map((item) => item.record_id)).size !== selections.length
  )
    throw new Error('请选择1至10条不同的记录。')
  if (
    selections.some(
      (item) =>
        !item.public_quote.trim() || item.public_quote.trim().length > 1000,
    )
  )
    throw new Error('每条公开片段应为1至1000字的记录原文。')
  if (text.trim().length > 2000) throw new Error('简报正文最多2000字。')
  return {
    elder_id: workspace.elder.id,
    period_start: workspace.period_start,
    period_end: workspace.period_end,
    selections: selections.map((item) => ({
      record_id: item.record_id,
      public_quote: item.public_quote.trim(),
    })),
    text: text.trim(),
    public_quotes_confirmed: true,
  }
}
export function summaryPreview(
  value: unknown,
  payload: SelectionPayload,
): SummaryPreview {
  const result = row(value),
    view = row(result.family_preview)
  period(view)
  const expectedText =
    payload.text ||
    payload.selections.map((item) => item.public_quote).join('\n')
  if (
    result.preview !== true ||
    !string(result.context_token) ||
    !/^[0-9a-f]{64}$/.test(result.context_token) ||
    view.elder_id !== payload.elder_id ||
    view.text !== expectedText ||
    Date.parse(String(view.period_start)) !==
      Date.parse(payload.period_start) ||
    Date.parse(String(view.period_end)) !== Date.parse(payload.period_end)
  )
    throw new Error('公开预览与本次选择不一致，请重新预览。')
  const audience = recipients(result.recipients)
  if (
    result.recipient_count !== audience.length ||
    result.can_publish !== audience.length > 0
  )
    throw new Error('预览家属名单读取异常，请重新预览。')
  return result as unknown as SummaryPreview
}
export function familySummary(value: unknown, elderId: string): FamilySummary {
  const result = row(value)
  period(result)
  if (
    !id(result.id) ||
    result.elder_id !== elderId ||
    !id(result.admission_id) ||
    !id(result.text) ||
    result.text.length > 2000 ||
    !count(result.revision) ||
    result.revision < 1 ||
    !['draft', 'published', 'withdrawn', 'rejected'].includes(
      String(result.status),
    )
  )
    throw new Error('简报回执读取异常，请核实原请求结果。')
  return result as unknown as FamilySummary
}
export const summaryState: Record<FamilySummary['status'], string> = {
  draft: '草稿',
  published: '已发布',
  withdrawn: '已撤回',
  rejected: '未通过',
}

export interface SummaryMutationAttempt {
  path: string
  method: string
  body: ObjectRow
  key: string
  elderId: string
}
export interface SummaryMutationJournal {
  read(): unknown
  write(attempt: SummaryMutationAttempt | null): void
}
type Transport = (
  path: string,
  method?: string,
  body?: unknown,
  key?: string,
) => Promise<unknown>
/** An uncertain response retains the exact request and idempotency key for recovery. */
export function createSummaryMutations(
  transport: Transport,
  valid: () => boolean,
  key = () => crypto.randomUUID(),
  journal?: SummaryMutationJournal,
) {
  const pending = shallowRef<SummaryMutationAttempt | null>(null)
  let running = false
  async function run(
    attempt: SummaryMutationAttempt,
  ): Promise<FamilySummary | undefined> {
    if (running || !valid()) return
    running = true
    try {
      const response = await transport(
        attempt.path,
        attempt.method,
        attempt.body,
        attempt.key,
      )
      if (!valid()) return
      const result = familySummary(response, attempt.elderId)
      if (attempt.body.text !== undefined && result.text !== attempt.body.text)
        throw new Error('简报回执正文不一致，请使用原请求核实结果。')
      if (
        (attempt.path.endsWith('/from-selection') &&
          result.status !== 'draft') ||
        (attempt.body.action === 'publish' && result.status !== 'published') ||
        (attempt.body.action === 'withdraw' && result.status !== 'withdrawn') ||
        (attempt.body.expected_revision !== undefined &&
          result.revision !== Number(attempt.body.expected_revision) + 1)
      )
        throw new Error('简报回执状态不一致，请使用原请求核实结果。')
      journal?.write(null)
      pending.value = null
      return result
    } catch (failure) {
      const status = Number((failure as { status?: number })?.status)
      if (status >= 400 && status < 500 && status !== 408) {
        journal?.write(null)
        pending.value = null
      }
      throw failure
    } finally {
      running = false
    }
  }
  return {
    pending,
    execute(path: string, method: string, body: ObjectRow, elderId: string) {
      if (pending.value)
        throw new Error('上一笔操作的结果尚未核实，请先重试原请求。')
      const attempt = {
        path,
        method,
        body: structuredClone(body),
        key: key(),
        elderId,
      }
      journal?.write(attempt)
      pending.value = attempt
      return run(attempt)
    },
    retry() {
      return pending.value ? run(pending.value) : Promise.resolve(undefined)
    },
    clear() {
      pending.value = null
    },
    restore() {
      const value = journal?.read()
      if (value == null) return
      const attempt = row(value)
      if (
        !id(attempt.elderId) ||
        !id(attempt.key) ||
        !string(attempt.path) ||
        !(
          (attempt.method === 'post' &&
            (/^\/family\/summaries\/from-selection$/.test(attempt.path) ||
              /^\/family\/summaries\/[^/?]+\/review$/.test(attempt.path))) ||
          (attempt.method === 'patch' &&
            /^\/family\/summaries\/[^/?]+$/.test(attempt.path))
        )
      )
        throw new Error('本机简报提交凭证无法读取，请先联系管理员核对结果。')
      row(attempt.body)
      pending.value = attempt as unknown as SummaryMutationAttempt
    },
  }
}
