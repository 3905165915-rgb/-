import { describe, expect, it } from 'vitest'
import { display, label, optionLabel, operations } from './model'

describe('Chinese business presentation', () => {
  it('translates every operational report heading from the deployed response', () => {
    const fields = ['timezone','window','start_inclusive','end_exclusive','interpretation',
      'generated_plan_occurrences','completion','on_time_completion','numerator','denominator',
      'ratio','cancelled','not_done','open_overdue','excluded_future_task_rows',
      'invalid_schedule_rows','definition','manual_task_rows_created','handover_receipt',
      'incidents','reported','closed','open_rectifications_overdue','family_feedback','created',
      'clarifications','memory_references','condition_verification','condition_check','plan_check',
      'source_plan_snapshot','source_plan_id','source_plan_revision','handover_id','source_shift_id',
      'target_shift_id','task_count','record']
    for (const field of fields) expect(label(field)).not.toBe(field)
    expect(label('summary')).toBe('交班注意事项')
  })
  it('shows Beijing time without rewriting quoted source text or request timestamps', () => {
    const iso = '2026-10-23T17:04:39.995534+00:00'
    expect(display(iso, 'as_of')).toBe('2026年10月24日 01:04:39（北京时间）')
    expect(display(iso, 'source_quote')).toBe(iso)
    expect(display('2026-10-24T00:00:00+08:00', 'start_inclusive')).toContain('00:00:00')
    expect(display('invalid', 'as_of')).toBe('invalid')
    expect(display('Asia/Shanghai', 'timezone')).toBe('北京时间（UTC+8）')
  })
  it('does not misrepresent an absent denominator as a zero percent result', () => {
    expect(display(null, 'ratio')).toBe('暂无可统计数据')
    expect(display(0, 'ratio')).toBe('0%')
    expect(display(0.666666, 'ratio')).toBe('66.7%')
    expect(display(null, 'other')).toBe('未提供')
  })
  it('shows short elder names while preserving IDs as select values', () => {
    const rows = [{id:'ELDER-long-technical-identifier',name:'张阿姨'},
      {id:'ELDER-another-id',name:'李爷爷'}]
    expect(optionLabel('elder_id', rows[0], rows)).toBe('张阿姨')
    expect(optionLabel('elder_id', rows[1], rows)).toBe('李爷爷')
    expect(rows[0].id).toBe('ELDER-long-technical-identifier')
  })
  it('distinguishes real duplicate names without exposing technical identifiers', () => {
    const rows = [{id:'ELDER-1',name:'张阿姨',bed_label:'101床'},
      {id:'ELDER-2',name:'张阿姨',bed_label:'102床'}]
    expect(optionLabel('elder_id', rows[0], rows)).toBe('张阿姨 · 101床')
    expect(optionLabel('elder_id', rows[1], rows)).toBe('张阿姨 · 102床')
    const noBeds = rows.map(({id,name}) => ({id,name}))
    expect(optionLabel('elder_id', noBeds[0], noBeds)).toBe('张阿姨（同名1）')
    expect(optionLabel('elder_id', noBeds[1], noBeds)).toBe('张阿姨（同名2）')
  })
  it('shows task options by elder and readable task details without IDs', () => {
    const tasks = [
      { id: 'TASK-long-id-one', title: '午后陪同散步', elder_id: 'E1', status: 'pending' },
      { id: 'TASK-long-id-two', title: '晚间测量体温', elder_id: 'E2', status: 'in_progress' },
    ]
    const elders = [
      { id: 'E1', name: '张阿姨', bed_label: '305床' },
      { id: 'E2', name: '李爷爷', bed_label: '306床' },
    ]
    expect(optionLabel('task_id', tasks[0], tasks, { elders })).toBe('张阿姨 · 305床 · 午后陪同散步 · 待处理')
    expect(optionLabel('task_id', tasks[1], tasks, { elders })).not.toContain(tasks[1].id)
  })
  it('limits task assignment changes to managers, matching the backend', () => {
    const update = operations.find((op) => op.path === '/tasks/{task_id}' && op.method === 'patch')
    expect(update?.roles).toEqual(['admin', 'supervisor'])
  })
})
