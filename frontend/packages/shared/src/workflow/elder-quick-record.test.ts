import { describe, expect, it } from 'vitest'
import {
  buildRecordAnalysisConfirmation,
  validateInlineRecordResponse,
} from './elder-quick-record'

const record = {
  id: 'REC-test',
  elder_id: 'ELDER-test',
  status: 'confirmed',
  revision: 2,
  raw_text: '老人表示每天午休后愿意听戏，今天请小王下午询问。',
  created_at: '2026-10-27T01:00:00Z',
  happened_at: '2026-10-26T08:00:00Z',
  admission_id: 'ADM-test',
}

const analysis = {
  id: 'AN-test',
  record_id: record.id,
  record_revision: record.revision,
  status: 'ready',
  scene: {
    value: 'activity',
    citation: { source_field: 'raw_text', quote: '午休后愿意听戏' },
  },
  observations: [
    {
      id: 'OBS-1',
      text: '老人表达了听戏意愿。',
      citation: { source_field: 'raw_text', quote: '愿意听戏' },
    },
  ],
  task_suggestions: [
    {
      id: 'TASK-1',
      title: '询问是否愿意听戏',
      evidence_text: '今天请小王下午询问',
      condition: null,
      due_text: '下午',
    },
  ],
  preference_suggestions: [
    {
      id: 'PREF-1',
      content: '老人表示每天午休后愿意听戏。',
      frequency: 'explicit',
      attributed_to: 'elder',
      evidence_text: '每天午休后愿意听戏',
    },
  ],
  provider: 'synthetic',
  created_at: '2026-10-27T01:00:00Z',
}

describe('inline elder record workflow', () => {
  it('shows safe analysis failure details while accepting the older saved-record envelope', () => {
    const failed = { record, analysis_status: 'failed', analysis: null }
    expect(
      validateInlineRecordResponse(failed, 'ELDER-test').analysisError,
    ).toBeUndefined()
    const analysis_error = {
      code: 'analysis_timeout',
      message: '分析等待超时，原记录已保存，可重试此记录。',
    }
    expect(
      validateInlineRecordResponse({ ...failed, analysis_error }, 'ELDER-test')
        .analysisError,
    ).toEqual(analysis_error)
    expect(() =>
      validateInlineRecordResponse(
        { ...failed, analysis_error: { code: 3 } },
        'ELDER-test',
      ),
    ).toThrow()
  })
  it('accepts the actual datetime-local input as Beijing time and rejects invalid deadlines', () => {
    const input = {
      expectedRevision: 1,
      preferenceSuggestionIds: [],
      preferences: [],
      tasks: [
        {
          suggestionId: 'S1',
          accepted: true,
          title: '询问本次意愿',
          shiftId: 'SHIFT1',
          assignedTo: 'STAFF1',
          dueAt: '2099-10-28T14:00',
          completionCriteria: '记录本人回应',
        },
      ],
    }
    const result = buildRecordAnalysisConfirmation(input)
    expect(result.accepted_tasks).toMatchObject([
      { due_at: '2099-10-28T06:00:00.000Z' },
    ])
    expect(() =>
      buildRecordAnalysisConfirmation({
        ...input,
        tasks: [{ ...input.tasks[0], dueAt: '明天' }],
      }),
    ).toThrow()
  })
  it('keeps the formal record when inline analysis failed so the UI can retry that ID', () => {
    const result = validateInlineRecordResponse(
      { record, analysis_status: 'failed', analysis: null },
      'ELDER-test',
    )

    expect(result.record.id).toBe(record.id)
    expect(result.analysisStatus).toBe('failed')
    expect(result.analysis).toBeNull()
  })

  it('validates ready analysis identity and verbatim evidence for all displayed sections', () => {
    const result = validateInlineRecordResponse(
      { record, analysis_status: 'ready', analysis },
      'ELDER-test',
    )

    expect(result.analysis?.scene.value).toBe('activity')
    expect(result.analysis?.observations[0].citation.quote).toBe('愿意听戏')
    expect(result.analysis?.taskSuggestions[0].id).toBe('TASK-1')
    expect(result.analysis?.preferenceSuggestions[0].frequency).toBe('explicit')
  })

  it('rejects mismatched saved records, stale analyses, and fabricated source quotes', () => {
    expect(() =>
      validateInlineRecordResponse(
        {
          record: { ...record, elder_id: 'ELDER-other' },
          analysis_status: 'failed',
          analysis: null,
        },
        'ELDER-test',
      ),
    ).toThrow()
    expect(() =>
      validateInlineRecordResponse(
        {
          record,
          analysis_status: 'ready',
          analysis: { ...analysis, record_revision: 1 },
        },
        'ELDER-test',
      ),
    ).toThrow()
    expect(() =>
      validateInlineRecordResponse(
        {
          record,
          analysis_status: 'ready',
          analysis: {
            ...analysis,
            observations: [
              {
                ...analysis.observations[0],
                citation: { source_field: 'raw_text', quote: '模型编造的原文' },
              },
            ],
          },
        },
        'ELDER-test',
      ),
    ).toThrow()
  })

  it('requires an explicit decision for every preference and complete task fields before confirming once', () => {
    const inputs = {
      expectedRevision: 2,
      preferenceSuggestionIds: ['PREF-1'],
      preferences: [
        {
          suggestionId: 'PREF-1',
          decision: 'adopt' as const,
          content: '每天午休后听戏',
        },
      ],
      tasks: [
        {
          suggestionId: 'TASK-1',
          accepted: true,
          title: '询问是否愿意听戏',
          shiftId: 'SHIFT-1',
          assignedTo: 'STAFF-1',
          dueAt: '2026-10-28T06:00:00Z',
          completionCriteria: '询问并记录本人当次回应',
        },
      ],
    }

    expect(() =>
      buildRecordAnalysisConfirmation({ ...inputs, preferences: [] }),
    ).toThrow()
    expect(() =>
      buildRecordAnalysisConfirmation({
        ...inputs,
        preferenceSuggestionIds: [],
        preferences: inputs.preferences,
      }),
    ).toThrow()
    expect(() =>
      buildRecordAnalysisConfirmation({
        ...inputs,
        tasks: [{ ...inputs.tasks[0], assignedTo: '' }],
      }),
    ).toThrow()
    expect(buildRecordAnalysisConfirmation(inputs)).toEqual({
      expected_revision: 2,
      preference_decisions: [
        {
          suggestion_id: 'PREF-1',
          decision: 'adopt',
          content: '每天午休后听戏',
        },
      ],
      accepted_tasks: [
        {
          suggestion_id: 'TASK-1',
          title: '询问是否愿意听戏',
          shift_id: 'SHIFT-1',
          assigned_to: 'STAFF-1',
          due_at: '2026-10-28T06:00:00.000Z',
          completion_criteria: '询问并记录本人当次回应',
        },
      ],
    })
  })
})
