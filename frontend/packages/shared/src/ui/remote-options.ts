import { shallowRef } from 'vue'
import type { FrontendSession } from '../session'
import { sameCareSession } from '../workflow/task-care-context'
export type OptionKind = 'elders' | 'staff' | 'shifts' | 'incidents'
export interface OptionScope { elder_id?: unknown; shift_id?: unknown; status?: unknown }
export interface OptionRow extends Record<string, unknown> { id: string; label: string }
export interface RemoteOptionState { items: OptionRow[]; total: number; loading: boolean; error: string }
export function optionLabel(row: OptionRow, kind: OptionKind): string {
  if (kind === 'elders') return [row.label, row.bed_label, row.state_label].filter(Boolean).join(' · ')
  if (kind === 'staff') return [row.label, ({ admin: '管理员', supervisor: '主管', caregiver: '护理员', nurse: '护士' } as Record<string, string>)[String(row.role)]].filter(Boolean).join(' · ')
  if (kind === 'incidents') return [row.label, row.elder_name, row.state_label, row.severity_label].filter(Boolean).join(' · ')
  return [row.label, row.state_label].filter(Boolean).join(' · ')
}
export function createRemoteOptions(deps: { request: (path: string) => Promise<unknown>; session: () => FrontendSession | null }) {
  const state = shallowRef<RemoteOptionState>({ items: [], total: 0, loading: false, error: '' })
  let epoch = 0
  let context: { kind: OptionKind; query: string; scope: OptionScope; owner: FrontendSession } | null = null
  const reset = () => { epoch++; context = null; state.value = { items: [], total: 0, loading: false, error: '' } }
  async function load(kind: OptionKind, query = '', scope: OptionScope = {}, append = false) {
    const owner = deps.session()
    if (!owner?.accessToken || owner.mode !== 'api') { reset(); return }
    const ticket = ++epoch, offset = append ? state.value.items.length : 0
    const previous = append ? state.value.items : []
    context = { kind, query, scope, owner }
    state.value = { items: previous, total: append ? state.value.total : 0, loading: true, error: '' }
    const params = new URLSearchParams({ q: query.trim().slice(0, 100), limit: '50', offset: String(offset) })
    for (const key of ['elder_id', 'shift_id', 'status'] as const) if (typeof scope[key] === 'string' && scope[key]) params.set(key, scope[key])
    try {
      const data = await deps.request(`/options/${kind}?${params}`)
      if (ticket !== epoch) return
      if (!sameCareSession(owner, deps.session())) { reset(); return }
      if (!data || typeof data !== 'object') throw new Error('选项返回格式异常，请重试。')
      const page = data as Record<string, unknown>
      if (!Array.isArray(page.items) || !Number.isInteger(page.total) || Number(page.total) < 0 || page.limit !== 50 || page.offset !== offset || page.items.some(row => !row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.label !== 'string')) throw new Error('选项返回格式异常，请重试。')
      const items = new Map([...previous, ...page.items as OptionRow[]].map(row => [row.id, row]))
      state.value = { items: [...items.values()], total: Number(page.total), loading: false, error: '' }
    } catch (failure) {
      if (ticket !== epoch) return
      if (!sameCareSession(owner, deps.session())) { reset(); return }
      state.value = { items: previous, total: append ? state.value.total : 0, loading: false, error: failure instanceof Error ? failure.message : '选项暂未读取，请重试。' }
    }
  }
  function more() {
    if (!context || state.value.loading || state.value.items.length >= state.value.total) return
    if (!sameCareSession(context.owner, deps.session())) { reset(); return }
    return load(context.kind, context.query, context.scope, true)
  }
  return { state, load, more, reset }
}
