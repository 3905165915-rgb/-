import { describe, expect, it } from 'vitest'
import {
  createSummaryMutations,
  familySummary,
  selectionPayload,
  summaryPreview,
  summaryWorkspace,
  type SummaryMutationAttempt,
} from './family-summary'

const start = '2026-11-02T00:00:00+08:00',
  end = '2026-11-02T12:00:00+08:00'
const workspaceData = () => ({
  elder: { id: 'ELDER-SYNTHETIC', name: '虚构老人' },
  current_admission_id: 'STAY-SYNTHETIC',
  context_notice: null,
  items: [
    {
      record_id: 'RECORD-SYNTHETIC',
      happened_at: '2026-11-02T09:00:00+08:00',
      recorded_at: '2026-11-02T09:02:00+08:00',
      public_fragments: ['老人选择在活动室听音乐。'],
      suggested_quote: '老人选择在活动室听音乐。',
      selectable: true,
      unavailable_reason: null,
    },
  ],
  total: 1,
  offset: 0,
  limit: 20,
  period_start: start,
  period_end: end,
  recipients: [{ id: 'FAMILY-SYNTHETIC', display_name: '虚构家属' }],
  recipient_count: 1,
  can_publish: true,
})
const selected = [
  { record_id: 'RECORD-SYNTHETIC', public_quote: '老人选择在活动室听音乐。' },
]
const draft = () => ({
  id: 'SUMMARY-SYNTHETIC',
  elder_id: 'ELDER-SYNTHETIC',
  admission_id: 'STAY-SYNTHETIC',
  period_start: start,
  period_end: end,
  text: selected[0].public_quote,
  status: 'draft',
  revision: 1,
})

describe('family summary selection workflow', () => {
  it('builds a public selection without asking the operator for evidence versions or an admission ID', () => {
    const workspace = summaryWorkspace(workspaceData(), 'ELDER-SYNTHETIC')
    const payload = selectionPayload(workspace, selected, '', true)
    expect(payload).toEqual({
      elder_id: 'ELDER-SYNTHETIC',
      period_start: start,
      period_end: end,
      selections: selected,
      text: '',
      public_quotes_confirmed: true,
    })
    expect(payload).not.toHaveProperty('admission_id')
    expect(payload).not.toHaveProperty('evidence')
  })
  it('requires an explicit review of 1–10 selected public fragments', () => {
    const workspace = summaryWorkspace(workspaceData(), 'ELDER-SYNTHETIC')
    expect(() => selectionPayload(workspace, selected, '', false)).toThrow(
      '核对',
    )
    expect(() => selectionPayload(workspace, [], '', true)).toThrow('1至10')
    expect(() =>
      selectionPayload(
        workspace,
        Array.from({ length: 11 }, (_, i) => ({
          record_id: `RECORD-${i}`,
          public_quote: '虚构观察',
        })),
        '',
        true,
      ),
    ).toThrow('1至10')
    expect(() =>
      selectionPayload(workspace, selected, '字'.repeat(2001), true),
    ).toThrow('2000')
  })
  it('accepts a server preview of the exact final body and treats edits as requiring a new preview', () => {
    const workspace = summaryWorkspace(workspaceData(), 'ELDER-SYNTHETIC')
    const payload = selectionPayload(workspace, selected, '', true)
    const response = {
      preview: true,
      context_token: 'a'.repeat(64),
      family_preview: {
        elder_id: payload.elder_id,
        period_start: start,
        period_end: end,
        text: selected[0].public_quote,
      },
      recipients: workspace.recipients,
      recipient_count: 1,
      can_publish: true,
    }
    expect(summaryPreview(response, payload).family_preview.text).toBe(
      selected[0].public_quote,
    )
    expect(() =>
      summaryPreview(response, {
        ...payload,
        text: '老人今天参加了音乐活动。',
      }),
    ).toThrow('重新预览')
  })
  it('supports saving a draft with no authorized recipients and an empty no-admission workspace', () => {
    const workspace = summaryWorkspace(
      {
        ...workspaceData(),
        recipients: [],
        recipient_count: 0,
        can_publish: false,
      },
      'ELDER-SYNTHETIC',
    )
    expect(
      selectionPayload(workspace, selected, '', true).selections,
    ).toHaveLength(1)
    const noStay = summaryWorkspace(
      {
        ...workspace,
        current_admission_id: null,
        context_notice: '暂无有效入住',
        items: [],
        total: 0,
      },
      'ELDER-SYNTHETIC',
    )
    expect(() => selectionPayload(noStay, selected, '', true)).toThrow(
      '暂无有效入住',
    )
  })
  it('recovers a lost create response with the same key and body, rather than creating another summary', async () => {
    const calls: { path: string; body: unknown; key?: string }[] = []
    let round = 0
    const mutations = createSummaryMutations(
      async (path, _method, body, key) => {
        calls.push({ path, body, key })
        if (round++ === 0) throw new Error('连接中断')
        return draft()
      },
      () => true,
      () => 'same-operation-key',
    )
    const body = {
      text: selected[0].public_quote,
      expected_context_token: 'a'.repeat(64),
    }
    await expect(
      mutations.execute(
        '/family/summaries/from-selection',
        'post',
        body,
        'ELDER-SYNTHETIC',
      ),
    ).rejects.toThrow('连接中断')
    expect(mutations.pending.value).not.toBeNull()
    expect(() =>
      mutations.execute(
        '/family/summaries/from-selection',
        'post',
        body,
        'ELDER-SYNTHETIC',
      ),
    ).toThrow('上一笔')
    expect(await mutations.retry()).toMatchObject({
      status: 'draft',
      revision: 1,
    })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
    expect(mutations.pending.value).toBeNull()
  })
  it('keeps a draft available after a known publish rejection, so authorization can be corrected', async () => {
    const saved = familySummary(draft(), 'ELDER-SYNTHETIC')
    const mutations = createSummaryMutations(
      async () => {
        throw Object.assign(new Error('暂无有效授权家属，草稿已保留。'), {
          status: 409,
        })
      },
      () => true,
    )
    await expect(
      mutations.execute(
        '/family/summaries/' + saved.id + '/review',
        'post',
        {
          expected_revision: saved.revision,
          action: 'publish',
          reason: '已核对公开内容',
        },
        saved.elder_id,
      ),
    ).rejects.toThrow('草稿已保留')
    expect(mutations.pending.value).toBeNull()
    expect(saved.status).toBe('draft')
  })
  it('discards a late result after the operator leaves the workspace', async () => {
    let active = true
    let resolve!: (value: unknown) => void
    const mutations = createSummaryMutations(
      () =>
        new Promise((done) => {
          resolve = done
        }),
      () => active,
    )
    const saving = mutations.execute(
      '/family/summaries/from-selection',
      'post',
      { text: selected[0].public_quote },
      'ELDER-SYNTHETIC',
    )
    active = false
    resolve(draft())
    expect(await saving).toBeUndefined()
    mutations.clear()
    expect(mutations.pending.value).toBeNull()
  })
  it('restores an uncertain original request after the page reloads', async () => {
    let stored: SummaryMutationAttempt | null = null
    const journal = {
      read: () => stored,
      write: (value: SummaryMutationAttempt | null) => {
        stored = value
      },
    }
    const firstPage = createSummaryMutations(
      async () => {
        throw new Error('连接中断')
      },
      () => true,
      () => 'durable-key',
      journal,
    )
    await expect(
      firstPage.execute(
        '/family/summaries/from-selection',
        'post',
        { text: selected[0].public_quote },
        'ELDER-SYNTHETIC',
      ),
    ).rejects.toThrow()
    const sent: string[] = []
    const nextPage = createSummaryMutations(
      async (_path, _method, _body, key) => {
        sent.push(key!)
        return draft()
      },
      () => true,
      () => 'new-unused-key',
      journal,
    )
    nextPage.restore()
    expect(nextPage.pending.value?.key).toBe('durable-key')
    await nextPage.retry()
    expect(sent).toEqual(['durable-key'])
    expect(stored).toBeNull()
  })
  it('does not send a write when the browser cannot retain its recovery receipt', () => {
    let sent = false
    const mutations = createSummaryMutations(
      async () => {
        sent = true
        return draft()
      },
      () => true,
      () => 'key',
      {
        read: () => null,
        write: () => {
          throw new Error('本机存储不可用')
        },
      },
    )
    expect(() =>
      mutations.execute(
        '/family/summaries/from-selection',
        'post',
        { text: selected[0].public_quote },
        'ELDER-SYNTHETIC',
      ),
    ).toThrow('存储不可用')
    expect(sent).toBe(false)
  })
})
