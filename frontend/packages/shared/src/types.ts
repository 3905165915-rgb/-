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
}

export interface Task {
  id: string
  elderId: string
  title: string
  shift: string
  assignee: string
  status: TaskStatus
  dueAt: string
  result?: string
  itemId?: string
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
