import type { Row } from './model'
import { date } from './workspace-time'

export interface RecordCitation {
  source_field: 'raw_text' | 'observations'
  quote: string
}

export interface RecordAnalysis {
  id: string
  record_id: string
  record_revision: number
  status: 'ready' | 'failed' | 'confirmed'
  scene: { value: string | null; citation: RecordCitation | null }
  observations: Array<{ id: string; text: string; citation: RecordCitation }>
  taskSuggestions: Array<{
    id: string
    title: string
    evidenceText: string
    condition: string | null
    dueText: string | null
  }>
  preferenceSuggestions: Array<{
    id: string
    content: string
    frequency: 'explicit' | 'one_time' | 'ambiguous'
    attributedTo: string
    evidenceText: string
  }>
  createdAt: string
}

export interface InlineRecordResponse {
  record: Row
  analysisStatus: 'ready' | 'failed' | 'confirmed'
  analysis: RecordAnalysis | null
  analysisError?: { code: string; message: string }
}

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('服务器回执格式不匹配。')
  return value as Row
}

function text(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim()
}

function revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1
}

function aware(value: unknown): value is string {
  return text(value) && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}

function citation(value: unknown, record: Row): RecordCitation {
  const row = object(value)
  if (
    !['raw_text', 'observations'].includes(String(row.source_field)) ||
    !text(row.quote)
  )
    throw new Error('分析引用格式异常，请核对服务器原始记录。')
  const source = row.source_field === 'raw_text'
    ? record.raw_text
    : Array.isArray(record.observations)
      ? record.observations.filter(text).join('\n')
      : ''
  if (typeof source !== 'string' || !source.includes(row.quote))
    throw new Error('分析引用与原始记录不一致，请刷新核实。')
  return { source_field: row.source_field as RecordCitation['source_field'], quote: row.quote }
}

export function validateInlineRecordResponse(value: unknown, elderId: string): InlineRecordResponse {
  const envelope = object(value)
  const record = object(envelope.record)
  if (
    record.elder_id !== elderId || !text(record.id) ||
    !['confirmed', 'corrected'].includes(String(record.status)) ||
    !revision(record.revision) || !text(record.raw_text) ||
    !text(record.admission_id) || !aware(record.created_at) ||
    (record.happened_at != null && !aware(record.happened_at))
  ) throw new Error('正式记录回执异常，请核实保存状态后再操作。')
  const rawText = record.raw_text as string

  const status = envelope.analysis_status
  if (!['ready', 'failed', 'confirmed'].includes(String(status)))
    throw new Error('即时分析状态异常，正式记录已保留，请刷新核实。')
  if (status === 'failed' && envelope.analysis === null) {
    const failure = envelope.analysis_error == null ? null : object(envelope.analysis_error)
    if (failure && (!text(failure.code) || !text(failure.message)))
      throw new Error('分析状态说明格式异常，原记录仍已保存。')
    return { record, analysisStatus: 'failed', analysis: null,
      ...(failure ? { analysisError: { code: String(failure.code), message: String(failure.message) } } : {}),
    }
  }

  const row = object(envelope.analysis)
  if (
    !text(row.id) || row.record_id !== record.id ||
    row.record_revision !== record.revision ||
    !['ready', 'confirmed'].includes(String(row.status)) ||
    !aware(row.created_at)
  ) throw new Error('即时分析版本与正式记录不一致，请刷新核实。')
  const sceneRow = object(row.scene)
  const sceneCitation = sceneRow.citation === null
    ? null
    : citation(sceneRow.citation, record)
  if (sceneRow.value !== null && !['bathing', 'dining', 'activity', 'communication', 'rest', 'other'].includes(String(sceneRow.value)))
    throw new Error('照护场景分类异常，请刷新核实。')
  if (sceneCitation === null && sceneRow.value !== null)
    throw new Error('照护场景缺少原文依据，请刷新核实。')
  if (!Array.isArray(row.observations) || !Array.isArray(row.task_suggestions) || !Array.isArray(row.preference_suggestions))
    throw new Error('即时分析内容不完整，请刷新核实。')

  const observations = row.observations.map((item) => {
    const observation = object(item)
    const source = citation(observation.citation, record)
    if (!text(observation.id) || !text(observation.text))
      throw new Error('观察建议格式异常，请刷新核实。')
    return { id: observation.id, text: observation.text, citation: source }
  })
  const taskSuggestions = row.task_suggestions.map((item) => {
    const task = object(item)
    if (!text(task.id) || !text(task.title) || !text(task.evidence_text) ||
      !rawText.includes(task.evidence_text) ||
      (task.condition !== null && !text(task.condition)) ||
      (task.due_text !== null && !text(task.due_text)))
      throw new Error('待办建议缺少有效原文依据，请刷新核实。')
    return { id: task.id, title: task.title, evidenceText: task.evidence_text,
      condition: task.condition as string | null, dueText: task.due_text as string | null }
  })
  const preferenceSuggestions = row.preference_suggestions.map((item) => {
    const preference = object(item)
    if (!text(preference.id) || !text(preference.content) ||
      !['explicit', 'one_time', 'ambiguous'].includes(String(preference.frequency)) ||
      !['elder', 'family', 'staff', 'unknown'].includes(String(preference.attributed_to)) ||
      !text(preference.evidence_text) || !rawText.includes(preference.evidence_text))
      throw new Error('偏好建议缺少有效原文依据，请刷新核实。')
    return { id: preference.id, content: preference.content,
      frequency: preference.frequency as RecordAnalysis['preferenceSuggestions'][number]['frequency'],
      attributedTo: String(preference.attributed_to), evidenceText: preference.evidence_text }
  })
  return {
    record,
    analysisStatus: status as InlineRecordResponse['analysisStatus'],
    analysis: {
      id: row.id, record_id: row.record_id, record_revision: row.record_revision,
      status: row.status as RecordAnalysis['status'],
      scene: { value: sceneRow.value as string | null, citation: sceneCitation },
      observations, taskSuggestions, preferenceSuggestions, createdAt: row.created_at,
    },
  }
}

export interface PreferenceInput {
  suggestionId: string
  decision: '' | 'adopt' | 'reject'
  content: string
}

export interface TaskInput {
  suggestionId: string
  accepted: boolean
  title: string
  shiftId: string
  assignedTo: string
  dueAt: string
  completionCriteria: string
}

export function buildRecordAnalysisConfirmation(input: {
  expectedRevision: number
  preferenceSuggestionIds: string[]
  preferences: PreferenceInput[]
  tasks: TaskInput[]
}): Row {
  const decisions = new Set(input.preferences.map((item) => item.suggestionId))
  if (!revision(input.expectedRevision) || input.preferences.some((item) => !item.decision) ||
    decisions.size !== input.preferenceSuggestionIds.length ||
    input.preferenceSuggestionIds.some((id) => !decisions.has(id)))
    throw new Error('请逐项确认或拒绝每条偏好建议。')
  const acceptedTasks = input.tasks.filter((item) => item.accepted)
  if (acceptedTasks.some((item) => !text(item.title) || !text(item.shiftId) ||
    !text(item.assignedTo) || !text(item.completionCriteria) || !text(item.dueAt)))
    throw new Error('已接受的待办需要完整填写标题、班次、责任人、截止时间和完成标准。')
  // Browser datetime-local inputs have no suffix. Interpret them as Beijing
  // time, matching the other care forms, before sending an aware API value.
  const deadlines = acceptedTasks.map((item) => aware(item.dueAt)
    ? new Date(item.dueAt).toISOString()
    : date(item.dueAt))
  return {
    expected_revision: input.expectedRevision,
    preference_decisions: input.preferences.map((item) => ({
      suggestion_id: item.suggestionId,
      decision: item.decision,
      ...(item.decision === 'adopt' ? { content: item.content.trim() } : {}),
    })),
    accepted_tasks: acceptedTasks.map((item, index) => ({
      suggestion_id: item.suggestionId,
      title: item.title.trim(),
      shift_id: item.shiftId,
      assigned_to: item.assignedTo,
      due_at: deadlines[index],
      completion_criteria: item.completionCriteria.trim(),
    })),
  }
}
