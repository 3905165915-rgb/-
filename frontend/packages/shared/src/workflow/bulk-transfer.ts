import type { Row } from './model'
export function ordinaryTransferIssue(task:Row, assignee:string, shift?:Row):string {
  if (!['pending','overdue'].includes(String(task.status))) return '仅可批量转交尚未开始的普通任务。'
  if (task.condition || task.source_plan_id || task.source_advice_id || task.risk_level==='high' || task.high_risk===true)
    return '含条件、计划或风险依据的任务须逐项核对后转交。'
  if (!Array.isArray(task.allowed_actions) || !task.allowed_actions.includes('transfer')) return '服务器未允许当前账号转交该任务。'
  if (!Number.isSafeInteger(task.revision) || Number(task.revision)<1) return '任务版本不完整，请刷新。'
  if (!assignee || task.assigned_to===assignee) return '请选择不同的接任人员。'
  if (task.shift_id && (!shift || shift.status!=='open' || !Array.isArray(shift.caregiver_ids) || !shift.caregiver_ids.includes(assignee))) return '接任人员不在任务的开放班次中。'
  return ''
}
export function validateTransferReceipt(value:unknown, taskId:string, revision:number, assignee:string):Row {
  const row=value as Row|null
  if (!row || row.id!==taskId || row.assigned_to!==assignee || !Number.isSafeInteger(row.revision) || Number(row.revision)<=revision)
    throw new Error('转交回执与原请求不匹配，需沿用原请求核实。')
  return row
}
