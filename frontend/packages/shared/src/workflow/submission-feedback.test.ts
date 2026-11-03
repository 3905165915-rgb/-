import { describe, expect, it } from 'vitest'
import { submissionFeedback } from './submission-feedback'

describe('operation progress', () => {
  it('distinguishes model drafts from formal persistence', () => {
    expect(submissionFeedback('/records/context-extract', 'post').assisted).toBe(true)
    expect(submissionFeedback('/records/context-extract', 'post').success).toContain('尚未保存')
    for (const path of ['/records/manual', '/records/AI-1/confirm', '/memories']) {
      const feedback = submissionFeedback(path, 'post')
      expect(feedback.assisted).toBe(false)
      expect(feedback.button).toBe('正在保存…')
    }
    expect(submissionFeedback('/records', 'get').button).toBe('正在读取…')
  })
  it('uses review wording appropriate to quality checks and handover drafts', () => {
    const quality = submissionFeedback('/quality/checks', 'post')
    expect(quality.button).toBe('正在检查…')
    expect(quality.success).toContain('主管核对')
    expect(quality.success).not.toContain('正式记录尚未保存')
    expect(submissionFeedback('/handovers/HO-1/ai-summary', 'post').success).toContain('交班草稿')
    expect(submissionFeedback('/quality/checks', 'get').assisted).toBe(false)
  })
})
