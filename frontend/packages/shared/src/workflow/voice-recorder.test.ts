import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceRecorder } from './voice-recorder'

class FakeRecorder {
  static instances: FakeRecorder[] = []
  static isTypeSupported = (type: string) => type === 'audio/mp4'
  state = 'inactive'
  mimeType = 'audio/mp4'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(
    public stream: unknown,
    public options?: { mimeType?: string },
  ) {
    FakeRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['encoded audio']) })
    void this.onstop?.()
  }
}

describe('mobile microphone capture', () => {
  const controllers: ReturnType<typeof useVoiceRecorder>[] = []
  const tracks: {
    stop: ReturnType<typeof vi.fn>
    onended: (() => void) | null
  }[] = []
  const getUserMedia = vi.fn()
  function make() {
    const onAudio = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    const recorder = useVoiceRecorder({ onAudio, onError })
    controllers.push(recorder)
    return { ...recorder, onAudio, onError }
  }
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'performance',
      ],
    })
    FakeRecorder.instances = []
    getUserMedia.mockReset().mockImplementation(async () => {
      const track = { stop: vi.fn(), onended: null }
      tracks.push(track)
      return { getTracks: () => [track] }
    })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', FakeRecorder)
  })
  afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.cancel())
    tracks.length = 0
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('keeps recording until explicit stop, counts seconds and uses the supported MIME', async () => {
    const r = make()
    await r.toggle()
    await vi.advanceTimersByTimeAsync(2250)
    expect(r.recording.value).toBe(true)
    expect(r.seconds.value).toBe(2)
    expect(r.onAudio).not.toHaveBeenCalled()
    expect(FakeRecorder.instances[0].options?.mimeType).toBe('audio/mp4')
    await r.toggle()
    expect(r.onAudio).toHaveBeenCalledTimes(1)
    expect(r.onAudio.mock.calls[0][0].type).toBe('audio/mp4')
    expect(r.recording.value).toBe(false)
    expect(tracks[0].stop).toHaveBeenCalled()
  })
  it('blocks repeated taps while microphone permission is pending', async () => {
    let grant!: (value: unknown) => void
    const stop = vi.fn()
    getUserMedia.mockReturnValue(
      new Promise((resolve) => {
        grant = resolve
      }),
    )
    const r = make()
    const pending = r.toggle()
    await r.toggle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    r.cancel()
    grant({ getTracks: () => [{ stop }] })
    await pending
    expect(stop).toHaveBeenCalled()
    expect(r.recording.value).toBe(false)
    expect(FakeRecorder.instances).toHaveLength(0)
  })
  it('never sends short accidental recordings to recognition', async () => {
    const r = make()
    await r.toggle()
    await vi.advanceTimersByTimeAsync(200)
    await r.toggle()
    expect(r.onAudio).not.toHaveBeenCalled()
    expect(r.onError).toHaveBeenCalledWith(expect.stringContaining('太短'))
    expect(r.locked.value).toBe(false)
  })
  it('rejects browser interruption even after several seconds of capture', async () => {
    const r = make()
    await r.toggle()
    await vi.advanceTimersByTimeAsync(3000)
    FakeRecorder.instances[0].stop()
    expect(r.onAudio).not.toHaveBeenCalled()
    expect(r.onError).toHaveBeenCalledWith(expect.stringContaining('提前结束'))
    expect(r.recording.value).toBe(false)
  })
  it('stops and transcribes exactly once at the 60-second limit', async () => {
    const r = make()
    await r.toggle()
    await vi.advanceTimersByTimeAsync(60000)
    expect(r.onAudio).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(r.onAudio).toHaveBeenCalledTimes(1)
  })
  it('does not submit recordings after leaving or changing elders', async () => {
    const r = make()
    await r.toggle()
    const track = tracks[0]
    await vi.advanceTimersByTimeAsync(2000)
    r.cancel()
    await vi.advanceTimersByTimeAsync(60000)
    expect(r.onAudio).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    expect(r.recording.value).toBe(false)
  })
  it('holds the stop action locked while the transcription callback is running', async () => {
    const r = make()
    let finish!: () => void
    r.onAudio.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    await r.toggle()
    await vi.advanceTimersByTimeAsync(2000)
    await r.toggle()
    expect(r.locked.value).toBe(true)
    await r.toggle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    expect(r.locked.value).toBe(false)
  })
  it('releases the microphone and shows Chinese feedback after a capture error', async () => {
    const r = make()
    await r.toggle()
    FakeRecorder.instances[0].onerror?.()
    expect(r.onAudio).not.toHaveBeenCalled()
    expect(r.onError).toHaveBeenCalledWith(expect.stringContaining('中断'))
    expect(tracks[0].stop).toHaveBeenCalled()
  })
})
