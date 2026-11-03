import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError } from 'axios'
import { createInitialDemoState } from '@hulao/shared'
import { createApi } from './index'
import { createGateway } from './gateway'
import { ContractError, toUiError } from './errors'
import type { AxiosAdapter } from 'axios'

beforeEach(() => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    removeItem: () => undefined,
  })
  vi.stubGlobal('localStorage', { removeItem: () => undefined })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function withResponse(data: unknown, status = 200) {
  const api = createApi('/api')
  api.client.defaults.adapter = (async (config) => ({
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
  })) satisfies AxiosAdapter
  return api
}
describe('existing API contracts', () => {
  it('accepts the minimal safe-render GET elders fixture used by live e2e', async () => {
    const rows = [
      { id: 'e-live', name: '测试老人', bedLabel: '101床', status: '入住' },
    ]
    expect(await withResponse(rows).elders()).toEqual(rows)
    expect(rows[0]).not.toHaveProperty('lastUpdate')
    expect(rows[0]).not.toHaveProperty('age')
  })

  it('rejects an envelope instead of silently showing seed data', async () => {
    const api = withResponse({ items: [] })
    await expect(api.elders()).rejects.toThrow('结构不匹配')
  })
  it('rejects malformed AI results and accepts declared fields', async () => {
    await expect(
      withResponse({ id: 'draft' }).extractRecord({ text: 'a' }),
    ).rejects.toThrow('结构不匹配')
    const draft = {
      id: 'draft',
      elderId: 'elder',
      originalText: 'a',
      status: 'pending_review',
      fields: { observation: 'a', followUp: '', contactTarget: '' },
      evidence: [],
      warnings: [],
    }
    expect(await withResponse(draft).extractRecord({ text: 'a' })).toEqual(
      draft,
    )
  })
  it('encodes identifiers and puts the completion key only in the header', async () => {
    const api = createApi('/api')
    const payload = { result: '已联系', idempotencyKey: 'attempt-1' }
    api.client.defaults.adapter = async (config) => {
      expect(config.url).toBe('/tasks/a%2Fb/complete')
      expect(JSON.parse(config.data)).toEqual({ result: payload.result })
      expect(config.headers['Idempotency-Key']).toBe('attempt-1')
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    }
    await api.completeTask('a/b', payload)
  })
  it('normalizes network and authorization errors without fallback', () => {
    expect(
      toUiError({ isAxiosError: true, response: { status: 403 } }).kind,
    ).toBe('forbidden')
    expect(
      toUiError({ isAxiosError: true, response: { status: 401 } }).canRetry,
    ).toBe(false)
    expect(toUiError({ isAxiosError: true }).kind).toBe('network')
  })
})

const seed = createInitialDemoState()
type ReadApi = Omit<ReturnType<typeof createApi>, 'client'>
const endpoints: {
  name: string
  endpoint: string
  read: (api: ReadApi) => Promise<unknown>
  valid: unknown
  invalid: unknown
  path: string
}[] = [
  {
    name: 'elders',
    endpoint: 'GET /elders',
    read: (api) => api.elders(),
    valid: seed.elders,
    invalid: [{ ...seed.elders[0], age: '78' }],
    path: '$[0].age',
  },
  {
    name: 'tasks',
    endpoint: 'GET /tasks',
    read: (api) => api.tasks(),
    valid: seed.tasks,
    invalid: [{ ...seed.tasks[0], status: 'new_unknown_status' }],
    path: '$[0].status',
  },
  {
    name: 'family',
    endpoint: 'GET /family/cases',
    read: (api) => api.familyCases(),
    valid: seed.familyCases,
    invalid: [{ ...seed.familyCases[0], public: 'true' }],
    path: '$[0].public',
  },
  {
    name: 'timeline',
    endpoint: 'GET /items/:id/timeline',
    read: (api) => api.timeline('private-item/id'),
    valid: seed.timeline,
    invalid: [{ ...seed.timeline[0], happenedAt: '2026-02-30T12:00' }],
    path: '$[0].happenedAt',
  },
  {
    name: 'login',
    endpoint: 'POST /auth/login',
    read: (api) =>
      api.login({ username: 'private-user', password: 'private-password' }),
    valid: { access_token: 'private-token' },
    invalid: { access_token: 'private-token', role: 3 },
    path: '$.role',
  },
  {
    name: 'AI',
    endpoint: 'POST /records/extract',
    read: (api) => api.extractRecord({ text: 'private-original-text' }),
    valid: seed.drafts[0],
    invalid: {
      ...seed.drafts[0],
      warnings: ['valid', { text: 'private-original-text' }],
    },
    path: '$.warnings[1]',
  },
]

describe.each(endpoints)(
  '$name endpoint validation',
  ({ endpoint, read, valid, invalid, path }) => {
    it('validates successful read/login/AI responses', async () => {
      expect(await read(withResponse(valid))).toEqual(valid)
    })
    it('rejects malformed successful responses with endpoint and field path only', async () => {
      const log = vi.spyOn(console, 'error')
      try {
        await read(withResponse(invalid))
        expect.unreachable('accepted malformed API response')
      } catch (error) {
        expect(error).toBeInstanceOf(ContractError)
        expect(error).toMatchObject({ endpoint, fieldPath: path })
        expect(toUiError(error)).toMatchObject({
          kind: 'contract',
          canRetry: false,
        })
        for (const secret of [
          'private-password',
          'private-user',
          'private-token',
          'private-original-text',
          'private-item',
          'private-shift',
        ]) {
          expect((error as Error).message).not.toContain(secret)
        }
      }
      expect(log).not.toHaveBeenCalled()
    })
  },
)

describe('failure and write-response boundaries', () => {
  it.each([500, 401, 403])(
    'propagates HTTP %s from the real gateway without demo fallback',
    async (status) => {
      const originalAdapter = axios.defaults.adapter
      axios.defaults.adapter = async (config) => {
        throw new AxiosError(
          'request failed',
          'ERR_BAD_RESPONSE',
          config,
          undefined,
          {
            data: {},
            status,
            statusText: 'Error',
            headers: {},
            config,
          },
        )
      }
      try {
        const gateway = createGateway('api', '/api')
        for (const { read } of endpoints) {
          await expect(read(gateway)).rejects.toMatchObject({
            response: { status },
          })
        }
      } finally {
        axios.defaults.adapter = originalAdapter
      }
      expect(toUiError({ isAxiosError: true, response: { status } }).kind).toBe(
        status === 401
          ? 'unauthorized'
          : status === 403
            ? 'forbidden'
            : 'unknown',
      )
    },
  )
  it.each([undefined, null, {}, { acknowledged: true }])(
    'passes through unconfirmed write responses without fabricating schemas: %s',
    async (data) => {
      const api = withResponse(data)
      await expect(api.confirmRecord('draft/id', {})).rejects.toThrow(
        '确认结果结构不匹配',
      )
      expect(
        await api.completeTask('task/id', {
          result: 'done',
          idempotencyKey: 'key',
        }),
      ).toEqual(data)
      await expect(
        api.receiveHandover('handover/id', { status: 'received' }),
      ).rejects.toThrow('请刷新交班明细')
    },
  )
  it('keeps parameter and route encoding behavior for reads', async () => {
    const api = withResponse([])
    const seen: { url: string | undefined; params: unknown }[] = []
    api.client.defaults.adapter = async (config) => {
      seen.push({ url: config.url, params: config.params })
      return { data: [], status: 200, statusText: 'OK', headers: {}, config }
    }
    await api.elders({ page: 1 })
    await api.tasks({ status: 'cancelled' })
    await api.handover('a/b')
    await api.timeline('a/b')
    expect(seen).toEqual([
      { url: '/elders', params: { page: 1 } },
      { url: '/tasks', params: { status: 'cancelled' } },
      { url: '/handovers', params: { shift_id: 'a/b' } },
      { url: '/items/a%2Fb/timeline', params: undefined },
    ])
  })
})
