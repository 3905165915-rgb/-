import { describe, expect, it } from 'vitest'
import {
  createInitialDemoState,
  taskStatuses,
  aiDraftStatuses,
  familyCaseStatuses,
} from '@hulao/shared'
import { ContractError } from './errors'
import {
  parseElder,
  parseFamilyCase,
  parseHandoverItem,
  parseList,
  parseLoginResponse,
  parseRecordDraft,
  parseTask,
  parseTimelineEvent,
  type Parser,
} from './validators'

const seed = createInitialDemoState()
const resources: {
  name: string
  parse: Parser<{ id: string }>
  value: Record<string, unknown>
  required: string[]
}[] = [
  {
    name: 'elders',
    parse: parseElder,
    value: { ...seed.elders[0] },
    required: ['id', 'name', 'bedLabel', 'status'],
  },
  {
    name: 'tasks',
    parse: parseTask,
    value: { ...seed.tasks[0] },
    required: [
      'id',
      'elderId',
      'title',
      'shift',
      'assignee',
      'status',
      'dueAt',
    ],
  },
  {
    name: 'handover',
    parse: parseHandoverItem,
    value: { ...seed.handover[0] },
    required: ['id', 'title', 'detail', 'status', 'owner'],
  },
  {
    name: 'family',
    parse: parseFamilyCase,
    value: { ...seed.familyCases[0] },
    required: ['id', 'elderId', 'subject', 'status', 'public'],
  },
  {
    name: 'timeline',
    parse: parseTimelineEvent,
    value: { ...seed.timeline[0] },
    required: ['id', 'label', 'detail', 'actor', 'happenedAt', 'enteredAt'],
  },
  {
    name: 'AI',
    parse: parseRecordDraft,
    value: { ...seed.drafts[0] },
    required: [
      'id',
      'elderId',
      'originalText',
      'fields',
      'evidence',
      'warnings',
      'status',
    ],
  },
]
const endpoint = 'GET /test'

describe.each(resources)(
  '$name runtime contract',
  ({ parse, value, required }) => {
    it('accepts current demo fields without modifying the response', () => {
      expect(parse(value, endpoint)).toBe(value)
    })
    it('rejects missing and null required fields at their actual path', () => {
      for (const field of required) {
        const missing = { ...value }
        delete missing[field]
        for (const invalid of [missing, { ...value, [field]: null }]) {
          try {
            parse(invalid, endpoint)
            expect.unreachable(`accepted invalid ${field}`)
          } catch (error) {
            expect(error).toBeInstanceOf(ContractError)
            expect(error).toMatchObject({ endpoint, fieldPath: `$.${field}` })
          }
        }
      }
    })
    it('rejects nonobjects, wrong field types, and blank identifiers', () => {
      for (const input of [null, [], false, 'record', 3])
        expect(() => parse(input, endpoint)).toThrow(ContractError)
      for (const field of required)
        expect(() => parse({ ...value, [field]: {} }, endpoint)).toThrow(
          ContractError,
        )
      expect(() => parse({ ...value, id: ' ' }, endpoint)).toThrow(
        ContractError,
      )
    })
    it('rejects envelopes and duplicate IDs instead of returning a partial list', () => {
      for (const input of [
        null,
        {},
        { items: [value] },
        [value, null],
        [value, { ...value }],
      ]) {
        expect(() => parseList(input, endpoint, parse)).toThrow(ContractError)
      }
      const rows = [value, { ...value, id: 'other' }]
      expect(parseList(rows, endpoint, parse)).toEqual(rows)
      expect(parseList([], endpoint, parse)).toEqual([])
    })
  },
)

describe('Elder optional display fields', () => {
  const minimal = {
    id: 'e-live',
    name: '测试老人',
    bedLabel: '101床',
    status: '入住',
  }

  it('accepts the minimal safe-render live e2e fixture without fabricating fields', () => {
    expect(parseElder(minimal, 'GET /elders')).toBe(minimal)
    expect(parseList([minimal], 'GET /elders', parseElder)).toEqual([minimal])
    for (const field of ['age', 'risk', 'contact', 'notes', 'lastUpdate'])
      expect(Object.hasOwn(minimal, field)).toBe(false)
  })

  it.each([
    {
      field: 'age',
      valid: [0, 78],
      invalid: [null, '78', -1, 1.5, NaN, Infinity, {}, []],
    },
    {
      field: 'risk',
      valid: ['低', '中', '高'],
      invalid: [null, '', 'unknown', 1, {}, []],
    },
    {
      field: 'contact',
      valid: ['', '家属联系方式'],
      invalid: [null, 1, {}, []],
    },
    { field: 'notes', valid: ['', '护理备注'], invalid: [null, 1, {}, []] },
    {
      field: 'lastUpdate',
      valid: ['', '今天 12:30', '2026-10-20', '2026-10-20T12:30:00+08:00'],
      invalid: [null, 1, {}, [], 'unknown', '2026-02-30', '今天 24:00'],
    },
  ])(
    'allows omitted $field and validates every supplied value',
    ({ field, valid, invalid }) => {
      const omitted: Record<string, unknown> = { ...seed.elders[0] }
      delete omitted[field]
      expect(parseElder(omitted, 'GET /elders')).toBe(omitted)
      const undefinedField = { ...minimal, [field]: undefined }
      expect(parseElder(undefinedField, 'GET /elders')).toBe(undefinedField)
      for (const value of valid) {
        const supplied = { ...minimal, [field]: value }
        expect(parseElder(supplied, 'GET /elders')).toBe(supplied)
      }
      for (const value of invalid) {
        try {
          parseElder({ ...minimal, [field]: value }, 'GET /elders')
          expect.unreachable(`accepted invalid ${field}`)
        } catch (error) {
          expect(error).toBeInstanceOf(ContractError)
          expect(error).toMatchObject({
            endpoint: 'GET /elders',
            fieldPath: `$.${field}`,
          })
        }
      }
    },
  )
})

describe('optional fields and enums', () => {
  it('reports the exact duplicate path without including the identifier', () => {
    const row = { ...seed.tasks[0], id: 'private-task-id' }
    try {
      parseList([row, { ...row }], 'GET /tasks', parseTask)
      expect.unreachable('accepted duplicate ID')
    } catch (error) {
      expect(error).toMatchObject({
        endpoint: 'GET /tasks',
        fieldPath: '$[1].id',
      })
      expect((error as Error).message).not.toContain('private-task-id')
    }
  })

  it('does not guess snake_case fields or synthesize absent values', () => {
    const { elderId, ...task } = seed.tasks[0]
    expect(() => parseTask({ ...task, elder_id: elderId }, endpoint)).toThrow(
      ContractError,
    )
    const minimal = { ...seed.handover[0] }
    expect(parseHandoverItem(minimal, endpoint)).toBe(minimal)
    expect(Object.hasOwn(minimal, 'receivedAt')).toBe(false)
    expect(Object.hasOwn(minimal, 'receiverId')).toBe(false)
  })

  it('allows every declared status without accepting unknown ones', () => {
    for (const status of taskStatuses)
      expect(parseTask({ ...seed.tasks[0], status }, endpoint).status).toBe(
        status,
      )
    for (const status of aiDraftStatuses)
      expect(
        parseRecordDraft({ ...seed.drafts[0], status }, endpoint).status,
      ).toBe(status)
    for (const status of familyCaseStatuses)
      expect(
        parseFamilyCase({ ...seed.familyCases[0], status }, endpoint).status,
      ).toBe(status)
    for (const status of ['待接收', '已接收', '需澄清'])
      expect(
        parseHandoverItem({ ...seed.handover[0], status }, endpoint).status,
      ).toBe(status)
    for (const { parse, value } of resources.filter(
      ({ name }) => name !== 'timeline',
    )) {
      for (const status of ['unknown', 'constructor', '__proto__', ''])
        expect(() => parse({ ...value, status }, endpoint)).toThrow(
          ContractError,
        )
    }
    expect(() =>
      parseHandoverItem({ ...seed.handover[0], status: 'received' }, endpoint),
    ).toThrow(ContractError)
    expect(() =>
      parseElder({ ...seed.elders[0], risk: 'unknown' }, endpoint),
    ).toThrow(ContractError)
    for (const age of [-1, 2.5, NaN, Infinity, '78'])
      expect(() => parseElder({ ...seed.elders[0], age }, endpoint)).toThrow(
        ContractError,
      )
  })
  it('allows omitted optionals but rejects present values of the wrong type', () => {
    const groups = [
      {
        parse: parseTask as Parser<unknown>,
        value: seed.tasks[0],
        fields: ['result', 'itemId'],
      },
      {
        parse: parseHandoverItem as Parser<unknown>,
        value: seed.handover[0],
        fields: ['receivedAt', 'itemId', 'receiverId', 'receivedBy', 'note'],
      },
      {
        parse: parseFamilyCase as Parser<unknown>,
        value: seed.familyCases[0],
        fields: ['reply'],
      },
      {
        parse: parseTimelineEvent as Parser<unknown>,
        value: seed.timeline[0],
        fields: ['itemId', 'source'],
      },
    ]
    for (const { parse, value, fields } of groups) {
      const minimal: Record<string, unknown> = { ...value }
      for (const field of fields) delete minimal[field]
      expect(parse(minimal, endpoint)).toEqual(minimal)
      for (const field of fields) {
        for (const invalid of [null, 5, {}, []])
          expect(() =>
            parse({ ...minimal, [field]: invalid }, endpoint),
          ).toThrow(ContractError)
      }
    }
    expect(() => parseTask({ ...seed.tasks[0], itemId: '' }, endpoint)).toThrow(
      ContractError,
    )
    expect(() =>
      parseTimelineEvent({ ...seed.timeline[0], source: 'api' }, endpoint),
    ).toThrow(ContractError)
    expect(parseTask({ ...seed.tasks[0], result: '' }, endpoint).result).toBe(
      '',
    )
  })
  it('checks every nested AI field and array entry without echoing private text', () => {
    const draft = seed.drafts[0]
    for (const field of ['observation', 'followUp', 'contactTarget']) {
      const fields: Record<string, unknown> = { ...draft.fields }
      delete fields[field]
      expect(() => parseRecordDraft({ ...draft, fields }, endpoint)).toThrow(
        ContractError,
      )
      expect(() =>
        parseRecordDraft(
          { ...draft, fields: { ...draft.fields, [field]: [] } },
          endpoint,
        ),
      ).toThrow(ContractError)
    }
    for (const field of ['evidence', 'warnings']) {
      for (const input of [
        null,
        {},
        'text',
        ['valid', { private: 'private-original-text' }],
        [3],
      ]) {
        try {
          parseRecordDraft({ ...draft, [field]: input }, endpoint)
          expect.unreachable('accepted malformed AI array')
        } catch (error) {
          expect(error).toBeInstanceOf(ContractError)
          expect((error as Error).message).not.toContain(
            'private-original-text',
          )
        }
      }
    }
  })
})

describe('date policy', () => {
  it.each([
    '今天 12:30',
    '昨天 00:00:01',
    '明天 23:59',
    '2026-10-20T12:30',
    '2026-10-20 12:30:45',
    '2026-10-20T12:30:45.123Z',
    '2026-10-20T12:30:45+08:00',
    '2024-02-29T23:59:59-05:30',
  ])('accepts and preserves meaningful timestamps: %s', (date) => {
    const event = { ...seed.timeline[0], happenedAt: date, enteredAt: date }
    expect(parseTimelineEvent(event, endpoint)).toBe(event)
    expect(
      parseHandoverItem({ ...seed.handover[0], receivedAt: date }, endpoint)
        .receivedAt,
    ).toBe(date)
    expect(parseTask({ ...seed.tasks[0], dueAt: date }, endpoint).dueAt).toBe(
      date,
    )
  })
  it.each(['', '2026-10-20', '待确认期限'])(
    'allows declared display-only deadline values: %s',
    (dueAt) => {
      expect(parseTask({ ...seed.tasks[0], dueAt }, endpoint).dueAt).toBe(dueAt)
      expect(() =>
        parseTimelineEvent(
          { ...seed.timeline[0], happenedAt: dueAt },
          endpoint,
        ),
      ).toThrow(ContractError)
    },
  )
  it('allows blank optional/display dates without inventing a time', () => {
    expect(
      parseElder({ ...seed.elders[0], lastUpdate: '' }, endpoint).lastUpdate,
    ).toBe('')
    expect(
      parseElder({ ...seed.elders[0], lastUpdate: '2026-10-20' }, endpoint)
        .lastUpdate,
    ).toBe('2026-10-20')
    expect(
      parseHandoverItem({ ...seed.handover[0], receivedAt: '' }, endpoint)
        .receivedAt,
    ).toBe('')
  })
  it.each([
    'nonsense',
    '2026-02-29T12:30',
    '2026-04-31T12:30',
    '2026-13-01T12:30',
    '2026-10-20T24:00',
    '今天 25:00',
    '今天 12:60',
    '2026-10-20T12:30:60Z',
    '2026-10-20T12:30+25:00',
    '2026-10-20T12:30+08:60',
    '2026-10-20junk',
  ])(
    'rejects malformed or impossible dates without Date.parse rollover: %s',
    (date) => {
      expect(() =>
        parseTask({ ...seed.tasks[0], dueAt: date }, endpoint),
      ).toThrow(ContractError)
      expect(() =>
        parseElder({ ...seed.elders[0], lastUpdate: date }, endpoint),
      ).toThrow(ContractError)
      expect(() =>
        parseHandoverItem({ ...seed.handover[0], receivedAt: date }, endpoint),
      ).toThrow(ContractError)
      expect(() =>
        parseTimelineEvent({ ...seed.timeline[0], enteredAt: date }, endpoint),
      ).toThrow(ContractError)
    },
  )
})

describe('login contract', () => {
  it('accepts omitted optionals and supported role aliases without changing values', () => {
    expect(
      parseLoginResponse({ access_token: 'token' }, 'POST /auth/login'),
    ).toEqual({ access_token: 'token' })
    for (const role of [
      'admin',
      'supervisor',
      'caregiver',
      'family',
      '管理员',
      '主管',
      '护理员',
      '家属',
    ]) {
      const value = { access_token: 'token', role, token_type: 'bearer' }
      expect(parseLoginResponse(value, 'POST /auth/login')).toBe(value)
    }
  })
  it.each([
    null,
    [],
    {},
    { access_token: null },
    { access_token: '' },
    { access_token: ' ' },
    { access_token: 5 },
    { access_token: 'secret-token', token_type: {} },
    { access_token: 'secret-token', role: null },
    { access_token: 'secret-token', role: 'root' },
  ])(
    'rejects invalid credentials and optional fields without disclosing them',
    (value) => {
      try {
        parseLoginResponse(value, 'POST /auth/login')
        expect.unreachable('accepted malformed login')
      } catch (error) {
        expect(error).toBeInstanceOf(ContractError)
        expect((error as Error).message).not.toContain('secret-token')
      }
    },
  )
})
