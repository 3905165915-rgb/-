import { describe, expect, it } from 'vitest'
import { recoveryKey, supportsReplay, withoutSecrets, WorkflowRecovery, type WorkflowSnapshot } from './recovery'

const form = (): Omit<WorkflowSnapshot, 'version' | 'updatedAt'> => ({
  operation: 'manual', params: {}, body: { raw_text: '虚构：明天再看看' }, phase: 'editing',
})
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) } }
}
describe('formal workflow recovery', () => {
  it('scopes identities and canonicalizes context independently of property order', () => {
    expect(recoveryKey('A', 'tasks', { b: 2, a: 1 })).toBe(recoveryKey('A', 'tasks', { a: 1, b: 2 }))
    expect(recoveryKey('A', 'tasks', {})).not.toBe(recoveryKey('B', 'tasks', {}))
  })
  it('synchronously restores the final keystroke on refresh', () => {
    const port = storage()
    const first = new WorkflowRecovery('test', port, 'tab-1')
    first.restore()
    first.save(form())
    const next = form()
    next.body.raw_text += '，刚输入'
    first.save(next)
    const refreshed = new WorkflowRecovery('test', port, 'tab-1')
    expect(refreshed.restore()?.body.raw_text).toBe('虚构：明天再看看，刚输入')
  })
  it('rejects a stale tab without destroying either writer journal', () => {
    const port = storage()
    const a = new WorkflowRecovery('test', port, 'a')
    const b = new WorkflowRecovery('test', port, 'b')
    a.restore(); b.restore()
    a.save(form())
    const other = form()
    other.body.raw_text = '另一窗口输入'
    expect(() => b.save(other)).toThrow('其他窗口')
    expect(a.restore()?.body.raw_text).toBe('虚构：明天再看看')
    expect(JSON.parse(port.getItem(b.journalKey)!).body.raw_text).toBe('另一窗口输入')
    expect(b.journal()?.body.raw_text).toBe('另一窗口输入')
  })
  it('retains exact pending payload and key until server success is recorded', () => {
    const port = storage()
    const first = new WorkflowRecovery('test', port, 'a')
    const pending = { signature: 'signature', key: 'same-key', method: 'post', path: '/records/manual', payload: form().body }
    first.save({ ...form(), phase: 'pending', pending })
    const next = new WorkflowRecovery('test', port, 'a')
    expect(next.restore()).toMatchObject({ phase: 'pending', pending })
    next.save({ ...form(), phase: 'succeeded', pending, result: { id: 'REC-synthetic' } })
    expect(new WorkflowRecovery('test', port, 'b').restore()?.phase).toBe('succeeded')
  })
  it('fails closed on corrupted or unavailable storage', () => {
    const port = storage()
    port.setItem('test', '{')
    expect(() => new WorkflowRecovery('test', port, 'a').restore()).toThrow()
    const unavailable = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(() => new WorkflowRecovery('test', unavailable, 'a').save(form())).toThrow('quota')
  })
  it('only permits mutation replay supported by the inspected backend routes', () => {
    for (const path of ['/records/manual', '/tasks/T/complete', '/admissions/A/actions', '/assessments/A/review', '/care-plans/P/generate', '/family/me/feedback'])
      expect(supportsReplay(path, 'post'), path).toBe(true)
    for (const path of ['/records/extract', '/records/context-extract', '/handovers', '/handovers/H/submit', '/staff', '/care-plans/P/confirm', '/admissions/A/events'])
      expect(supportsReplay(path, 'post'), path).toBe(false)
    expect(supportsReplay('/tasks/T', 'patch')).toBe(false)
    expect(supportsReplay('/elders/E', 'patch')).toBe(true)
  })
  it('does not write credential material into recovery snapshots or receipts', () => {
    expect(withoutSecrets({ password: 'sensitive', nested: [{ access_token: 'sensitive', raw_text: '保留原文' }] }))
      .toEqual({ password: '', nested: [{ access_token: '', raw_text: '保留原文' }] })
  })
})
