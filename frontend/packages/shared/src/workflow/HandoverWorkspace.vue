<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WorkflowPanel from './WorkflowPanel.vue'
import WorkflowResult from './WorkflowResult.vue'
import { listAll, request, type Row } from './model'
import { object, rows, workspaceDate } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
const props = defineProps<{ mobile?:boolean; quickComposer?:boolean }>()
const route = useRoute(), router = useRouter(), scope = useWorkspaceScope()
const list = ref<Row[]>([]), shifts = ref<Row[]>([]), selected = ref<Row|null>(null)
const search = ref(''), shift = ref(''), loading = ref(false), error = ref('')
const action = ref(''), itemId = ref(''), reader = ref(false)
const panel = ref<{canClose:()=>Promise<boolean>|boolean}>()
const context = computed(() => ({...route.query, handover_id:selected.value?.id, item_id:itemId.value}))
const shown = computed(() => list.value.filter(row => (!shift.value || row.source_shift_id === shift.value || row.target_shift_id === shift.value) &&
  (!search.value.trim() || [row.summary, shiftLabel(row.source_shift_id), shiftLabel(row.target_shift_id)].join(' ').includes(search.value.trim()))))
let epoch = 0
const states:Record<string,string> = {draft:'交班草稿',submitted:'已提交待接收',received:'已接收',clarifying:'待澄清',pending:'待接收'}
function statusClass(status: unknown) {
  return `status-${String(status || 'unknown').replace(/[^a-z_]/g, '') || 'unknown'}`
}
function shiftLabel(id:unknown) {return String(shifts.value.find(row=>row.id===id)?.name || '班次信息未提供')}
async function load() {
  const ticket = ++epoch; loading.value = true; error.value = ''
  try {
    const [entries, directory] = await Promise.all([listAll('/handovers'),listAll('/shifts')])
    if (ticket !== epoch || !scope.valid()) return
    list.value = entries; shifts.value = directory
    const id = selected.value?.id || route.query.handover_id
    if (id) {
      const value = object(await request('/handovers/'+encodeURIComponent(String(id))))
      if (ticket === epoch && scope.valid()) selected.value = value
    }
  } catch(failure) {if(ticket === epoch && scope.valid())error.value=(failure as Error).message}
  finally {if(ticket === epoch)loading.value=false}
}
async function open(row:Row|null, path='', item='', read=false) {
  if (panel.value && !(await panel.value.canClose())) return
  selected.value = row; action.value = path; itemId.value = item; reader.value = read
  void router.replace({query:{...route.query,handover_id:row ? String(row.id) : undefined, action:undefined}})
}
async function changed(value?:unknown) {
  if (value && typeof value==='object' && !Array.isArray(value) && typeof (value as Row).id==='string') selected.value=value as Row
  await load()
}
watch(()=>route.query.handover_id,()=>void load(),{immediate:true})
onBeforeUnmount(()=>epoch++)
</script>
<template>
  <section v-if="scope.active.value" class="workspace-panel" aria-label="交接班工作区">
    <header><div><h1>交接班</h1><p>交班、接收和历史在同一页办理；未完成任务沿用原编号，交班不代表任务完成。</p></div><button type="button" :disabled="loading" @click="load">刷新列表</button></header>
    <slot v-if="quickComposer" name="composer" />
    <button v-else type="button" @click="open(null,'/handovers')">创建交班草稿</button>
    <p v-if="loading" role="status">正在读取交接班…</p><p v-if="error" role="alert">{{error}}</p>
    <div class="workspace-actions"><label>搜索交班内容<input v-model="search" type="search" /></label><label>班次<select v-model="shift"><option value="">全部班次</option><option v-for="entry in shifts" :key="String(entry.id)" :value="entry.id">{{entry.name}} · {{workspaceDate(entry.start_at)}}</option></select></label></div>
    <p v-if="!loading&&!error&&!shown.length">{{list.length?'没有匹配交班，请调整筛选。':'暂无交班记录，可创建交班草稿。'}}</p>
    <ul class="handover-history"><li v-for="entry in shown" :key="String(entry.id)"><button class="handover-card" type="button" @click="open(entry)"><span class="handover-route">{{shiftLabel(entry.source_shift_id)}} <b aria-hidden="true">→</b> {{shiftLabel(entry.target_shift_id)}}</span><span class="handover-meta"><span class="handover-status" :class="statusClass(entry.status)">{{states[String(entry.status)] || '状态待核实'}}</span><span>{{workspaceDate(entry.created_at)}}</span></span><span class="handover-open" aria-hidden="true">查看详情 <b>›</b></span></button></li></ul>
    <section v-if="selected" class="workspace-panel" aria-label="当前交班单">
      <h2>{{shiftLabel(selected.source_shift_id)}} → {{shiftLabel(selected.target_shift_id)}}</h2>
      <p>{{states[String(selected.status)] || '状态待核实'}} · {{workspaceDate(selected.created_at)}}</p><p>{{selected.summary || '尚未填写交班注意事项'}}</p>
      <details v-if="selected.ai_summary" open><summary>摘要草稿与原文依据（尚需人工核对）</summary><WorkflowResult :value="selected.ai_summary" /></details>
      <div v-if="selected.status==='draft'" class="workspace-actions">
        <button type="button" @click="open(selected,'/handovers/{handover_id}/refresh')">刷新来源与未完成任务</button>
        <button type="button" @click="open(selected,'/handovers/{handover_id}/ai-summary')">整理摘要草稿</button>
        <button type="button" @click="open(selected,'/handovers/{handover_id}/submit')">核对内容并提交交班</button>
      </div>
      <article v-for="item in (Array.isArray(selected.items)?rows(selected.items):[])" :key="String(item.id)" class="workspace-panel">
        <h3>{{item.title || item.snapshot_text || '接续事项'}}</h3><p>{{states[String(item.status)] || '接收状态待核实'}}</p>
        <p v-if="item.source_revision">引用来源版本：{{item.source_revision}}；刷新后仍需核对当前来源。</p>
        <div v-if="selected.status!=='draft'" class="workspace-actions">
          <button type="button" @click="open(selected,'/handovers/{handover_id}/items/{item_id}/receive',String(item.id))">接收或提出澄清</button>
          <button type="button" @click="open(selected,'/handovers/{handover_id}/items/{item_id}/clarify',String(item.id))">补充澄清说明</button>
        </div>
        <RouterLink v-if="item.task_id || (item.source_type==='task' && item.source_id)" :to="props.mobile ? '/tasks/'+encodeURIComponent(String(item.task_id || item.source_id)) : {path:'/tasks',query:{task:String(item.task_id || item.source_id)}}">查看原任务</RouterLink>
      </article>
    </section>
    <WorkflowPanel v-if="action" ref="panel" :key="String(selected?.id || 'new')+':'+action+':'+itemId" group="handovers" :context="context" :initial-action="action" :auto-read="reader" focused @changed="changed" />
  </section>
</template>
<style scoped>
.handover-history{display:grid;gap:12px;list-style:none;padding:0;margin:16px 0 0}
.handover-history li{min-width:0}
.handover-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:100%;min-height:78px;padding:16px 48px 14px 18px;border:1px solid rgba(78,122,117,.18);border-radius:16px;background:linear-gradient(135deg,rgba(255,255,255,.92),rgba(239,248,245,.82));box-shadow:0 6px 18px rgba(42,91,84,.08);color:#204c49;text-align:left;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background .18s ease}
.handover-card:hover{transform:translateY(-2px);border-color:rgba(39,145,127,.45);box-shadow:0 10px 24px rgba(42,91,84,.15);background:linear-gradient(135deg,#fff,rgba(232,248,242,.95))}
.handover-card:focus-visible{outline:3px solid rgba(40,154,132,.3);outline-offset:3px}
.handover-route{font-size:16px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}
.handover-route b{padding:0 5px;color:#2a9a82;font-size:19px}
.handover-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;color:#728b88;font-size:12px}
.handover-status{padding:4px 9px;border-radius:999px;font-weight:700;background:#edf1f2;color:#607270}
.handover-status.status-draft{background:#fff4df;color:#a36b18}.handover-status.status-submitted,.handover-status.status-pending{background:#e6f3f0;color:#147b6c}.handover-status.status-received{background:#e8f4ed;color:#25734e}.handover-status.status-clarifying{background:#fce9e7;color:#b34e43}
.handover-open{position:absolute;right:16px;bottom:14px;color:#238b78;font-size:12px;font-weight:700}.handover-open b{font-size:20px;line-height:10px;vertical-align:-2px}
@media (max-width:600px){.handover-card{padding:14px 42px 13px 14px;border-radius:14px}.handover-route{font-size:15px}.handover-meta{font-size:11px}.handover-open{right:13px;bottom:12px}}
</style>
