export interface ElderSummary {
  id: string
  name: string
  bed_label?: string
  status?: string
}

export interface InlineRecordEnvelope {
  record: {
    id: string
    elder_id: string
    revision: number
    status: 'confirmed' | 'corrected'
    raw_text: string
    admission_id: string
    created_at: string
    happened_at?: string | null
  }
  analysis_status: 'ready' | 'failed' | 'confirmed' | 'queued' | 'processing'
  analysis: Record<string, unknown> | null
}

export interface RecordAnalysisConfirmation {
  expected_revision: number
  preference_decisions: Array<{
    suggestion_id: string
    decision: 'adopt' | 'reject'
    content?: string
  }>
  accepted_tasks: Array<{
    suggestion_id: string
    title: string
    shift_id: string
    assigned_to: string
    due_at: string
    completion_criteria: string
  }>
}
