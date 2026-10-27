import { businessDay } from './business-time'
import { buildWangRecords, buildWangMemories, historicalWangTasks, offsetDemoDay, type DemoPlan, type DemoMemory, type DemoMemoryReview, type DemoOriginal } from './demo-sample'
export type { DemoPlan } from './demo-sample'
import type {
  Elder,
  DemoRecord,
  FamilyCase,
  HandoverItem,
  RecordDraft,
  Task,
  TimelineEvent,
} from './types'

export interface DemoState {
  batchId: string
  demoDay: string
  assessments: Array<{ id: string; elderId: string; status: 'valid'; assessedAt: string; summary: string }>
  plans: DemoPlan[]
  memories: DemoMemory[]
  memoryReviews: DemoMemoryReview[]
  originals: DemoOriginal[]
  elders: Elder[]
  tasks: Task[]
  drafts: RecordDraft[]
  records: DemoRecord[]
  handover: HandoverItem[]
  familyCases: FamilyCase[]
  timeline: TimelineEvent[]
  notifications: string[]
}

export const DEMO_BATCH_ID = 'wang-2026-10-27-v2'
const iso = (day: string, time: string) => `${day}T${time}+08:00`

export function createInitialDemoState(): DemoState {
  const elderId = 'elder-wang-101'
  const DEMO_DAY = businessDay()
  const records = buildWangRecords(DEMO_DAY)
  return {
    batchId: DEMO_BATCH_ID,
    demoDay: DEMO_DAY,
    originals: [],
    assessments: [{ id: 'assessment-wang-1', elderId, status: 'valid', assessedAt: iso(offsetDemoDay(DEMO_DAY, -7), '10:00:00'), summary: '演示评估：沟通时先说明、询问意愿；活动由本人选择。' }],
    plans: [{ id: 'plan-wang-1', elderId, assessmentId: 'assessment-wang-1', status: 'active', confirmedBy: '演示护理主管', confirmedAt: iso(offsetDemoDay(DEMO_DAY, -6), '11:00:00'), items: [{ title: '询问并安排听戏活动', executionAt: iso(DEMO_DAY, '15:00:00'), deadlineAt: iso(DEMO_DAY, '16:00:00'), assignee: '小王', shiftName: '午班' }] }],
    memories: buildWangMemories(records, DEMO_DAY),
    memoryReviews: [{ id: 'review-wang-1', elderId, memoryId: 'memory-wang-2', itemId: 'item-wang-listen', status: 'pending', description: '本次想先休息，需核对本次意愿；一次拒绝不代表长期听戏偏好变化。', revision: 1 }],
    elders: [
      {
        id: elderId,
        name: '王爷爷',
        bedLabel: '101房·1床',
        age: 82,
        status: '入住',
        risk: '低',
        contact: '女儿：王女士（已授权查看生活动态）',
        notes: '安排活动前先询问本人意愿；涉及音量时保持较低。',
        lastUpdate: iso(offsetDemoDay(DEMO_DAY, -1), '15:20:00'),
        preferences: {
          habits: ['午后通常希望休息，活动前先询问。'],
          activities: ['喜欢听京剧，偏好较低音量。'],
          communication: ['先说明安排，一次说一件事，再询问本人意愿。'],
          recentChanges: ['今天想休息是本次临时意愿，不作为长期安排。'],
          attention: ['当前没有已确认的高风险提醒。'],
        },
      },
    ],
    tasks: [
      ...historicalWangTasks(DEMO_DAY),
      {
        id: 'task-wang-listen',
        scene: 'activity',
        itemId: 'item-wang-listen',
        elderId,
        title: '询问并安排听戏活动',
        shift: '午班',
        shiftName: '午班',
        assignee: '小王',
        status: 'pending',
        dueAt: iso(DEMO_DAY, '16:00:00'),
        executionAt: iso(DEMO_DAY, '15:00:00'),
        deadlineAt: iso(DEMO_DAY, '16:00:00'),
        bedSnapshot: '101房·1床',
        source: 'plan',
      },
      {
        id: 'task-wang-rest',
        scene: 'rest',
        itemId: 'item-wang-rest',
        elderId,
        title: '午后询问休息意愿',
        shift: '午班',
        shiftName: '午班',
        assignee: '小王',
        status: 'completed',
        dueAt: iso(DEMO_DAY, '14:00:00'),
        executionAt: iso(DEMO_DAY, '13:30:00'),
        deadlineAt: iso(DEMO_DAY, '14:00:00'),
        bedSnapshot: '101房·1床',
        result: '王爷爷表示先休息，已按本人意愿调整活动时间。',
        source: 'record',
      },
      {
        id: 'task-wang-followup',
        scene: 'activity',
        itemId: 'item-wang-followup',
        elderId,
        title: '复查听戏安排后的感受',
        shift: '晚班',
        shiftName: '晚班',
        assignee: '小李',
        status: 'pending',
        dueAt: iso(DEMO_DAY, '19:30:00'),
        executionAt: iso(DEMO_DAY, '19:00:00'),
        deadlineAt: iso(DEMO_DAY, '19:30:00'),
        bedSnapshot: '101房·1床',
        source: 'plan',
      },
      {
        id: 'task-wang-meal',
        scene: 'dining',
        itemId: 'item-wang-meal',
        elderId,
        title: '记录晚餐后的进食情况',
        shift: '晚班',
        shiftName: '晚班',
        assignee: '小陈',
        status: 'in_progress',
        dueAt: iso(DEMO_DAY, '20:00:00'),
        executionAt: iso(DEMO_DAY, '19:30:00'),
        deadlineAt: iso(DEMO_DAY, '20:00:00'),
        bedSnapshot: '101房·1床',
        source: 'manual',
      },
      {
        id: 'task-wang-next-day', itemId: 'item-wang-next-day', elderId,
        title: '明早询问当天活动意愿', shift: '早班', shiftName: '早班', assignee: '小王', status: 'pending',
        executionAt: iso(offsetDemoDay(DEMO_DAY, 1), '09:00:00'), dueAt: iso(offsetDemoDay(DEMO_DAY, 1), '09:30:00'), deadlineAt: iso(offsetDemoDay(DEMO_DAY, 1), '09:30:00'),
        bedSnapshot: '101房·1床', source: 'manual', scene: 'communication',
      },
    ],
    drafts: [
      {
        id: 'draft-wang-001',
        elderId,
        originalText: '今天想休息，下午活动前先问我，声音小一点。',
        fields: {
          observation: '王爷爷今天想休息，活动前需要先询问，听戏时保持较低音量',
          followUp: '下午活动前询问本人意愿',
          contactTarget: '',
        },
        evidence: ['今天想休息', '下午活动前先问我', '声音小一点'],
        warnings: ['“今天想休息”属于临时意愿，确认后不会改写长期偏好。'],
        status: 'pending_review',
      },
    ],
    records,
    handover: [
      {
        id: 'handover-wang-1',
        itemId: 'item-wang-followup',
        title: '听戏安排待晚班复查',
        detail: '午班已确认先询问本人意愿，晚班请复查听戏后的感受并记录。',
        status: '待接收',
        owner: '小李',
      },
    ],
    familyCases: [
      {
        id: 'case-wang-1',
        elderId,
        subject: '今日生活近况',
        status: 'replied',
        reply: '王爷爷今天午后选择先休息，活动安排会先征求本人意愿。',
        public: true,
      },
    ],
    timeline: [
      {
        id: 'event-wang-1',
        itemId: 'item-wang-listen',
        label: '发现',
        detail: '王爷爷表示下午想先休息，活动前需要先询问。',
        actor: '小王',
        happenedAt: records[36].happenedAt,
        enteredAt: records[36].enteredAt,
        source: 'demo',
      },
      {
        id: 'event-wang-2',
        itemId: 'item-wang-listen',
        label: 'AI草稿',
        detail: '整理出临时意愿和低音量偏好候选，等待人工核对。',
        actor: '系统整理',
        happenedAt: records[36].enteredAt,
        enteredAt: records[36].enteredAt,
        source: 'demo',
      },
      {
        id: 'event-wang-3',
        itemId: 'item-wang-listen',
        label: '待确认',
        detail: '人工核对后才会形成正式记录和后续任务。',
        actor: '待处理',
        happenedAt: records[36].enteredAt,
        enteredAt: records[36].enteredAt,
        source: 'demo',
      },
    ],
    notifications: ['演示资料均为虚构，AI整理结果仅供核对，正式记录必须人工确认。'],
  }
}
