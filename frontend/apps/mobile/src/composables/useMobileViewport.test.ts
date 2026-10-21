import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileViewport } from './useMobileViewport'

const lifecycle = vi.hoisted(() => ({
  mount: undefined as (() => void) | undefined,
  dispose: undefined as (() => void) | undefined,
}))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (callback: () => void) => {
    lifecycle.mount = callback
  },
  onScopeDispose: (callback: () => void) => {
    lifecycle.dispose = callback
  },
}))

describe('mobile viewport', () => {
  let viewport: EventTarget & { height: number; offsetTop: number }
  let documentTarget: EventTarget & {
    activeElement: { matches: () => boolean } | null
  }
  beforeEach(() => {
    viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 })
    documentTarget = Object.assign(new EventTarget(), { activeElement: null })
    vi.stubGlobal('window', { innerHeight: 844, visualViewport: viewport })
    vi.stubGlobal('document', documentTarget)
  })
  afterEach(() => {
    lifecycle.dispose?.()
    lifecycle.mount = undefined
    lifecycle.dispose = undefined
    vi.unstubAllGlobals()
  })
  it('keeps the footer above an editing keyboard and restores it on blur', () => {
    const state = useMobileViewport()
    lifecycle.mount?.()
    documentTarget.activeElement = { matches: () => true }
    viewport.height = 500
    viewport.offsetTop = 24
    viewport.dispatchEvent(new Event('resize'))
    expect(state.keyboardOffset.value).toBe(320)
    expect(state.keyboardOpen.value).toBe(true)
    documentTarget.activeElement = null
    documentTarget.dispatchEvent(new Event('focusout'))
    expect(state.keyboardOffset.value).toBe(0)
    expect(state.keyboardOpen.value).toBe(false)
  })
  it('does not treat browser chrome or a non-editing viewport resize as a keyboard', () => {
    const state = useMobileViewport()
    lifecycle.mount?.()
    documentTarget.activeElement = { matches: () => true }
    viewport.height = 780
    viewport.dispatchEvent(new Event('resize'))
    expect(state.keyboardOffset.value).toBe(0)
    documentTarget.activeElement = null
    viewport.height = 400
    viewport.dispatchEvent(new Event('resize'))
    expect(state.keyboardOffset.value).toBe(0)
  })
  it('supports browsers without visualViewport', () => {
    vi.stubGlobal('window', { innerHeight: 844 })
    const state = useMobileViewport()
    lifecycle.mount?.()
    documentTarget.dispatchEvent(new Event('focusin'))
    expect(state.keyboardOpen.value).toBe(false)
  })
  it('removes viewport and focus listeners when the layout unmounts', () => {
    const removeViewport = vi.spyOn(viewport, 'removeEventListener')
    const removeDocument = vi.spyOn(documentTarget, 'removeEventListener')
    useMobileViewport()
    lifecycle.mount?.()
    lifecycle.dispose?.()
    expect(removeViewport.mock.calls.map(([event]) => event)).toEqual([
      'resize',
      'scroll',
    ])
    expect(removeDocument.mock.calls.map(([event]) => event)).toEqual([
      'focusin',
      'focusout',
    ])
  })
})
