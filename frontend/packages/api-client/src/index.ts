import type { AxiosInstance } from 'axios'
import { createApiClient } from './http'
import type { Elder, FamilyCase, HandoverItem, RecordDraft, Task, TimelineEvent } from '@hulao/shared'

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
      return client.post<LoginResponse>('/auth/login', payload).then((response) => response.data)
    },
    elders(params?: Record<string, string | number>) {
      return client.get<Elder[]>('/elders', { params }).then((response) => response.data)
    },
    extractRecord(payload: { text: string; elder_id?: string }) {
      return client.post<RecordDraft>('/records/extract', payload).then((response) => response.data)
    },
    confirmRecord(id: string, payload: Partial<RecordDraft>) {
      return client.post(`/records/${id}/confirm`, payload).then((response) => response.data)
    },
    tasks(params?: Record<string, string>) {
      return client.get<Task[]>('/tasks', { params }).then((response) => response.data)
    },
    completeTask(id: string, payload: { result: string; idempotencyKey: string }) {
      return client.post(`/tasks/${id}/complete`, payload, { headers: { 'Idempotency-Key': payload.idempotencyKey } }).then((response) => response.data)
    },
    handover(shiftId: string) {
      return client.get<HandoverItem[]>(`/handover/${shiftId}`).then((response) => response.data)
    },
    receiveHandover(id: string, payload: { status: 'received' | 'clarifying'; note?: string }) {
      return client.post(`/handover/${id}/receive`, payload).then((response) => response.data)
    },
    timeline(id: string) {
      return client.get<TimelineEvent[]>(`/items/${id}/timeline`).then((response) => response.data)
    },
    familyCases() {
      return client.get<FamilyCase[]>('/family/cases').then((response) => response.data)
    },
  }
}

export function createApiClientFacade(baseURL?: string): AxiosInstance {
  return createApiClient(baseURL)
}
