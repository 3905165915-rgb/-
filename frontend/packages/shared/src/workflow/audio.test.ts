import { afterEach, describe, expect, it, vi } from 'vitest'
import { toCloudWav } from './audio'

describe('voice audio preflight', () => {
  const close = vi.fn().mockResolvedValue(undefined)
  function audio(duration: number, samples: Float32Array) {
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = vi.fn().mockResolvedValue({ duration })
        close = close
      },
    )
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        destination = {}
        createBufferSource = () => ({
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(),
        })
        startRendering = vi
          .fn()
          .mockResolvedValue({ getChannelData: () => samples })
      },
    )
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })
  it('rejects audio shorter than one second before ASR', async () => {
    audio(0.25, new Float32Array(4000).fill(0.1))
    await expect(toCloudWav(new Blob(['audio']))).rejects.toThrow('不足1秒')
    expect(close).toHaveBeenCalled()
  })
  it('rejects silent recordings instead of asking a model to guess text', async () => {
    audio(2, new Float32Array(32000))
    await expect(toCloudWav(new Blob(['audio']))).rejects.toThrow('没有声音')
    expect(close).toHaveBeenCalled()
  })
  it('keeps audible samples and outputs valid PCM WAV without changing words', async () => {
    audio(2, new Float32Array(32000).fill(0.01))
    const result = await toCloudWav(new Blob(['audio']))
    expect(result.type).toBe('audio/wav')
    expect(result.size).toBe(64044)
    expect(close).toHaveBeenCalled()
  })
  it('provides Chinese feedback for a browser decoder failure', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = vi.fn().mockRejectedValue(new Error('EncodingError'))
        close = close
      },
    )
    await expect(toCloudWav(new Blob(['invalid']))).rejects.toThrow(
      '浏览器无法读取',
    )
    expect(close).toHaveBeenCalled()
  })
})
