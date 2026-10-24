import { describe, expect, it } from 'vitest'
import { display, label, optionLabel } from './model'

describe('Chinese business presentation', () => {
  it('translates every operational report heading from the deployed response', () => {
    const fields = ['timezone','window','start_inclusive','end_exclusive','interpretation',
      'generated_plan_occurrences','completion','on_time_completion','numerator','denominator',
      'ratio','cancelled','not_done','open_overdue','excluded_future_task_rows',
      'invalid_schedule_rows','definition','manual_task_rows_created','handover_receipt',
      'incidents','reported','closed','open_rectifications_overdue','family_feedback','created']
    for (const field of fields) expect(label(field)).not.toBe(field)
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
})
