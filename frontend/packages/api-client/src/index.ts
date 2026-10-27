import type { AxiosInstance } from 'axios'
import { createApiClient } from './http'
import { ContractError } from './errors'
import { readSession, type RecordDraft } from '@hulao/shared'
import {
  parseElder,
  parseFamilyCase,
  parseHandoverItem,
  parseList,
  parseLoginResponse,
  parseRecordDraft,
  parseTask,
  parseTimelineEvent,
} from './validators'
export { toUiError, ContractError } from './errors'

export interface LoginPayload {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  user_id?: string
  token_type?: string
  role?: string
}

export function createApi(baseURL?: string) {
  const client = createApiClient(baseURL)
  const handoverParents = new Map<string, string>()
  function confirmBody(payload: Partial<RecordDraft>) {
    if (!payload.fields) return {}
    const lines = (text: string) =>
      text
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean)
    const candidates = payload.taskCandidates ?? []
    return {
      observations: lines(payload.fields.observation),
      task_candidates: lines(payload.fields.followUp).map((title, index) => ({
        ...(candidates[index]?.title === title
          ? candidates[index]
          : (candidates.find((item) => item.title === title) ?? {})),
        title,
      })),
    }
  }
  function confirmedResponse(value: unknown): unknown {
    if (
      !value ||
      typeof value !== 'object' ||
      !('record' in value) ||
      !value.record ||
      typeof value.record !== 'object' ||
      !('id' in value.record) ||
      typeof value.record.id !== 'string' ||
      !('tasks' in value) ||
      !Array.isArray(value.tasks)
    )
      throw new ContractError(
        '服务端确认结果结构不匹配，请核实记录状态后再操作',
      )
    parseList(value.tasks, 'POST /records/confirm', parseTask)
    return value
  }
  return {
    client,
    login(payload: LoginPayload) {
      return client
        .post<unknown>('/auth/login', payload)
        .then((response) =>
          parseLoginResponse(response.data, 'POST /auth/login'),
        )
    },
    elders(params?: Record<string, string | number>) {
      return client
        .get<unknown>('/elders', { params })
        .then((response) => parseList(response.data, 'GET /elders', parseElder))
    },
    extractRecord(payload: { text: string; elder_id?: string; expectedEpoch?: string; sourceKey?: string }) {
      return client
        .post<unknown>('/records/extract', payload, { timeout: 60000 })
        .then((response) =>
          parseRecordDraft(response.data, 'POST /records/extract'),
        )
    },
    confirmRecord(id: string, payload: Partial<RecordDraft>) {
      return client
        .post(
          `/records/${encodeURIComponent(id)}/confirm`,
          confirmBody(payload),
        )
        .then((response) => confirmedResponse(response.data))
    },
    manualRecord(
      payload: {
        elder_id: string
        raw_text: string
        review: RecordDraft['fields']
      },
      idempotencyKey: string,
    ) {
      return client
        .post(
          '/records/manual',
          {
            elder_id: payload.elder_id,
            raw_text: payload.raw_text,
            ...confirmBody({ fields: payload.review }),
          },
          { headers: { 'Idempotency-Key': idempotencyKey } },
        )
        .then((response) => confirmedResponse(response.data))
    },
    tasks(params?: Record<string, string>) {
      return client
        .get<unknown>('/tasks', { params })
        .then((response) => parseList(response.data, 'GET /tasks', parseTask))
    },
    completeTask(
      id: string,
      payload: { result: string; idempotencyKey: string },
    ) {
      return client
        .post(
          `/tasks/${encodeURIComponent(id)}/complete`,
          { result: payload.result },
          {
            headers: { 'Idempotency-Key': payload.idempotencyKey },
          },
        )
        .then((response) => response.data)
    },
    handover(shiftId: string) {
      return client
        .get<unknown>('/handovers', { params: { shift_id: shiftId } })
        .then((response) => {
          if (!Array.isArray(response.data))
            throw new ContractError('交班列表结构不匹配')
          const rows = response.data.flatMap((handover) => {
            if (
              !handover ||
              typeof handover.id !== 'string' ||
              !Array.isArray(handover.items)
            )
              throw new ContractError('交班明细结构不匹配')
            return handover.items.map((item: Record<string, unknown>) => {
              if (typeof item.id !== 'string')
                throw new ContractError('交班事项缺少编号')
              handoverParents.set(item.id, handover.id)
              return {
                id: item.id,
                title: item.kind === 'task' ? '待办接续' : '照护记录',
                detail: item.detail,
                owner: '',
                status: (
                  {
                    pending: '待接收',
                    received: '已接收',
                    clarifying: '需澄清',
                  } as Record<string, string>
                )[String(item.status)],
                itemId: item.source_id,
                receivedAt: item.received_at ?? '',
                receivedBy: item.received_by ?? '',
                note: item.receipt_note ?? '',
              }
            })
          })
          return parseList(rows, 'GET /handovers', parseHandoverItem)
        })
    },
    receiveHandover(
      id: string,
      payload: { status: 'received' | 'clarifying'; note?: string; expectedEpoch?: string },
    ) {
      const handoverId = handoverParents.get(id)
      if (!handoverId)
        return Promise.reject(new ContractError('请刷新交班明细后再接收'))
      return client
        .post(
          `/handovers/${encodeURIComponent(handoverId)}/items/${encodeURIComponent(id)}/receive`,
          payload,
        )
        .then((response) => response.data)
    },
    timeline(id: string) {
      return client
        .get<unknown>(`/items/${encodeURIComponent(id)}/timeline`)
        .then((response) =>
          parseList(
            response.data,
            'GET /items/:id/timeline',
            parseTimelineEvent,
          ),
        )
    },
    async familyCases() {
      const mapFeedback = (row: Record<string, unknown>) =>
        'elderId' in row
          ? row
          : {
              id: row.id,
              elderId: row.elder_id,
              subject: row.text,
              status:
                row.status === 'open'
                  ? 'received'
                  : row.status === 'closed'
                    ? 'replied'
                    : row.status,
              reply: row.reply ?? '',
              public: true,
            }
      if (readSession()?.role !== 'family') {
        const response = await client.get('/family/cases', {
          params: { kind: 'feedback' },
        })
        if (!Array.isArray(response.data))
          throw new ContractError('家属反馈列表结构不匹配')
        return parseList(
          response.data.map(mapFeedback),
          'GET /family/cases',
          parseFamilyCase,
        )
      }
      const response = await client.get('/family/me/bindings')
      if (!Array.isArray(response.data))
        throw new ContractError('家属授权列表结构不匹配')
      const lists = await Promise.all(
        response.data.map(async (binding) => {
          if (
            !binding ||
            typeof binding.id !== 'string' ||
            !Array.isArray(binding.scopes)
          )
            throw new ContractError('家属授权结构不匹配')
          const rows: unknown[] = []
          if (binding.scopes.includes('summary')) {
            const summaries = await client.get(
              `/family/me/bindings/${encodeURIComponent(binding.id)}/summaries`,
            )
            if (!Array.isArray(summaries.data))
              throw new ContractError('家属简报结构不匹配')
            rows.push(
              ...summaries.data.map((row) => ({
                id: row.id,
                elderId: row.elder_id,
                subject: '照护简报',
                status: 'replied',
                reply: row.text,
                public: true,
              })),
            )
          }
          if (binding.scopes.includes('feedback')) {
            const feedback = await client.get(
              `/family/me/bindings/${encodeURIComponent(binding.id)}/feedback`,
            )
            if (!Array.isArray(feedback.data))
              throw new ContractError('家属反馈结构不匹配')
            rows.push(...feedback.data.map(mapFeedback))
          }
          return rows
        }),
      )
      return parseList(lists.flat(), 'GET /family/me/bindings', parseFamilyCase)
    },
  }
}

export function createApiClientFacade(baseURL?: string): AxiosInstance {
  return createApiClient(baseURL)
}
