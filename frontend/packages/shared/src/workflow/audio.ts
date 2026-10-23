export function pcmWav(samples: Float32Array, sampleRate = 16000): Blob {
  if (!samples.length || samples.length > sampleRate * 60)
    throw new Error('录音必须在1至60秒内')
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  function word(position: number, value: string) {
    for (let i = 0; i < value.length; i++)
      view.setUint8(position + i, value.charCodeAt(i))
  }
  word(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  word(8, 'WAVE')
  word(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  word(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
export async function toCloudWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext()
  try {
    const input = await context.decodeAudioData(await blob.arrayBuffer())
    if (input.duration > 60.2) throw new Error('录音最多60秒，请缩短后重试')
    const targetLength = Math.min(960000, Math.ceil(input.duration * 16000))
    if (!targetLength) throw new Error('录音为空，请重试')
    const offline = new OfflineAudioContext(1, targetLength, 16000)
    const source = offline.createBufferSource()
    source.buffer = input
    source.connect(offline.destination)
    source.start()
    return pcmWav((await offline.startRendering()).getChannelData(0))
  } finally {
    await context.close()
  }
}
