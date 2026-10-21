import type { AxiosInstance } from 'axios'
import { createApiClient } from './http'
import type { RecordDraft } from '@hulao/shared'
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
  token_type?: string
  role?: string
}

export function createApi(baseURL?: string) {
  const client = createApiClient(baseURL)
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
    extractRecord(payload: { text: string; elder_id?: string }) {
      return client
        .post<unknown>('/records/extract', payload)
        .then((response) =>
          parseRecordDraft(response.data, 'POST /records/extract'),
        )
    },
    confirmRecord(id: string, payload: Partial<RecordDraft>) {
      return client
        .post(`/records/${encodeURIComponent(id)}/confirm`, payload)
        .then((response) => response.data)
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
        .post(`/tasks/${encodeURIComponent(id)}/complete`, payload, {
          headers: { 'Idempotency-Key': payload.idempotencyKey },
        })
        .then((response) => response.data)
    },
    handover(shiftId: string) {
      return client
        .get<unknown>(`/handover/${encodeURIComponent(shiftId)}`)
        .then((response) =>
          parseList(response.data, 'GET /handover/:shiftId', parseHandoverItem),
        )
    },
    receiveHandover(
      id: string,
      payload: { status: 'received' | 'clarifying'; note?: string },
    ) {
      return client
        .post(`/handover/${encodeURIComponent(id)}/receive`, payload)
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
    familyCases() {
      return client
        .get<unknown>('/family/cases')
        .then((response) =>
          parseList(response.data, 'GET /family/cases', parseFamilyCase),
        )
    },
  }
}

export function createApiClientFacade(baseURL?: string): AxiosInstance {
  return createApiClient(baseURL)
}
