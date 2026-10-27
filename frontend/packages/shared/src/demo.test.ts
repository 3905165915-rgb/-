import { describe, expect, it } from 'vitest'
import { createInitialDemoState, DEMO_BATCH_ID } from './demo'

describe('王爷爷演示批次', () => {
  it('只建立一位老人并覆盖可演示的照护链路', () => {
    const state = createInitialDemoState()
    expect(state.batchId).toBe(DEMO_BATCH_ID)
    expect(state.elders).toHaveLength(1)
    expect(state.elders[0]).toMatchObject({
      id: 'elder-wang-101',
      name: '王爷爷',
      bedLabel: '101房·1床',
    })
    expect(state.records).toHaveLength(40)
    expect(new Set(state.records.map((row) => row.category))).toEqual(
      new Set(['本人表达', '护理观察', '家属补充']),
    )
    expect(state.tasks.some((task) => task.status === 'pending')).toBe(true)
    expect(state.tasks.some((task) => task.status === 'completed')).toBe(true)
    expect(state.tasks.some((task) => task.status === 'in_progress')).toBe(true)
    expect(state.handover).toHaveLength(1)
    expect(state.familyCases.every((item) => item.public)).toBe(true)
  })

  it('把临时意愿与稳定偏好分开表达', () => {
    const state = createInitialDemoState()
    const elder = state.elders[0]
    expect(elder.preferences?.activities).toContain('喜欢听京剧，偏好较低音量。')
    expect(elder.preferences?.recentChanges).toContain(
      '今天想休息是本次临时意愿，不作为长期安排。',
    )
    expect(state.drafts[0].warnings[0]).toContain('临时意愿')
  })
})
