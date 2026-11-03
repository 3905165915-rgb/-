import { businessDay } from './business-time'
import type { DemoRecord, Task } from './types'

export interface DemoPlan {
  id: string; elderId: string; assessmentId: string; status: 'active'; confirmedBy: string; confirmedAt: string
  items: Array<{ title: string; executionAt: string; deadlineAt: string; assignee: string; shiftName: string }>
}
export interface DemoMemory {
  id: string; elderId: string; group: 'habits' | 'activities' | 'communication' | 'recentChanges' | 'attention'
  content: string; kind: 'stable' | 'temporary'; status: 'candidate' | 'confirmed' | 'rejected'
  sourceRecordIds: string[]; quote: string; revision: number; confirmedBy?: string; confirmedAt?: string; expiresAt?: string
  history: Array<{ content: string; action: string; actor: string; at: string }>
}
export interface DemoMemoryReview {
  id: string; elderId: string; memoryId: string; itemId: string
  status: 'pending' | 'awaiting_review' | 'closed'; description: string; revision: number
  submittedBy?: string; submittedAt?: string; reviewedBy?: string; reviewedAt?: string; note?: string
}
export interface DemoOriginal {
  id: string; elderId: string; text: string; localId: string; sourceRevision: number
  savedAt: string; status: 'waiting' | 'completed' | 'failed'; draftId?: string; error?: string
}
export function offsetDemoDay(day: string, offset: number) {
  return businessDay(Date.parse(`${day}T12:00:00+08:00`) + offset * 86400000)
}
export function buildWangRecords(day: string): DemoRecord[] {
  // Each row is a distinct fictional source, not a statistical claim about real care.
  const rows: Array<[string, DemoRecord['category'], string]> = [
    ['喜欢听京剧，音量希望低一些。', '本人表达', '活动喜好'],
    ['初次沟通先说明洗漱安排，王爷爷表示听清楚了。', '护理观察', '沟通方式'],
    ['家属补充：父亲熟悉京剧老唱段，轻声播放更容易放松。', '家属补充', '生活支持'],
    ['午饭后我想安静休息一会儿，活动前先问我。', '本人表达', '生活习惯'],
    ['一次说明一项安排，王爷爷可以复述并表达选择。', '护理观察', '沟通方式'],
    ['上午洗漱后在窗边坐了一会儿，未表达不适。', '护理观察', '日常状态'],
    ['今天愿意听一小段熟悉的京剧，声音再低一点。', '本人表达', '活动喜好'],
    ['家属确认午后休息是以往习惯，仍应每天询问本人。', '家属补充', '生活支持'],
    ['午餐后先询问休息意愿，王爷爷选择在房间休息。', '护理观察', '生活习惯'],
    ['晚间交谈时精神平稳，能清楚表达想法。', '护理观察', '日常状态'],
    ['先告诉我要做什么，别一次说太多。', '本人表达', '沟通方式'],
    ['按本人意愿播放短段京剧，结束后询问是否继续，选择暂停。', '护理观察', '活动记录'],
    ['家属愿意补充熟悉的唱段名称供本人选择。', '家属补充', '家属沟通'],
    ['今日午餐进食大半，询问后表示没有新的不适。', '护理观察', '饮食观察'],
    ['今天下午先休息，晚一点再说听戏的事。', '本人表达', '临时意愿'],
    ['先休息后再次征询意愿，王爷爷愿意听五分钟。', '护理观察', '活动记录'],
    ['家属询问生活近况，护理员说明仅分享已授权内容。', '家属补充', '家属沟通'],
    ['上午愿意在陪同下到走廊看看，结束后返回休息。', '护理观察', '日常状态'],
    ['这段唱腔我熟悉，可以继续小声放。', '本人表达', '活动喜好'],
    ['沟通时停顿等待回答，王爷爷能表达是否愿意。', '护理观察', '沟通方式'],
    ['午后按意愿安静休息，未安排未经确认的活动。', '护理观察', '生活习惯'],
    ['女儿补充父亲喜欢自己决定是否参加活动。', '家属补充', '生活支持'],
    ['今天不想听，想先睡一会儿。', '本人表达', '临时意愿'],
    ['已记录当日休息选择，保留既有听戏偏好并继续询问。', '护理观察', '偏好核对'],
    ['次日询问后愿意听戏，未把昨日拒绝当作长期变化。', '护理观察', '偏好核对'],
    ['家属认可先问本人意愿的方式，不替本人作当日决定。', '家属补充', '家属沟通'],
    ['活动前说明安排和时长，王爷爷选择听短段。', '护理观察', '活动记录'],
    ['我想听熟悉的，音量别太大。', '本人表达', '活动喜好'],
    ['午餐后询问是否休息，表示先安静坐一会儿。', '护理观察', '生活习惯'],
    ['晚间交班说明先问意愿和低音量沟通要点。', '护理观察', '交班观察'],
    ['家属补充近期沟通平稳，希望继续分享审核后的动态。', '家属补充', '家属沟通'],
    ['今日上午用一句话说明服务，再等待王爷爷回答。', '护理观察', '沟通方式'],
    ['你先说清楚，我想一想再答。', '本人表达', '沟通方式'],
    ['经本人选择低音量听戏，结束后表示可以了。', '护理观察', '活动记录'],
    ['午后先休息，醒来后再征询活动意愿。', '护理观察', '生活习惯'],
    ['家属提供一段熟悉唱段名称，尚未安排播放。', '家属补充', '生活支持'],
    ['今天想休息，下午活动前先问我，声音小一点。', '本人表达', '临时意愿'],
    ['已将本次休息表达列为临时意愿，等待复核，没有覆盖长期习惯。', '护理观察', '偏好核对'],
    ['晚班接续事项为询问听戏后的感受，需记录实际回答。', '护理观察', '交班观察'],
    ['家属了解最近生活安排，支持继续征询王爷爷当日意愿。', '家属补充', '家属沟通'],
  ]
  return rows.map(([content, category, title], index) => {
    // The temporary wish is expressed today; yesterday's "today" must expire.
    const offset = 29 - Math.floor(index * 28 / 39)
    const at = index === 36 && businessDay() === day ? new Date().toISOString() : `${offsetDemoDay(day, -offset)}T${index % 2 ? '15:20' : '09:20'}:00+08:00`
    return { id: `record-wang-${String(index + 1).padStart(2, '0')}`, elderId: 'elder-wang-101', title, content, category,
      happenedAt: at, enteredAt: at, actor: category === '本人表达' ? '王爷爷' : category === '家属补充' ? '王女士' : '小王',
      familyVisible: category === '本人表达' || (category === '护理观察' && ['活动记录', '日常状态'].includes(title)) }
  })
}
export function buildWangMemories(records: DemoRecord[], day: string): DemoMemory[] {
  const rows: Array<[DemoMemory['group'], string, number, DemoMemory['kind'], DemoMemory['status']]> = [
    ['habits', '午后通常希望休息，活动前先询问。', 3, 'stable', 'confirmed'],
    ['activities', '喜欢听京剧，偏好较低音量。', 0, 'stable', 'confirmed'],
    ['communication', '先说明安排，一次说一件事，再询问本人意愿。', 10, 'stable', 'confirmed'],
    ['recentChanges', '本次想先休息，活动前需要重新询问。', 36, 'temporary', 'candidate'],
    ['attention', '先等待本人回答，不替本人决定当次活动。', 32, 'stable', 'candidate'],
  ]
  return rows.map(([group, content, index, kind, status], n) => ({
    id: `memory-wang-${n + 1}`, elderId: 'elder-wang-101', group, content, kind, status,
    sourceRecordIds: [records[index].id], quote: records[index].content, revision: 1,
    ...(status === 'confirmed' ? { confirmedBy: '小王', confirmedAt: records[index].enteredAt } : {}),
    ...(kind === 'temporary' ? { expiresAt: `${offsetDemoDay(day, 1)}T00:00:00+08:00` } : {}),
    history: [{ content, action: status === 'confirmed' ? '人工确认' : '整理为候选', actor: status === 'confirmed' ? '小王' : '系统整理', at: records[index].enteredAt }],
  }))
}
export function historicalWangTasks(day: string): Task[] {
  return Array.from({ length: 6 }, (_, i) => {
    const taskDay = offsetDemoDay(day, -(i + 1))
    return { id: `task-wang-history-${i + 1}`, itemId: `item-wang-history-${i + 1}`, elderId: 'elder-wang-101',
      title: '询问并记录当日活动意愿', shift: '午班', shiftName: '午班', assignee: '小王', bedSnapshot: '101房·1床',
      status: i === 2 ? 'not_done' : 'completed', result: i === 2 ? '本人选择休息，已登记未执行原因。' : '已询问并按本人意愿安排。',
      executionAt: `${taskDay}T15:00:00+08:00`, dueAt: `${taskDay}T16:00:00+08:00`, deadlineAt: `${taskDay}T16:00:00+08:00`, source: 'plan' }
  })
}
