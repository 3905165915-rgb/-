import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSession, readSession, saveSession } from './session'

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}
beforeEach(() => {
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  vi.stubGlobal('localStorage', new MemoryStorage())
})
describe('session isolation', () => {
  it('handles malformed JSON and invalid schemas without throwing', () => {
    for (const raw of [
      '{',
      '{}',
      '{"mode":"demo","accountKey":4}',
      '{"mode":"api","accountKey":"a","accessToken":4}',
    ]) {
      sessionStorage.setItem('hulao:session:v2', raw)
      expect(readSession()).toBeNull()
    }
  })
  it('uses only tab storage and clears legacy shared tokens', () => {
    localStorage.setItem('hulao:session', 'old-token')
    saveSession({ mode: 'demo', accountKey: 'a', role: 'caregiver' })
    expect(localStorage.getItem('hulao:session')).toBeNull()
    expect(readSession()?.accountKey).toBe('a')
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    expect(readSession()).toBeNull()
  })
  it('unknown role stays denied, then clears safely', () => {
    sessionStorage.setItem(
      'hulao:session:v2',
      JSON.stringify({ mode: 'api', accountKey: 'x', role: 'root' }),
    )
    expect(readSession()?.role).toBeNull()
    clearSession()
    expect(readSession()).toBeNull()
  })
})
