import { describe, expect, it } from 'vitest'
import {
  careContentTypeOf,
  contentTypeRecommendation,
  defaultRecordWhat,
  isTaskContent,
  metricContentType,
  validateCareLine,
  careArrangementBody,
  supportsCareType,
  validCareDay,
  validateCareGuidance,
  validateCareGuidanceList,
  validateCarePreview,
  validateCareArrangementReceipt,
  validateCareGuidanceUpdate,
  guidanceForScene,
  careGuidanceActions,
} from './care-arrangement'

describe('care arrangement content types', () => {
  it('does not turn an AI recommendation into an automatic selection', () => {
    expect(
      contentTypeRecommendation({ recommended_content_type: 'routine_hint' }),
    ).toBe('routine_hint')
    expect(
      contentTypeRecommendation({ recommended_content_type: 'invalid' }),
    ).toBeNull()
  })

  it('uses natural recording guidance for one-off activity reminders', () => {
    expect(
      defaultRecordWhat('one_off_reminder', '活动前询问是否参加'),
    ).toContain('愿意参加')
    expect(
      validateCareLine(
        {
          title: '活动前询问',
          occasion: 'before_activity',
          record_what: '记录实际回应',
        },
        'one_off_reminder',
      ),
    ).toEqual([])
    expect(
      validateCareLine(
        { title: '活动前询问', occasion: 'before_activity', record_what: '' },
        'one_off_reminder',
      ),
    ).toContain('请填写本次需要记录的内容。')
  })

  it('requires only the fields that belong to each content type', () => {
    expect(
      validateCareLine(
        {
          title: '放慢语速',
          scene: 'communication',
          instruction: '一次只说一件事',
        },
        'routine_hint',
      ),
    ).toEqual([])
    expect(
      validateCareLine(
        { title: '跟进', instruction: '联系家属' },
        'followup_task',
      ),
    ).toEqual([])
    expect(
      validateCareLine(
        { title: '提示', scene: 'communication', instruction: '' },
        'routine_hint',
      ),
    ).toContain('请填写照护提示。')
  })

  it('keeps old task rows compatible while excluding explicit hints and reminders from task metrics', () => {
    expect(careContentTypeOf({ id: 'old' })).toBe('followup_task')
    expect(isTaskContent({ content_type: 'followup_task' })).toBe(true)
    expect(isTaskContent({ content_type: 'routine_hint' })).toBe(false)
    expect(metricContentType({ content_type: 'one_off_reminder' })).toBe(
      'one_off_reminder',
    )
    expect(metricContentType({ content_type: 'future_type' })).toBe('unknown')
  })
})

const hint = {
  id: 'H-synthetic',
  elder_id: 'E-synthetic',
  title: '放慢语速',
  revision: 1,
  content_type: 'routine_hint',
  status: 'pending',
  scene: 'communication',
  instruction: '一次只说一件事',
}
const reminder = {
  id: 'R-synthetic',
  elder_id: hint.elder_id,
  title: '询问本次活动意愿',
  revision: 1,
  content_type: 'one_off_reminder',
  status: 'active',
  occasion: 'before_activity',
  service_date: '2026-10-28',
  record_what: '记录实际询问和回应',
}

describe('care guidance contract and separation', () => {
  it('requires explicit capability support and honors an explicit exclusion', () => {
    expect(supportsCareType(null, 'followup_task')).toBe(true)
    expect(supportsCareType({}, 'routine_hint')).toBe(false)
    expect(
      supportsCareType(
        { supported_content_types: ['routine_hint'] },
        'routine_hint',
      ),
    ).toBe(true)
    expect(
      supportsCareType({ supported_content_types: [] }, 'followup_task'),
    ).toBe(false)
    expect(
      supportsCareType(
        { supported_content_types: 'routine_hint' },
        'routine_hint',
      ),
    ).toBe(false)
  })
  it('rejects unknown explicit content types rather than treating them as legacy tasks', () => {
    for (const content_type of ['', null, 'unknown']) {
      expect(isTaskContent({ content_type })).toBe(false)
      expect(metricContentType({ content_type })).toBe('unknown')
    }
    expect(isTaskContent({})).toBe(true)
  })
  it('whitelists hint payloads and preserves applicability conditions without task scheduling', () => {
    const value = careArrangementBody(
      {
        title: ' 提示 ',
        goal: '目标',
        shift_id: 'SH',
        assigned_to: 'STAFF',
        starts_on: '2026-10-28',
        ends_on: '2026-10-30',
        service_date: '2026-10-28',
        items: [
          {
            ...hint,
            condition: ' 本人愿意沟通 ',
            times: ['10:00'],
            weekdays: [1],
            every_n_days: 1,
            window_minutes: 60,
            occasion: 'before_activity',
            record_what: '隐藏值',
          },
        ],
      },
      'routine_hint',
    )
    expect(value).toEqual({
      title: '提示',
      goal: '目标',
      content_type: 'routine_hint',
      items: [
        {
          title: hint.title,
          content_type: 'routine_hint',
          scene: hint.scene,
          instruction: hint.instruction,
          condition: '本人愿意沟通',
        },
      ],
    })
  })
  it('serializes one-off reminders as a service day and relative occasion only', () => {
    expect(
      careArrangementBody(
        {
          title: '提醒',
          service_date: reminder.service_date,
          shift_id: 'SH',
          assigned_to: 'P',
          items: [
            { ...reminder, instruction: '隐藏任务要求', times: ['10:00'] },
          ],
        },
        'one_off_reminder',
      ),
    ).toEqual({
      title: '提醒',
      goal: '',
      content_type: 'one_off_reminder',
      service_date: reminder.service_date,
      items: [
        {
          title: reminder.title,
          content_type: 'one_off_reminder',
          occasion: reminder.occasion,
          record_what: reminder.record_what,
        },
      ],
    })
    expect(() => careArrangementBody({ items: [] }, 'routine_hint')).toThrow()
    expect(() =>
      careArrangementBody(
        { items: [reminder], service_date: '2026-02-30' },
        'one_off_reminder',
      ),
    ).toThrow()
  })
  it('retains an explicit unassigned task plan instead of inventing an assignee', () => {
    const value = careArrangementBody(
      {
        title: '跟进',
        service_date: reminder.service_date,
        items: [
          {
            title: '联系工作人员',
            instruction: '记录联系结果',
            times: ['10:00'],
          },
        ],
      },
      'followup_task',
    )
    expect(value.assigned_to).toBeNull()
    expect(value.shift_id).toBeNull()
  })
  it('validates calendar days including leap years', () => {
    expect(validCareDay('2028-02-29')).toBe(true)
    for (const value of [
      '2026-02-29',
      '2026-02-30',
      '2026-13-01',
      '2026-1-01',
      '',
      null,
    ])
      expect(validCareDay(value)).toBe(false)
  })
  it('validates identity, version, scene and independent state enums', () => {
    expect(validateCareGuidance(hint, hint.elder_id)).toEqual(hint)
    expect(validateCareGuidance(reminder, hint.elder_id)).toEqual(reminder)
    for (const patch of [
      { elder_id: 'OTHER' },
      { revision: 0 },
      { revision: 1.5 },
      { id: '' },
      { title: '' },
      { status: 'completed' },
      { scene: 'constructor' },
      { instruction: '' },
      { content_type: 'followup_task' },
    ])
      expect(() =>
        validateCareGuidance({ ...hint, ...patch }, hint.elder_id),
      ).toThrow()
    for (const patch of [
      { service_date: '2026-02-30' },
      { status: 'enabled' },
      { occasion: 'unknown' },
      { record_what: '' },
    ])
      expect(() =>
        validateCareGuidance({ ...reminder, ...patch }, hint.elder_id),
      ).toThrow()
  })
  it('rejects duplicate guidance identifiers and cross-elder lists', () => {
    expect(
      validateCareGuidanceList(
        { elder_id: hint.elder_id, items: [hint, reminder] },
        hint.elder_id,
      ),
    ).toHaveLength(2)
    for (const value of [
      { elder_id: 'OTHER', items: [hint] },
      { elder_id: hint.elder_id, items: [hint, hint] },
      { elder_id: hint.elder_id, items: null },
    ])
      expect(() => validateCareGuidanceList(value, hint.elder_id)).toThrow()
  })
  it('requires non-task previews to acknowledge the type and elder explicitly', () => {
    const value = {
      context_token: 'synthetic',
      elder_id: hint.elder_id,
      content_type: 'routine_hint',
      items: [hint],
    }
    expect(validateCarePreview(value, hint.elder_id, 'routine_hint')).toEqual(
      value,
    )
    for (const patch of [
      { content_type: undefined },
      { elder_id: 'OTHER' },
      { items: [] },
      { items: [reminder] },
      { context_token: '' },
    ])
      expect(() =>
        validateCarePreview(
          { ...value, ...patch },
          hint.elder_id,
          'routine_hint',
        ),
      ).toThrow()
    expect(() =>
      validateCarePreview(
        { context_token: 'legacy', items: [], unassigned_items: [] },
        hint.elder_id,
        'followup_task',
      ),
    ).not.toThrow()
    expect(() =>
      validateCarePreview(
        { context_token: 'invalid', items: [hint] },
        hint.elder_id,
        'followup_task',
      ),
    ).toThrow()
  })
  it('never settles a hint save from a legacy task receipt or mixed task result', () => {
    const value = {
      plan: {
        id: 'PLAN',
        elder_id: hint.elder_id,
        content_type: 'routine_hint',
      },
      guidance: [hint],
      created_tasks: [],
    }
    expect(
      validateCareArrangementReceipt(value, hint.elder_id, 'routine_hint'),
    ).toEqual(value)
    for (const patch of [
      { created_tasks: [{ id: 'TASK' }] },
      { guidance: [] },
      { guidance: [reminder] },
      { plan: { elder_id: hint.elder_id } },
    ])
      expect(() =>
        validateCareArrangementReceipt(
          { ...value, ...patch },
          hint.elder_id,
          'routine_hint',
        ),
      ).toThrow()
    expect(() =>
      validateCareArrangementReceipt(
        {
          plan: { elder_id: hint.elder_id },
          created_tasks: [{ id: 'T', elder_id: 'OTHER' }],
        },
        hint.elder_id,
        'followup_task',
      ),
    ).toThrow()
  })
  it('shows hints only in matching scenes and handles existing scene aliases', () => {
    expect(guidanceForScene(hint, 'communication')).toBe(true)
    expect(guidanceForScene(hint, 'dining')).toBe(false)
    expect(
      guidanceForScene({ ...hint, scene: 'before_activity' }, 'activity'),
    ).toBe(true)
    expect(guidanceForScene({ ...hint, scene: 'bathing' }, 'bathing')).toBe(
      true,
    )
    expect(
      guidanceForScene({ ...reminder, occasion: 'during_meal' }, 'dining'),
    ).toBe(true)
    expect(guidanceForScene({ scene: 'unknown' }, 'another_unknown')).toBe(
      false,
    )
    expect(guidanceForScene(hint)).toBe(true)
  })
  it('allows staff to report adjustment while management confirms or stops hints', () => {
    expect(careGuidanceActions(hint, false)).toEqual([])
    expect(careGuidanceActions({ ...hint, status: 'enabled' }, false)).toEqual([
      'needs_adjustment',
    ])
    expect(careGuidanceActions(hint, true)).toEqual([
      'enabled',
      'needs_adjustment',
      'disabled',
    ])
    expect(careGuidanceActions(reminder, false)).toEqual([])
    expect(careGuidanceActions(reminder, true)).toEqual(['cancelled'])
    expect(
      careGuidanceActions({ ...reminder, status: 'recorded' }, true),
    ).toEqual([])
  })
  it('only accepts the exact guidance identity, newer version and intended state', () => {
    const result = { ...hint, revision: 2, status: 'enabled' }
    expect(
      validateCareGuidanceUpdate(result, hint.elder_id, hint.id, 1, 'enabled'),
    ).toEqual(result)
    for (const patch of [
      { id: 'OTHER' },
      { revision: 1 },
      { status: 'pending' },
    ])
      expect(() =>
        validateCareGuidanceUpdate(
          { ...result, ...patch },
          hint.elder_id,
          hint.id,
          1,
          'enabled',
        ),
      ).toThrow()
  })
  it('requires a formal record of this elder and excludes task creation from response recording', () => {
    const value = {
      guidance: { ...reminder, revision: 2, status: 'recorded' },
      record: { id: 'REC-synthetic', elder_id: hint.elder_id },
    }
    expect(
      validateCareGuidanceUpdate(
        value,
        hint.elder_id,
        reminder.id,
        1,
        'recorded',
        true,
      ),
    ).toEqual(value.guidance)
    for (const patch of [
      { record: { id: 'REC', elder_id: 'OTHER' } },
      { task: { id: 'T' } },
      { created_tasks: [{ id: 'T' }] },
      { guidance: { ...hint, revision: 2, status: 'enabled' } },
    ])
      expect(() =>
        validateCareGuidanceUpdate(
          { ...value, ...patch },
          hint.elder_id,
          reminder.id,
          1,
          'recorded',
          true,
        ),
      ).toThrow()
  })
})
