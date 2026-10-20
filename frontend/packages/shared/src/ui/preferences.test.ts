import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyUiPreferences,
  getReducedTransparency,
  setReducedTransparency,
} from './preferences'

afterEach(() => vi.unstubAllGlobals())

function setup(value: string | null = null) {
  const dataset: Record<string, string> = {}
  const storage = { getItem: vi.fn(() => value), setItem: vi.fn() }
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('localStorage', storage)
  return { dataset, storage }
}

describe('UI transparency preferences', () => {
  it('uses glass by default, without relying on a browser', () => {
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('localStorage', undefined)
    expect(getReducedTransparency()).toBe(false)
    expect(() => applyUiPreferences()).not.toThrow()
    expect(setReducedTransparency(true)).toBe(false)
  })

  it('restores the stored explicit preference', () => {
    const { dataset } = setup('true')
    applyUiPreferences()
    expect(getReducedTransparency()).toBe(true)
    expect(dataset.reduceTransparency).toBe('true')
  })

  it('persists both on and off changes', () => {
    const { dataset, storage } = setup()
    expect(setReducedTransparency(true)).toBe(true)
    expect(dataset.reduceTransparency).toBe('true')
    expect(storage.setItem).toHaveBeenLastCalledWith(
      'hulao.ui.reduce-transparency',
      'true',
    )
    expect(setReducedTransparency(false)).toBe(true)
    expect(dataset.reduceTransparency).toBe('false')
    expect(storage.setItem).toHaveBeenLastCalledWith(
      'hulao.ui.reduce-transparency',
      'false',
    )
  })

  it('applies the choice even when storage is full or blocked', () => {
    const { dataset, storage } = setup()
    storage.setItem.mockImplementation(() => {
      throw new Error('quota')
    })
    expect(setReducedTransparency(true)).toBe(false)
    expect(dataset.reduceTransparency).toBe('true')
    storage.getItem.mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(getReducedTransparency()).toBe(false)
  })

  it.each(['false', '', '1', 'unexpected'])(
    'does not interpret arbitrary stored values as true: %s',
    (value) => {
      setup(value)
      expect(getReducedTransparency()).toBe(false)
    },
  )
})
