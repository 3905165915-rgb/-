import { describe, expect, it } from 'vitest'
import {
  memoryGroup,
  parseElderMemories,
  parseMemoryHistory,
} from './elder-memories'
import {
  taskCreationSchema,
  checkTaskCreationReceipt,
  taskCreationInitial,
  taskCreationPayload,
  taskSourceIssue,
  updateTaskSource,
} from './task-create'
import { requestBody, schemas, type Row } from './model'
import { supportsReplay } from './recovery'
import { withTaskFeedback } from './task-feedback'
import { parseTaskContext } from './task-care-context'

const memory = (extra: Row = {}) => ({
  id: 'MEM-test',
  elder_id: 'ELDER-test',
  revision: 2,
  content: '虚构：喜欢京剧',
  category: 'stable_preference',
  scenes: ['activity'],
  attributed_to: 'elder',
  status: 'confirmed',
  source: {
    record_id: 'REC-test',
    revision: 1,
    field: 'raw_text',
    quote: '喜欢京剧',
    snapshot_text: '虚构：喜欢京剧',
    record_status: 'confirmed',
    captured_at: '2026-10-25T09:00:00+08:00',
  },
  valid_from: '2026-10-25T09:00:00+08:00',
  expires_at: null,
  review_due_at: null,
  confirmed_by: 'USER-test',
  confirmed_at: '2026-10-25T10:00:00+08:00',
  created_by: 'USER-test',
  created_at: '2026-10-25T09:00:00+08:00',
  updated_at: '2026-10-25T10:00:00+08:00',
  effective: true,
  source_current: true,
  review_due: false,
  blocked_reasons: [],
  ...extra,
})
const parse = (rows: unknown) => parseElderMemories(rows, 'ELDER-test')
describe('categorized memory evidence', () => {
  it('keeps a temporary refusal alongside a stable interest without overwriting it', () => {
    const rows = parse([
      memory(),
      memory({
        id: 'MEM-temp',
        content: '今天先休息',
        category: 'temporary_wish',
        expires_at: '2026-10-25T18:00:00+08:00',
      }),
    ])
    expect(rows.map(memoryGroup)).toEqual(['current', 'temporary'])
    expect(rows[0].content).toBe('虚构：喜欢京剧')
  })
  it.each([
    { elder_id: 'ELDER-other' },
    { revision: 0 },
    { category: 'medical_requirement' },
    { expires_at: 'bad' },
    { category: 'temporary_wish' },
    { source_current: false },
    { category: 'observation' },
    { status: 'suspended' },
    { confirmed_at: null },
    { scenes: ['activity', 'activity'] },
    { expires_at: '2026-10-25T08:00:00+08:00' },
  ])('rejects invalid or falsely effective memories: %j', (patch) => {
    expect(() => parse([memory(patch)])).toThrow()
  })
  it('rejects mismatched evidence, duplicate identifiers and malformed dates', () => {
    const row = memory()
    row.source.quote = '不存在的原话'
    expect(() => parse([row])).toThrow()
    expect(() => parse([memory(), memory()])).toThrow()
    expect(() => parse([memory({ valid_from: '昨天' })])).toThrow()
  })
  it('moves stale, pending, observational and suspended rows out of ordinary hints', () => {
    const rows = parse([
      memory({ review_due: true }),
      memory({
        id: 'MEM-two',
        category: 'observation',
        effective: false,
        confirmed_at: null,
        confirmed_by: null,
      }),
      memory({
        id: 'MEM-three',
        source_current: false,
        effective: false,
        review_state: 'pending',
      }),
      memory({ id: 'MEM-four', status: 'suspended', effective: false }),
    ])
    expect(rows.map(memoryGroup)).toEqual([
      'review',
      'review',
      'review',
      'history',
    ])
  })
  it('validates both sides of history against the selected memory and elder', () => {
    const current = parse([memory()])[0]
    const change = {
      previous_revision: 1,
      revision: 2,
      action: 'memory_confirm',
      reason: '已核对',
      created_by: 'USER-test',
      created_at: current.confirmed_at,
      before: memory({ revision: 1 }),
      after: memory(),
    }
    expect(parseMemoryHistory([change], current)).toHaveLength(1)
    expect(() =>
      parseMemoryHistory(
        [{ ...change, after: memory({ elder_id: 'ELDER-other' }) }],
        current,
      ),
    ).toThrow()
  })
})
describe('direct task creation and source safety', () => {
  const form = (): Row => ({
    ...taskCreationInitial(taskCreationSchema()),
    elder_id: 'ELDER-test',
    shift_id: 'SHIFT-test',
    title: '14点再次询问意愿',
    assigned_to: 'USER-test',
    due_at: '2099-10-25T14:00:00+08:00',
    completion_criteria: '询问本人并如实记录回答',
    condition: '本人清醒且愿意沟通',
  })
  const catalogs = {
    elders: [{ id: 'ELDER-test', current_admission_id: 'ADM-test' }],
    records: [
      {
        id: 'REC-test',
        elder_id: 'ELDER-test',
        admission_id: 'ADM-test',
        status: 'corrected',
        revision: 2,
      },
    ],
  }
  it('uses a direct task payload without synthesizing a source observation', () => {
    const payload = taskCreationPayload(taskCreationSchema(), form())
    expect(payload.condition).toBe('本人清醒且愿意沟通')
    expect(payload.completion_criteria).toBe('询问本人并如实记录回答')
    expect(payload.source_type).toBe('manual')
    expect(payload).not.toHaveProperty('raw_text')
    expect(payload).not.toHaveProperty('task_candidates')
    expect(supportsReplay('/tasks', 'post')).toBe(true)
    expect(supportsReplay('/records/manual', 'post')).toBe(true)
  })
  it.each([
    'elder_id',
    'shift_id',
    'assigned_to',
    'due_at',
    'title',
    'completion_criteria',
  ])('requires explicit %s', (field) => {
    expect(() =>
      taskCreationPayload(taskCreationSchema(), { ...form(), [field]: '' }),
    ).toThrow()
  })
  it('rejects past deadlines and incomplete or conflicting source fields', () => {
    expect(() =>
      taskCreationPayload(taskCreationSchema(), {
        ...form(),
        due_at: '2020-01-01T14:00:00+08:00',
      }),
    ).toThrow()
    expect(() =>
      taskCreationPayload(taskCreationSchema(), {
        ...form(),
        source_type: 'record',
      }),
    ).toThrow()
    expect(() =>
      taskCreationPayload(taskCreationSchema(), {
        ...form(),
        source_id: 'REC-test',
      }),
    ).toThrow()
  })
  it('checks source elder, current admission, status and revision', () => {
    const payload = {
      ...form(),
      source_type: 'record',
      source_id: 'REC-test',
      source_revision: 2,
    }
    expect(taskSourceIssue(payload, catalogs)).toBe('')
    for (const patch of [
      { elder_id: 'ELDER-other' },
      { source_revision: 1 },
      { source_id: 'REC-other' },
    ])
      expect(taskSourceIssue({ ...payload, ...patch }, catalogs)).not.toBe('')
    for (const patch of [{ status: 'revoked' }, { admission_id: 'ADM-old' }])
      expect(
        taskSourceIssue(payload, {
          ...catalogs,
          records: [{ ...catalogs.records[0], ...patch }],
        }),
      ).not.toBe('')
    const changed = updateTaskSource(
      { source_type: 'record', source_id: '' },
      payload,
      catalogs,
    )
    expect(changed.source_revision).toBe(2)
    expect(
      updateTaskSource(payload, { ...payload, source_type: 'manual' }, catalogs)
        .source_id,
    ).toBe('')
  })
})
describe('fact feedback on the existing result contract', () => {
  const value = {
    enabled: true,
    reaction: 'declined',
    facts: '14点已询问，本人说想继续休息。',
    followup: '晚班再次询问意愿',
  }
  it('allows refusal as the actual answer to an inquiry and does not claim effectiveness or a scheduled followup', () => {
    const body = withTaskFeedback({ _care_feedback: value })
    expect(body.result).toContain('明确拒绝')
    expect(body.result).toContain('尚不能判断')
    expect(body.result).toContain('尚未安排任务')
    const wire = requestBody(
      '/tasks/{task_id}/complete',
      schemas.TaskCompleteRequest,
      body,
    )
    expect(Object.keys(wire)).toEqual(['result'])
  })
  it('requires an explicit reaction and factual note, including when feedback is unavailable', () => {
    expect(() =>
      withTaskFeedback({ _care_feedback: { ...value, reaction: '' } }),
    ).toThrow()
    expect(() =>
      withTaskFeedback({ _care_feedback: { ...value, facts: '' } }),
    ).toThrow()
    expect(
      withTaskFeedback({
        _care_feedback: { ...value, reaction: 'not_obtained' },
      }).result,
    ).toContain('尚未获得反馈')
  })
  it('preserves the existing manual result path when the helper is off', () => {
    expect(withTaskFeedback({ result: '原有反馈' }).result).toBe('原有反馈')
  })
})

describe('task receipt and completion evidence', () => {
  const payload = { elder_id: 'ELDER-test', title: '再次询问', shift_id: 'SHIFT-test', assigned_to: 'USER-test', completion_criteria: '如实记录回答', due_at: '2099-10-25T06:00:00Z' }
  const receipt = { ...payload, id: 'TASK-test', revision: 1, status: 'pending', updated_at: '2026-10-25T06:00:00Z' }
  it('only acknowledges a matching server task, including owner, deadline and criteria', () => {
    expect(() => checkTaskCreationReceipt(receipt, payload)).not.toThrow()
    for (const change of [{ id: '' }, { revision: 0 }, { elder_id: 'ELDER-other' }, { assigned_to: 'USER-other' }, { completion_criteria: null }, { due_at: null }]) expect(() => checkTaskCreationReceipt({ ...receipt, ...change }, payload)).toThrow()
    expect(() => checkTaskCreationReceipt({}, payload)).toThrow()
  })
  it('shows the original source version and completion criteria without inventing legacy values', () => {
    const value = parseTaskContext({ ...receipt, source_record_id: 'REC-test', source_revision: 2 }, receipt.id)
    expect(value.completion_criteria).toBe(payload.completion_criteria)
    expect(value.source_revision).toBe(2)
    expect(parseTaskContext({ ...receipt, completion_criteria: undefined }, receipt.id).completion_criteria).toBeNull()
    expect(() => parseTaskContext({ ...receipt, source_revision: 0 }, receipt.id)).toThrow()
  })
})
