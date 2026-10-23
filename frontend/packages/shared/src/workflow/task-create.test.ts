import { describe, expect, it } from 'vitest'
import { manualFallback, taskCreationInitial, taskCreationPayload, taskCreationSchema } from './task-create'

describe('human-authored task creation', () => {
  const value = () => ({ ...taskCreationInitial(taskCreationSchema()), elder_id: 'ELDER-test', raw_text: '虚构：本人希望下午再沟通',
    completion_criteria: '完成沟通并记录本人反馈', title: '回访沟通', assigned_to: 'USER-test', due_at: '2026-10-24T14:00:00+08:00' })
  it('uses one reviewed task and preserves criteria in the supported source record', () => {
    const payload = taskCreationPayload(taskCreationSchema(), value())
    expect(payload.raw_text).toContain('【完成标准】完成沟通并记录本人反馈')
    expect(payload).not.toHaveProperty('completion_criteria')
    expect(payload.task_candidates).toEqual([{ title: '回访沟通', assigned_to: 'USER-test', due_at: '2026-10-24T06:00:00.000Z' }])
  })
  it('requires explicit owner, due date and completion criteria without inventing them', () => {
    for (const key of ['assigned_to', 'due_at']) {
      const form = value(); (form as Record<string, unknown>)[key] = ''
      expect(() => taskCreationPayload(taskCreationSchema(), form)).toThrow()
    }
    expect(() => taskCreationPayload(taskCreationSchema(), { ...value(), completion_criteria: '' })).toThrow()
    expect(() => taskCreationPayload(taskCreationSchema(), { ...value(), title: '' })).toThrow()
  })
  it('checks the final server text limit and does not mutate shared schemas', () => {
    expect(() => taskCreationPayload(taskCreationSchema(), { ...value(), raw_text: '测'.repeat(5000) })).toThrow()
    expect(taskCreationInitial(taskCreationSchema()).title).toBe('')
  })
  it('manual fallback retains original and context without converting AI guesses to facts', () => {
    expect(manualFallback({ elder_id: 'ELDER-test', shift_id: 'SHIFT-test', text: '明天再看看', task_candidates: [{ assigned_to: 'guess' }] }))
      .toEqual({ elder_id: 'ELDER-test', shift_id: 'SHIFT-test', raw_text: '明天再看看', happened_at: '', observations: [], task_candidates: [] })
  })
})
