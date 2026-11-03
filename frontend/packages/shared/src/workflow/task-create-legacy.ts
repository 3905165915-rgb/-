import { initial, requestBody, schemas, type Row, type Schema } from './model'

// Retained only to recover forms created before direct task creation was available.
export function legacyTaskCreationSchema(): Schema {
  const source = structuredClone(schemas.ManualRecordRequest)
  const candidate = structuredClone(schemas.TaskCandidate)
  source.properties = {
    elder_id: source.properties!.elder_id,
    shift_id: source.properties!.shift_id,
    raw_text: source.properties!.raw_text,
    title: candidate.properties!.title,
    assigned_to: candidate.properties!.assigned_to,
    due_at: candidate.properties!.due_at,
    completion_criteria: { type: 'string', minLength: 1, maxLength: 1500 },
  }
  source.required = [
    'elder_id',
    'raw_text',
    'title',
    'assigned_to',
    'due_at',
    'completion_criteria',
  ]
  return source
}

export function legacyTaskCreationInitial(schema: Schema): Row {
  return initial(schema) as Row
}

export function legacyTaskCreationPayload(schema: Schema, value: Row): Row {
  const checked = requestBody('/records/manual', schema, value)
  const candidate = {
    title: checked.title,
    assigned_to: checked.assigned_to,
    due_at: checked.due_at,
  }
  const rawText = `${checked.raw_text}\n\n【人工安排的任务】${candidate.title}\n【完成标准】${checked.completion_criteria}`
  // Revalidate against the unchanged wire schema, including the combined limit.
  return requestBody('/records/manual', schemas.ManualRecordRequest, {
    elder_id: checked.elder_id,
    shift_id: checked.shift_id,
    raw_text: rawText,
    task_candidates: [candidate],
  })
}
