import type { Row } from './model'
export const elderReactions = {
  accepted: '愿意接受',
  declined: '明确拒绝',
  unclear: '无法判断',
  not_obtained: '尚未获得反馈',
}
export function withTaskFeedback(body: Row): Row {
  const feedback = body._care_feedback as Row | undefined
  if (feedback?.enabled !== true) return body
  if (!Object.hasOwn(elderReactions, String(feedback.reaction)))
    throw new Error('请明确选择本人反应，未获得反馈也可如实登记。')
  if (typeof feedback.facts !== 'string' || !feedback.facts.trim())
    throw new Error('请填写实际执行情况、观察事实或本人原话。')
  const lines = [
    '【执行情况】已完成本任务要求',
    `【本人反应】${elderReactions[feedback.reaction as keyof typeof elderReactions]}`,
    `【观察事实或原话】${feedback.facts.trim()}`,
    '【照护效果】尚不能判断；本次完成不等于建议有效',
  ]
  if (typeof feedback.followup === 'string' && feedback.followup.trim())
    lines.push(`【后续关注记录，尚未安排任务】${feedback.followup.trim()}`)
  return { ...body, result: lines.join('\n') }
}
