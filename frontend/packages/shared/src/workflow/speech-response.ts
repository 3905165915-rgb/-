export class SpeechError extends Error {}

const messages: Record<string, string> = {
  speech_rate_limited_retry_later:
    '语音提交较频繁，请稍后再试；已输入的文字会保留。',
  speech_provider_rate_limited: '云端语音识别暂时繁忙，请稍后再试。',
  speech_not_configured_use_manual_entry: '语音服务尚未配置，请继续文字输入。',
  speech_provider_credentials_or_access_invalid:
    '语音服务账号或模型权限异常，请联系管理员。',
  speech_no_text_detected_retry_or_type:
    '未识别到有效内容，请靠近麦克风说话后重试。',
  speech_provider_timeout_use_manual_entry:
    '语音识别超时，请稍后重试或继续文字输入。',
  speech_provider_rejected_audio:
    '云端未能读取录音，请重新录制或导入语音文件。',
  speech_requires_16khz_mono_pcm16_wav:
    '录音格式不支持，请重新录制或选择有效的语音文件。',
  speech_audio_invalid_wav: '无法读取录音，请重新录制。',
  speech_audio_empty: '录音为空，请说话后再停止录音。',
  speech_audio_longer_than_60_seconds: '录音超过60秒，请缩短后重试。',
}

export async function readSpeechResponse(
  response: Response,
): Promise<{ text: string }> {
  // Nginx/CDN errors can be HTML. Never expose their body or a JSON parser error.
  if (response.status === 401)
    throw new SpeechError('登录已过期，请重新进入工作入口。')
  if (response.status === 403)
    throw new SpeechError('当前账号不能使用语音识别，请切换工作人员入口。')
  if (response.status === 429)
    throw new SpeechError(messages.speech_rate_limited_retry_later)
  if (response.status === 413)
    throw new SpeechError('录音文件过大，请缩短录音后重试。')
  if (response.status === 408 || response.status === 504)
    throw new SpeechError(messages.speech_provider_timeout_use_manual_entry)
  let body: unknown
  try {
    body = JSON.parse(await response.text())
  } catch {
    throw new SpeechError('语音服务返回异常页面，请稍后重试或继续文字输入。')
  }
  const value =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!response.ok) {
    const code = typeof value?.detail === 'string' ? value.detail : ''
    throw new SpeechError(
      messages[code] || '语音服务暂时不可用，请稍后重试或继续文字输入。',
    )
  }
  if (
    typeof value?.text !== 'string' ||
    !value.text.trim() ||
    value.text.length > 10000
  )
    throw new SpeechError('未收到有效转写文字，请重新录音或继续文字输入。')
  return { text: value.text.trim() }
}

export function speechErrorMessage(error: unknown): string {
  if (error instanceof SpeechError) return error.message
  if (error instanceof Error && error.name === 'AbortError')
    return '语音处理已超时或取消，已有文字保留，可稍后重试。'
  return '语音处理未完成，请检查网络和录音，或继续文字输入。'
}
