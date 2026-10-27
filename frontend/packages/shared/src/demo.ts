import type {
  Elder,
  FamilyCase,
  HandoverItem,
  RecordDraft,
  Task,
  TimelineEvent,
} from './types'

export interface DemoState {
  elders: Elder[]
  tasks: Task[]
  drafts: RecordDraft[]
  handover: HandoverItem[]
  familyCases: FamilyCase[]
  timeline: TimelineEvent[]
  notifications: string[]
}

export function createInitialDemoState(): DemoState {
  return {
    elders: [
      {
        id: 'elder-101-wang',
        name: '王爷爷',
        bedLabel: '101房·1床',
        age: 78,
        status: '入住',
        risk: '中',
        contact: '女儿：王女士 138****5201',
        notes: '关注进食量，晚餐不足时联系家属。',
        lastUpdate: '今天 12:30',
      },
    ],
    tasks: [
      {
        id: 'task-101-meal',
        elderId: 'elder-101-wang',
        title: '记录午餐进食观察',
        shift: '早班',
        assignee: '李护理',
        status: 'pending',
        dueAt: '今天 14:00',
      },
      {
        id: 'task-101-family',
        elderId: 'elder-101-wang',
        title: '晚餐不足时联系女儿',
        shift: '晚班',
        assignee: '待分派',
        status: 'pending',
        dueAt: '今天 19:30',
      },
    ],
    drafts: [
      {
        id: 'draft-101-001',
        elderId: 'elder-101-wang',
        originalText: '午餐只吃一半，晚上联系女儿。',
        fields: {
          observation: '午餐进食量约一半',
          followUp: '晚餐仍不足时联系家属',
          contactTarget: '女儿',
        },
        evidence: ['午餐只吃一半', '晚上联系女儿'],
        warnings: ['“晚上”未提供具体时间，需人工确认。'],
        status: 'pending_review',
      },
    ],
    handover: [
      {
        id: 'handover-101-1',
        title: '王爷爷进食观察',
        detail: '午餐约半量，晚餐不足时联系女儿。',
        status: '待接收',
        owner: '晚班护理员',
      },
    ],
    familyCases: [
      {
        id: 'case-101-1',
        elderId: 'elder-101-wang',
        subject: '想了解今日进食情况',
        status: 'replied',
        reply: '午餐已完成记录，晚餐情况将在审核后更新。',
        public: true,
      },
    ],
    timeline: [
      {
        id: 'event-1',
        label: '发现',
        detail: '护理员记录午餐进食约半量。',
        actor: '李护理',
        happenedAt: '今天 12:30',
        enteredAt: '今天 12:31',
      },
      {
        id: 'event-2',
        label: 'AI草稿',
        detail: '提取进食观察和家属沟通候选。',
        actor: 'AI草稿',
        happenedAt: '今天 12:31',
        enteredAt: '今天 12:31',
      },
      {
        id: 'event-3',
        label: '待确认',
        detail: '人工确认后才生成正式记录和任务。',
        actor: '待处理',
        happenedAt: '今天 12:31',
        enteredAt: '今天 12:31',
      },
    ],
    notifications: ['演示数据：AI草稿仅供核对，正式记录必须人工确认。'],
  }
}
