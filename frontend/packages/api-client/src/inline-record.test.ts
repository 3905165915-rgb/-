import { beforeEach, describe, expect, it } from 'vitest'
import { createApi } from './index'
import { parseInlineRecordResponse } from './validators'

const record = {
  id: 'REC-1', elder_id: 'E/1', status: 'confirmed', revision: 3,
  raw_text: '老人表示今天想休息。', admission_id: 'ADM-1',
  created_at: '2026-10-27T01:00:00Z', happened_at: null,
}

beforeEach(() => {
  globalThis.sessionStorage = { getItem: () => null, removeItem() {} } as Storage
  globalThis.localStorage = { removeItem() {} } as Storage
})

describe('inline record API contract', () => {
  it('keeps the saved record when analysis failed', () => {
    expect(parseInlineRecordResponse({ record, analysis_status: 'failed', analysis: null }, 'E/1'))
      .toMatchObject({ record: { id: 'REC-1' }, analysis_status: 'failed', analysis: null })
  })

  it('rejects an elder mismatch and a stale analysis revision', () => {
    expect(() => parseInlineRecordResponse({ record, analysis_status: 'failed', analysis: null }, 'E-2')).toThrow()
    expect(() => parseInlineRecordResponse({ record, analysis_status: 'ready', analysis: {
      id: 'AN-1', record_id: 'REC-1', record_revision: 2, status: 'ready', created_at: '2026-10-27T01:00:00Z',
    } }, 'E/1')).toThrow()
    expect(() => parseInlineRecordResponse({ record, analysis_status: 'ready', analysis: {
      id: 'AN-1', record_id: 'REC-1', record_revision: 3, status: 'ready', created_at: '2026-10-27T01:00:00Z',
      scene: { value: null, citation: null }, observations: [{ id: 'O-1', text: '摘要', citation: { source_field: 'raw_text', quote: '伪造引用' } }],
      task_suggestions: [], preference_suggestions: [],
    } }, 'E/1')).toThrow()
  })

  it('uses encoded IDs and idempotency headers for save, retry and one-step confirmation', async () => {
    const api = createApi()
    const calls: string[] = []
    api.client.defaults.adapter = async (config) => {
      calls.push(`${config.method} ${config.url}`)
      if (config.url?.endsWith('/record'))
        expect(config.headers['Idempotency-Key']).toBe('record-key')
      if (config.url?.endsWith('/confirm')) {
        expect(config.headers['Idempotency-Key']).toBe('confirm-key')
        expect(JSON.parse(config.data)).toMatchObject({ expected_revision: 3, accepted_tasks: [] })
        return { data: { record: { id: 'REC-1' }, tasks: [] }, status: 200, statusText: 'OK', headers: {}, config }
      }
      return { data: { record, analysis_status: 'failed', analysis: null }, status: 200, statusText: 'OK', headers: {}, config }
    }
    const response = await api.saveElderRecord('E/1', { text: '今天想休息' }, 'record-key')
    expect(response.record.id).toBe('REC-1')
    await api.retryElderRecordAnalysis('E/1', 'REC/1')
    await api.confirmElderRecordAnalysis('E/1', 'REC/1', 'AN/1', {
      expected_revision: 3, preference_decisions: [], accepted_tasks: [],
    }, 'confirm-key')
    expect(calls).toEqual([
      'post /elders/E%2F1/record',
      'post /elders/E%2F1/records/REC%2F1/analyze',
      'post /elders/E%2F1/records/REC%2F1/analysis/AN%2F1/confirm',
    ])
  })
})
