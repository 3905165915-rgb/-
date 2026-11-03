import { describe, expect, it } from 'vitest'
import { compactReference } from './references'

describe('compactReference', () => {
  it('keeps short demo labels unchanged', () => {
    expect(compactReference('task-01')).toBe('task-01')
  })

  it('keeps a stable short prefix for long internal IDs', () => {
    expect(compactReference('TASK-1234567890abcdef')).toBe('TASK-1234')
  })
})
