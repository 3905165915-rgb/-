import { loadDemoState } from '../demo-store'
import type { FamilyFeed, FamilyInsight, FamilyMember, FamilyMessage } from './family-life'

// Family-only synthetic stories; the shared care seed stays unchanged.
const messages = new Map<string, FamilyMessage[]>()
export async function demoFamilyMembers(): Promise<FamilyMember[]> {
  const first = (await loadDemoState()).elders[0]
  return [
    { id: 'family-wang', elder_id: first?.id || 'elder-wang', elder_name: first?.name || '王阿姨' },
    { id: 'family-li', elder_id: 'elder-family-li', elder_name: '李爷爷' },
  ].map(row => ({ ...row, admission_id: `admission-${row.id}`, scopes: ['summary', 'feedback'], expires_at: new Date(Date.now() + 86400000).toISOString() }))
}
export function demoFamilyFeed(member: FamilyMember): FamilyFeed {
  const wang = member.id === 'family-wang'
  const stories = wang ? [
    ['午后的院子', '午后的活动时段，王阿姨在工作人员陪同下到院子里坐了坐，和大家聊起家乡的小院。回房后听了一会儿喜欢的戏曲。'],
    ['一段熟悉的旋律', '另一次活动时间，王阿姨选择听戏曲，跟着熟悉的段落轻轻哼唱。工作人员记下了她希望活动音量小一些的想法。'],
    ['把心意带到身边', '家属送来的相册已交到王阿姨手中。她翻看了几张旧照片，并请工作人员把相册放在床头方便拿取的位置。'],
  ] : [
    ['今天的小故事', '下午的活动时段，李爷爷和同伴下了一会儿棋，随后选择在窗边休息。工作人员已把棋盘收在他熟悉的位置。'],
    ['按照自己的节奏', '上午的活动时段，李爷爷选择在院内慢慢散步。工作人员陪同完成活动后，询问了他下次希望参加的活动。'],
  ]
  const items = stories.map(([title, text], index) => {
    const end = new Date(); end.setHours(16, 0, 0, 0)
    if (end.getTime() > Date.now()) end.setDate(end.getDate() - 1)
    end.setDate(end.getDate() - index)
    const start = new Date(end.getTime() - 3600000)
    return { id: `${member.id}-story-${index + 1}`, elder_id: member.elder_id, title: title!, text: text!,
      happened_at: end.toISOString(), period_start: start.toISOString(), period_end: end.toISOString(), published_at: end.toISOString(), kind: 'published_summary' as const,
      photos: wang && index === 0 ? [{ id: 'family-photo', caption: '演示配图，非本人照片', occurred_at: start.toISOString(), content_path: `/family/me/bindings/${member.id}/photos/family-photo/content` }] : [],
    }
  })
  return { elder_id: member.elder_id, elder_name: member.elder_name, items, total: items.length }
}
export function demoFamilyInsight(feed: FamilyFeed): FamilyInsight {
  return { elder_id: feed.elder_id, model_status: 'demo', points: feed.items.slice(0, 2).map(item => ({ text: item.text, citations: [{ source_id: item.id, quote: item.text }] })) }
}
export function demoFamilyMessages(member: FamilyMember) { return [...(messages.get(member.id) || [])] }
export function demoFamilySend(member: FamilyMember, text: string, key: string): FamilyMessage {
  const rows = messages.get(member.id) || [], old = rows.find(row => row.id === key)
  if (old) return old
  const row: FamilyMessage = { id: key, binding_id: member.id, elder_id: member.elder_id, text, status: 'open', created_at: new Date().toISOString(), reply: null, replied_at: null }
  messages.set(member.id, [row, ...rows]); return row
}
