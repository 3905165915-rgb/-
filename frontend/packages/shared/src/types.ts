import type { AiDraftStatus, FamilyCaseStatus, TaskStatus } from './statuses'

export interface SessionUser {
  id: string
  username: string
  role: string
}

export interface Elder {
  id: string
  name: string
  bedLabel: string
  age?: number
  status: '待入住' | '入住' | '外出' | '离院'
  risk?: '低' | '中' | '高'
  contact?: string
  notes?: string
  lastUpdate?: string
  preferences?: {
    habits: string[]
    activities: string[]
    communication: string[]
    recentChanges: string[]
    attention: string[]
  }
}

export interface Task {
  elderName?: string
  bedLabel?: string
  scheduledAt?: string
  id: string
  elderId: string
  title: string
  shift: string
  assignee: string
  status: TaskStatus
  dueAt: string
  result?: string
  itemId?: string
  executionAt?: string
  deadlineAt?: string
  bedSnapshot?: string
  shiftName?: string
  source?: 'demo' | 'record' | 'plan' | 'manual'
  contentType?: 'routine_hint' | 'one_off_reminder' | 'followup_task'
  scene?: 'bathing' | 'activity' | 'rest' | 'dining' | 'communication' | 'other'
  sourceRecordId?: string
  nameSnapshot?: string
  assigneeName?: string
}

export interface DemoRecord {
  id: string
  elderId: string
  title: string
  content: string
  category: '本人表达' | '护理观察' | '家属补充'
  happenedAt: string
  enteredAt: string
  actor: string
  familyVisible: boolean
}

export interface RecordDraft {
  id: string
  elderId: string
  originalText: string
  fields: { observation: string; followUp: string; contactTarget: string }
  evidence: string[]
  warnings: string[]
  status: AiDraftStatus
  provider?: string
  demoEpoch?: string
  taskCandidates?: { title: string; [key: string]: unknown }[]
}

export interface HandoverItem {
  id: string
  title: string
  detail: string
  status: '待接收' | '已接收' | '需澄清'
  owner: string
  receivedAt?: string
  itemId?: string
  receiverId?: string
  receivedBy?: string
  note?: string
  demoEpoch?: string
}

export interface FamilyCase {
  id: string
  elderId: string
  subject: string
  status: FamilyCaseStatus
  reply?: string
  public: boolean
}

export interface TimelineEvent {
  id: string
  label: string
  detail: string
  actor: string
  happenedAt: string | null
  enteredAt: string | null
  recordedAt?: string | null
  itemId?: string
  source?: 'demo'
}
