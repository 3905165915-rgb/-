import { updateDemoState, type DemoStateV2 } from './demo-store'
import { readSession } from './session'

function manager(session = readSession()) {
  if (session?.mode !== 'demo' || !session.accountKey || !['admin', 'supervisor'].includes(session.role || ''))
    throw new Error('请由护理主管或管理员核对')
  return session
}
export function decideMemory(state: DemoStateV2, id: string, revision: number, action: 'confirm' | 'reject', content: string, session = readSession()) {
  const current = manager(session)
  const memory = state.memories.find(m => m.id === id)
  if (!memory || memory.revision !== revision || memory.status !== 'candidate') throw new Error('内容已变化，请刷新后重新核对')
  if (!content.trim()) throw new Error('请填写核对后的内容')
  if (memory.kind === 'temporary' && (!memory.expiresAt || Date.parse(memory.expiresAt) <= Date.now())) throw new Error('临时意愿已过期，请重新询问本人')
  if (!memory.sourceRecordIds.length || memory.sourceRecordIds.some(source => !state.records.some(r => r.id === source && r.elderId === memory.elderId && r.content.includes(memory.quote))))
    throw new Error('原文依据已变化，请重新核对')
  memory.content = content.trim()
  memory.status = action === 'confirm' ? 'confirmed' : 'rejected'
  memory.revision++
  memory.confirmedBy = current.accountKey
  memory.confirmedAt = new Date().toISOString()
  memory.history.push({ content: memory.content, action: action === 'confirm' ? '人工确认' : '暂不采用', actor: current.accountKey, at: memory.confirmedAt })
}
export function handleMemoryReview(state: DemoStateV2, id: string, revision: number, action: 'submit' | 'approve' | 'return', note: string, session = readSession()) {
  const current = manager(session)
  const review = state.memoryReviews.find(r => r.id === id)
  if (!review || review.revision !== revision) throw new Error('核验进度已变化，请刷新后重试')
  if (!note.trim()) throw new Error('请填写本次核对情况')
  if (action === 'submit' && review.status !== 'pending') throw new Error('当前不在待处理阶段')
  if (action !== 'submit' && (review.status !== 'awaiting_review' || review.submittedBy === current.accountKey))
    throw new Error('需由另一位主管或管理员独立复查')
  const at = new Date().toISOString()
  if (action === 'submit') { review.status = 'awaiting_review'; review.submittedBy = current.accountKey; review.submittedAt = at }
  else if (action === 'approve') { review.status = 'closed'; review.reviewedBy = current.accountKey; review.reviewedAt = at }
  else { review.status = 'pending'; review.reviewedBy = current.accountKey; review.reviewedAt = at }
  review.note = note.trim()
  review.revision++
  state.timeline.push({ id: `event-${crypto.randomUUID()}`, itemId: review.itemId, source: 'demo', label: action === 'submit' ? '提交核对' : action === 'approve' ? '独立复查完成' : '复查退回', detail: review.note, actor: current.accountKey, happenedAt: at, enteredAt: at })
}
export async function saveMemoryDecision(epoch: string, id: string, revision: number, action: 'confirm' | 'reject', content: string) {
  const actor = manager()
  return updateDemoState(epoch, state => {
    const latest = manager()
    if (latest.accountKey !== actor.accountKey || latest.role !== actor.role) throw new Error('登录身份已变化，请重新核对')
    decideMemory(state, id, revision, action, content, latest)
  })
}
export async function saveMemoryReview(epoch: string, id: string, revision: number, action: 'submit' | 'approve' | 'return', note: string) {
  const actor = manager()
  return updateDemoState(epoch, state => {
    const latest = manager()
    if (latest.accountKey !== actor.accountKey || latest.role !== actor.role) throw new Error('登录身份已变化，请重新核对')
    handleMemoryReview(state, id, revision, action, note, latest)
  })
}
