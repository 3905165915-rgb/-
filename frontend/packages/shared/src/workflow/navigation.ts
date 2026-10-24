import type { Operation, Row } from './model'

export interface WorkflowArea {
  id: string
  title: string
  description: string
  entry: Operation
  actions: Operation[]
}

export function operationTitle(op: Operation): string {
  const names: Record<string, string> = {
    '/records': '记录',
    '/records/context-extract': '新增记录',
    '/records/extract': '新增记录', // Existing pending requests retain their original endpoint.
    '/records/manual': '新增记录',
    '/records/drafts': '草稿',
    '/records/drafts/{draft_id}': '草稿详情',
    '/records/drafts/{draft_id}/reject': '放弃草稿',
    '/records/{draft_id}/confirm': '核对并保存记录',
    '/records/{record_id}': '记录详情',
    '/records/{record_id}/history': '记录详情与历史',
    '/records/{record_id}/corrections': '更正记录',
    '/speech/status': '语音服务设置',
    '/handovers/{handover_id}/ai-summary': '生成交班摘要',
    '/quality/checks': op.method === 'post' ? '执行质量检查' : '检查报告',
    '/memories/from-draft': '从整理结果选择记忆候选',
  }
  return names[op.path] || op.title
}

export function recordArea(op: Operation): string {
  if (
    [
      '/records/manual',
      '/records/extract',
      '/records/context-extract',
    ].includes(op.path)
  )
    return 'new'
  if (op.path.includes('draft') || op.path.endsWith('/confirm')) return 'drafts'
  if (op.path.startsWith('/records')) return 'records'
  return 'more'
}

function areaFor(op: Operation): [string, string, string] {
  const path = op.path
  if (op.group === 'records') {
    const key = recordArea(op)
    return (
      {
        new: [
          'new',
          '新增记录',
          '说一段或写下来，整理核对后保存，也可直接填写。',
        ],
        records: ['records', '记录', '查看已保存记录、来源与更正历史。'],
        drafts: ['drafts', '草稿', '统一查看待核对内容，继续核对或放弃。'],
        more: ['more', '更多', '语音服务等辅助设置。'],
      } as Record<string, [string, string, string]>
    )[key]
  }
  const named = (id: string, title: string): [string, string, string] => [
    id,
    title,
    '',
  ]
  if (op.group === 'tasks') {
    if (/memory-references|plan-check/.test(path))
      return named('basis', '个性化依据')
    if (path.includes('/condition')) return named('conditions', '执行前提核验')
    if (/transition|complete/.test(path)) return named('execution', '任务执行')
    return named('tasks', '任务')
  }
  if (op.group === 'handovers')
    return /items\//.test(path)
      ? named('receive', '接班与澄清')
      : named('handover', '交班')
  if (op.group === 'admission')
    return path.startsWith('/beds')
      ? named('beds', '床位')
      : named('admission', '入住与变动')
  if (op.group === 'memories') return named('memories', '个性化记忆')
  if (op.group === 'plans')
    return /generate|reissue|impact/.test(path)
      ? named('apply', '计划应用与影响')
      : named('plans', '照护计划')
  if (op.group === 'family') {
    if (path.includes('accounts')) return named('accounts', '家属账号')
    if (path.includes('feedback')) return named('feedback', '问题与回复')
    if (path.includes('summar')) return named('summaries', '服务简报')
    if (path === '/family/cases') return named('cases', '沟通记录')
    return named('bindings', '家属授权')
  }
  if (op.group === 'staff')
    return /password|directory/.test(path)
      ? named('settings', '账号与目录')
      : named('staff', '员工')
  if (op.group === 'incidents')
    return path.startsWith('/rectifications')
      ? named('rectify', '整改与复查')
      : named('incidents', '事件')
  if (op.group === 'reports')
    return path.endsWith('/export')
      ? named('export', '证据导出')
      : named('metrics', '运营统计')
  return named(
    op.group,
    (
      {
        elders: '老人档案',
        shifts: '班次',
        assessments: '评估',
        quality: '质量检查',
        changes: '变更核验',
        coverage: '计划核对',
        brief: '变化简报',
        timeline: '过程回放',
      } as Record<string, string>
    )[op.group] || '业务办理',
  )
}

export function workflowAreas(ops: Operation[]): WorkflowArea[] {
  const result: WorkflowArea[] = []
  for (const op of ops) {
    // The contextual endpoint includes the original extraction capability.
    // Keep the old operation available only for recovering an earlier request.
    if (op.group === 'records' && op.path === '/records/extract') continue
    const [id, title, description] = areaFor(op)
    let area = result.find((row) => row.id === id)
    if (!area) {
      area = { id, title, description, entry: op, actions: [] }
      result.push(area)
    }
    area.actions.push(op)
  }
  if (ops[0]?.group === 'records') {
    const order = ['new', 'records', 'drafts', 'more']
    result.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    const creation = result.find((area) => area.id === 'new')
    if (creation)
      creation.entry =
        creation.actions.find((op) => op.path === '/records/context-extract') ||
        creation.entry
  }
  return result
}

export function areaId(op: Operation): string {
  return areaFor(op)[0]
}

export function recordModeValue(value: Row, mode: 'manual' | 'assisted'): Row {
  const base = {
    elder_id: value.elder_id || '',
    shift_id: value.shift_id || '',
  }
  return mode === 'manual'
    ? {
        ...base,
        raw_text: value.text || value.raw_text || '',
        observations: [],
        task_candidates: [],
        happened_at: value.happened_at || '',
      }
    : {
        ...base,
        text: value.raw_text || value.text || '',
        scene: value.scene || '',
      }
}
