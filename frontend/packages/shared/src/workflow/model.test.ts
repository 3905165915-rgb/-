import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  clean,
  initial,
  materialize,
  operations,
  schemas,
  request,
  requestBinary,
  requestBlob,
  requestBody,
  type Operation,
} from './model'
import { pcmWav } from './audio'

beforeEach(() => {
  vi.stubGlobal('sessionStorage', {
    getItem: () =>
      JSON.stringify({
        mode: 'api',
        accountKey: 'test',
        role: 'admin',
        accessToken: 'synthetic-token',
      }),
    removeItem: vi.fn(),
  })
  vi.stubGlobal('localStorage', { removeItem: vi.fn() })
  vi.stubGlobal('window', new EventTarget())
})
describe('business form contracts', () => {
  it('explains occupied beds even when an older server only returns the error code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'bed_occupied' }), { status: 409 })))
    await expect(request('/elders/E1/admissions', 'post', {})).rejects.toThrow('所选床位已被占用，请选择空闲床位')
  })
  it('allows raw-only manual entry without reviving AI task candidates removed by a reviewer', () => {
    const value = initial(schemas.ManualRecordRequest) as Record<string, unknown>
    Object.assign(value, { elder_id: 'E1', raw_text: '虚构：家属已回复，下午愿意参加活动' })
    const manual = requestBody('/records/manual', schemas.ManualRecordRequest, value)
    expect(manual).not.toHaveProperty('observations')
    expect(manual).toHaveProperty('raw_text', value.raw_text)
    expect(manual).toHaveProperty('task_candidates', [])
    const reviewed = requestBody('/records/{draft_id}/confirm', schemas.RecordConfirmRequest, {
      observations: ['虚构：午餐吃了一半'], task_candidates: [],
    })
    expect(reviewed).toHaveProperty('task_candidates', [])
    expect(() => requestBody('/records/{draft_id}/confirm', schemas.RecordConfirmRequest, {
      observations: [], task_candidates: [],
    })).toThrow()
  })
  it('does not silently disable accounts or beds when only renaming them', () => {
    const value = initial(schemas.BedUpdate) as Record<string, unknown>
    Object.assign(value, {
      expected_revision: 2,
      reason: '仅修改床位名称',
      label: '新名称',
    })
    expect(clean(schemas.BedUpdate, value)).toEqual({
      expected_revision: 2,
      reason: '仅修改床位名称',
      label: '新名称',
    })
    value.enabled = false
    expect(clean(schemas.BedUpdate, value)).toHaveProperty('enabled', false)
  })
  it('requires explicit scores, preserves zero and converts numeric selections', () => {
    const schema = {
      type: 'object',
      properties: { score: { type: 'integer', minimum: 0 } },
      required: ['score'],
    }
    expect(clean(schema, { score: '0' })).toEqual({ score: 0 })
    expect(() => clean(schema, { score: '' })).toThrow()
    expect(() => clean(schema, { score: '2.5' })).toThrow()
  })
  it('preserves time zone information and escapes IDs independently from query parameters', () => {
    expect(
      clean(
        { type: 'string', format: 'date-time' },
        '2026-10-20T23:00:00+08:00',
      ),
    ).toBe('2026-10-20T15:00:00.000Z')
    const op = {
      path: '/records/{record_id}',
      parameters: [
        {
          name: 'record_id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        { name: 'note', in: 'query', schema: { type: 'string' } },
      ],
    } as Operation
    expect(materialize(op, { record_id: 'a/b', note: 'x&y' })).toBe(
      '/records/a%2Fb?note=x%26y',
    )
  })
  it('has separate operations for all AI generation and human approval steps', () => {
    for (const path of [
      '/records/extract',
      '/records/context-extract',
      '/handovers/{handover_id}/ai-summary',
      '/quality/checks',
      '/records/{draft_id}/confirm',
      '/memories/{memory_id}/review',
      '/handovers/{handover_id}/submit',
    ]) {
      expect(
        operations.some((op) => op.path === path && op.method === 'post'),
      ).toBe(true)
    }
    expect(new Set(operations.map((op) => op.id)).size).toBe(operations.length)
    expect(
      operations
        .filter((op) => op.roles.includes('family'))
        .every((op) => op.path.startsWith('/family/me/')),
    ).toBe(true)
  })
  it('sends versioned JSON and a stable idempotency header without body pollution', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'completed' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetcher)
    await request(
      '/tasks/T/complete',
      'post',
      { result: '虚构测试完成' },
      'stable-key',
    )
    const args = fetcher.mock.calls[0]
    expect(args[1].headers['Idempotency-Key']).toBe('stable-key')
    expect(JSON.parse(args[1].body)).toEqual({ result: '虚构测试完成' })
  })
  it('does not report an unavailable AI service as a saved record', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: 'AI unavailable' }), {
            status: 503,
          }),
        ),
    )
    await expect(
      request('/records/extract', 'post', { text: '虚构原文' }),
    ).rejects.toThrow('AI暂不可用')
  })
  it('explains mismatched quality scopes in Chinese if the server rejects them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'quality_scope_mismatch' }), { status: 422 },
    )))
    await expect(request('/quality/checks', 'post', {})).rejects.toThrow('所选班次必须是该交班单的交出班次')
  })
  it('uploads bounded image bytes with the authenticated binary contract and fetches private content as a blob', async () => {
    const uploadResponse = new Response(JSON.stringify({ id: 'PHOTO-1', status: 'pending_review' }), { status: 201 })
    const contentResponse = new Response(new Blob(['synthetic-image'], { type: 'image/jpeg' }), { status: 200 })
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse).mockResolvedValueOnce(contentResponse)
    vi.stubGlobal('fetch', fetcher)
    const file = new Blob(['synthetic-image'], { type: 'image/jpeg' })
    await requestBinary('/attachments?elder_id=E1', file, 'image/jpeg', 'upload-1')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toContain('/api/v1/attachments?elder_id=E1')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer synthetic-token',
      'Content-Type': 'image/jpeg',
      'Idempotency-Key': 'upload-1',
    })
    expect(init.body).toBe(file)
    const blob = await requestBlob('/attachments/PHOTO-1/content')
    expect(blob.size).toBeGreaterThan(0)
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic-token')
  })
  it('rejects oversized images before sending and keeps the server idempotency error actionable', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(requestBinary('/attachments', new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]), 'image/jpeg', 'large'))
      .rejects.toThrow('不能超过4MiB')
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ safe_message: '照片已发生变化' }), { status: 409 })))
    await expect(requestBlob('/attachments/PHOTO-1/content')).rejects.toThrow('照片已发生变化')
  })
  it.each(['json', 'blob'])('does not clear a newer login when an old %s request returns 401', async kind => {
    let active = { mode: 'api', accountKey: 'old', role: 'caregiver', accessToken: 'synthetic-old' }
    const removeItem = vi.fn()
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify(active), removeItem })
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const pending = kind === 'json' ? request('/notifications') : requestBlob('/attachments/P1/content')
    active = { ...active, accountKey: 'new', accessToken: 'synthetic-new' }
    finish(new Response(JSON.stringify({ detail: 'expired synthetic session' }), { status: 401 }))
    await expect(pending).rejects.toThrow()
    expect(removeItem).not.toHaveBeenCalled()
  })
})
describe('cloud audio format', () => {
  it('encodes mono PCM16 WAV with the cloud endpoint sample rate', async () => {
    const blob = pcmWav(new Float32Array([-2, 0, 2]))
    const bytes = await blob.arrayBuffer()
    const view = new DataView(bytes)
    expect(blob.type).toBe('audio/wav')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(48, true)).toBe(32767)
  })
  it('rejects empty or more than sixty seconds before upload', () => {
    expect(() => pcmWav(new Float32Array(0))).toThrow()
    expect(() => pcmWav(new Float32Array(960001))).toThrow()
  })
})
