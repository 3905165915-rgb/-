import { computed, ref } from 'vue'

/** Explicit start/stop; an interrupted mobile capture must never trigger ASR. */
export function useVoiceRecorder(options: {
  onAudio: (audio: Blob) => Promise<void>
  onError: (message: string) => void
}) {
  const recording = ref(false)
  const starting = ref(false)
  const finishing = ref(false)
  const seconds = ref(0)
  const locked = computed(() => starting.value || finishing.value)
  let epoch = 0
  let recorder: MediaRecorder | undefined
  let stream: MediaStream | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let clock: ReturnType<typeof setInterval> | undefined

  function release() {
    clearTimeout(deadline)
    clearInterval(clock)
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    stream = undefined
    recorder = undefined
    starting.value = false
    recording.value = false
  }
  function cancel() {
    epoch++
    release()
    finishing.value = false
    seconds.value = 0
  }
  async function toggle() {
    if (locked.value) return
    if (recording.value) {
      stopRequested?.()
      return
    }
    const ticket = ++epoch
    starting.value = true
    seconds.value = 0
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      )
        throw new Error('unsupported')
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      if (ticket !== epoch) {
        captured.getTracks().forEach((track) => track.stop())
        return
      }
      stream = captured
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
      ].find((type) => MediaRecorder.isTypeSupported?.(type))
      const current = new MediaRecorder(
        captured,
        mimeType ? { mimeType } : undefined,
      )
      recorder = current
      const chunks: Blob[] = []
      let requested = false
      const startedAt = performance.now()
      stopRequested = () => {
        if (ticket !== epoch || current.state !== 'recording') return
        requested = true
        recording.value = false
        finishing.value = true
        clearInterval(clock)
        clearTimeout(deadline)
        current.stop()
      }
      current.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      current.onerror = () => {
        if (ticket !== epoch) return
        cancel()
        options.onError(
          '录音被浏览器中断，请保持页面在前台后重试，也可导入语音文件。',
        )
      }
      current.onstop = async () => {
        if (ticket !== epoch) return
        const duration = performance.now() - startedAt
        const audio = new Blob(chunks, {
          type: current.mimeType || chunks[0]?.type || 'audio/webm',
        })
        release()
        finishing.value = true
        try {
          if (!requested) {
            options.onError(
              '录音被浏览器提前结束，本次未识别。请保持页面在前台后重试。',
            )
          } else if (duration < 1000 || !audio.size) {
            options.onError(
              '录音太短或没有录到声音，请说完后再点击“停止录音”。',
            )
          } else {
            await options.onAudio(audio)
          }
        } catch {
          if (ticket === epoch)
            options.onError('语音处理未完成，已有文字保留，请稍后重试。')
        } finally {
          if (ticket === epoch) finishing.value = false
        }
      }
      captured.getTracks().forEach((track) => {
        track.onended = () => {
          if (ticket === epoch && current.state === 'recording') current.stop()
        }
      })
      current.start(250)
      recording.value = true
      starting.value = false
      clock = setInterval(() => {
        seconds.value = Math.floor((performance.now() - startedAt) / 1000)
      }, 250)
      deadline = setTimeout(() => stopRequested?.(), 60000)
    } catch {
      if (ticket !== epoch) return
      cancel()
      options.onError(
        '无法开始录音，请允许浏览器使用麦克风；也可导入语音文件或手工输入。',
      )
    }
  }
  let stopRequested: (() => void) | undefined
  return { recording, starting, finishing, seconds, locked, toggle, cancel }
}
