import { describe, expect, it, vi } from 'vitest'
import type { FrontendSession } from '../session'
import { createRemoteOptions, optionLabel } from './remote-options'
const session: FrontendSession = { mode: 'api', accountKey: 'synthetic-admin', role: 'admin', accessToken: 'synthetic-token' }
const page = (items: unknown[], total: number, offset = 0) => ({ items, total, offset, limit: 50 })
describe('authorized option directory', () => {
  it('keeps server totals, names and selected shift filters while paging', async () => {
    const request = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, index) => ({ id: 'N' + index, label: '合成员工' + index, role: 'nurse' })), 51)).mockResolvedValueOnce(page([{ id: 'N50', label: '合成员工50', role: 'nurse' }], 51, 50))
    const options = createRemoteOptions({ request, session: () => session })
    await options.load('staff', '合成', { shift_id: 'S1' })
    const query = new URL('http://test' + request.mock.calls[0][0]).searchParams
    expect(query.get('q')).toBe('合成')
    expect(query.get('shift_id')).toBe('S1')
    expect(options.state.value.items).toHaveLength(50)
    expect(options.state.value.total).toBe(51)
    await options.more()
    expect(options.state.value.items).toHaveLength(51)
    expect(request.mock.calls[1][0]).toContain('offset=50')
    expect(optionLabel(options.state.value.items[50], 'staff')).toBe('合成员工50 · 护士')
  })
  it('ignores a slow earlier search after a newer query has finished', async () => {
    let finishEarlier!: (value: unknown) => void
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishEarlier = resolve })).mockResolvedValueOnce(page([{ id: 'E2', label: '合成乙', bed_label: '东区02床', state_label: '在院' }], 1))
    const options = createRemoteOptions({ request, session: () => session })
    const earlier = options.load('elders', '甲')
    await options.load('elders', '乙')
    finishEarlier(page([{ id: 'E1', label: '合成甲' }], 1))
    await earlier
    expect(options.state.value.items.map(row => row.id)).toEqual(['E2'])
    expect(optionLabel(options.state.value.items[0], 'elders')).toBe('合成乙 · 东区02床 · 在院')
  })
  it('shows a retryable read failure instead of pretending the directory is empty', async () => {
    const options = createRemoteOptions({ request: vi.fn().mockRejectedValue(new Error('目录暂未读取')), session: () => session })
    await options.load('incidents', '合成内容', { elder_id: 'E1' })
    expect(options.state.value.error).toBe('目录暂未读取')
    expect(options.state.value.loading).toBe(false)
    expect(options.state.value.items).toHaveLength(0)
  })
})
