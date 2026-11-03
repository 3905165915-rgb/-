import { initial, requestBody, schemas, type Row, type Schema } from './model'
import { checkResponse } from './catalogs'

// Mirrors TaskCreateRequest in backend a6c0a6f; no extra observation is created.
export function taskCreationSchema(): Schema {
  return structuredClone(schemas.TaskCreateRequest)
}
export function taskCreationInitial(schema: Schema): Row {
  return initial(schema) as Row
}
export function taskCreationPayload(schema: Schema, value: Row): Row {
  const checked = requestBody('/tasks', schema, value)
  if (Date.parse(String(checked.due_at)) <= Date.now())
    throw new Error('截止时间必须晚于当前时间，请明确选择日期和时刻。')
  if (checked.source_type === 'record') {
    if (!checked.source_id || !checked.source_revision)
      throw new Error('请明确选择来源记录并核对版本。')
  } else {
    if (checked.source_id || checked.source_revision)
      throw new Error('人工任务不能附带记录来源，请先选择任务来源类型。')
  }
  return checked
}
export function checkTaskCreationReceipt(value: unknown, payload: Row): void {
  checkResponse(schemas.CareTask, value)
  const row = value as Row
  if (typeof row.id !== 'string' || !row.id.trim() || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 ||
      ['elder_id', 'title', 'shift_id', 'assigned_to', 'completion_criteria'].some(key => row[key] !== String(payload[key]).trim()) ||
      Date.parse(String(row.due_at)) !== Date.parse(String(payload.due_at))) {
    throw new Error('任务回执与本次请求不匹配，请使用原请求核实结果，勿重新创建。')
  }
}
export function taskSourceOptions(
  elderId: unknown,
  catalogs: Record<string, Row[]>,
): Row[] {
  const elder = catalogs.elders?.find((row) => row.id === elderId)
  return (catalogs.records || [])
    .filter(
      (row) =>
        row.elder_id === elderId &&
        ['confirmed', 'corrected'].includes(String(row.status)) &&
        !!elder?.current_admission_id &&
        row.admission_id === elder.current_admission_id,
    )
    .map((row) => ({
      ...row,
      label: `第${row.revision}版 · ${String(row.raw_text || (Array.isArray(row.observations) ? row.observations[0] : '') || '记录内容未提供').slice(0, 65)}`,
    }))
}
export function taskSourceIssue(
  payload: Row,
  catalogs: Record<string, Row[]>,
): string {
  if (payload.source_type !== 'record') return ''
  const record = taskSourceOptions(payload.elder_id, catalogs).find(
    (row) => row.id === payload.source_id,
  )
  return !record || record.revision !== payload.source_revision
    ? '来源记录已变更、撤销或不属于当前入住老人，请刷新后重新核对来源。'
    : ''
}
export function updateTaskSource(
  previous: Row,
  next: Row,
  catalogs: Record<string, Row[]>,
): Row {
  const value = { ...next }
  if (
    previous.source_type !== value.source_type ||
    value.source_type !== 'record'
  ) {
    value.source_id = ''
    value.source_revision = ''
  }
  if (
    value.source_type === 'record' &&
    previous.source_id !== value.source_id
  ) {
    value.source_revision =
      taskSourceOptions(value.elder_id, catalogs).find(
        (row) => row.id === value.source_id,
      )?.revision || ''
  }
  return value
}

export function manualFallback(value: Row): Row {
  return {
    elder_id: value.elder_id || '',
    shift_id: value.shift_id || '',
    raw_text: value.text || value.raw_text || '',
    happened_at: value.happened_at || '',
    observations: [],
    task_candidates: [],
  }
}
