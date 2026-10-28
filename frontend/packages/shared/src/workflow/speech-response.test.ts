import { describe, expect, it } from 'vitest'
import {
  readSpeechResponse,
  speechErrorMessage,
  SpeechError,
} from './speech-response'

describe('speech HTTP responses from API and gateway', () => {
  it('accepts only a nonempty string transcription', async () => {
    await expect(
      readSpeechResponse(Response.json({ text: ' 王爷爷没有外出。 ' })),
    ).resolves.toEqual({ text: '王爷爷没有外出。' })
    for (const body of [{}, { text: '' }, { text: 42 }, null])
      await expect(readSpeechResponse(Response.json(body))).rejects.toThrow(
        '有效转写',
      )
  })
  it.each([401, 403, 413, 429, 502, 504])(
    'handles HTML status %i without leaking parser errors or the HTML body',
    async (status) => {
      const result = readSpeechResponse(
        new Response('<html>private gateway content</html>', { status }),
      )
      await expect(result).rejects.toBeInstanceOf(SpeechError)
      await expect(result).rejects.not.toThrow(/private|JSON|Unexpected|<html>/)
    },
  )
  it('identifies a gateway rate limit before trying to parse HTML', async () => {
    await expect(
      readSpeechResponse(new Response('<html>429</html>', { status: 429 })),
    ).rejects.toThrow('频繁')
  })
  it('rejects SPA fallback HTML even with HTTP 200', async () => {
    await expect(
      readSpeechResponse(new Response('<html>app</html>')),
    ).rejects.toThrow('异常页面')
  })
  it('translates known cloud errors and hides unknown provider messages', async () => {
    await expect(
      readSpeechResponse(
        Response.json(
          { detail: 'speech_provider_credentials_or_access_invalid' },
          { status: 503 },
        ),
      ),
    ).rejects.toThrow('权限异常')
    await expect(
      readSpeechResponse(
        Response.json({ detail: 'private upstream error' }, { status: 503 }),
      ),
    ).rejects.not.toThrow('private')
    expect(speechErrorMessage(new Error('Failed to fetch'))).not.toContain(
      'fetch',
    )
    expect(
      speechErrorMessage(new DOMException('abort', 'AbortError')),
    ).toContain('超时或取消')
  })
})
