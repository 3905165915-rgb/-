import { describe, expect, it } from 'vitest'
import { createInitialDemoState } from './demo'
import { nextDemoIdentifier } from './demo-actions'
import type { DemoStateV2 } from './demo-store'

function state(): DemoStateV2 {
  const seed = createInitialDemoState()
  return {
    ...seed,
    schemaVersion: 2,
    epoch: 'demo-epoch',
    revision: 0,
    tasks: seed.tasks.map((task) => ({ ...task, itemId: 'item-01' })),
    timeline: seed.timeline.map((event) => ({ ...event, itemId: 'item-01', source: 'demo' as const })),
    handover: [],
    handoverVersions: [],
    confirmedDrafts: {},
    appliedOperations: [],
  }
}

describe('demo identifiers', () => {
  it('allocates short readable identifiers without colliding with the snapshot', () => {
    const current = state()
    expect(nextDemoIdentifier(current, 'record')).toBe('record-01')
    expect(nextDemoIdentifier(current, 'event')).toBe('event-01')

    current.confirmedDrafts['draft-01'] = {
      record_id: 'record-01',
      task_ids: ['task-01'],
    }
    expect(nextDemoIdentifier(current, 'record')).toBe('record-02')
    expect(nextDemoIdentifier(current, 'task')).toBe('task-02')
  })
})
