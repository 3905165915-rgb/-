<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { request, type Row } from './model'
import { object, rows, workspaceDate, useWorkspaceAction } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import WorkflowPanel from './WorkflowPanel.vue'
import CareSafety from './CareSafety.vue'
const props=defineProps<{ elderId?: string; mobile?: boolean }>()
const route=useRoute(), scope=useWorkspaceScope()
const items=ref<Row[]>([]), state=ref('pending'), selected=ref<Row|null>(null), error=ref(''), loading=ref(false)
const replay=ref<Row[]>([]), replayError=ref('')
const checkResult=ref<Row|null>(null)
const checkAction=useWorkspaceAction(() => props.elderId || '', 'check-today')
async function checkToday(kind?: string) {
  if (!props.elderId) return
  const validate=(value:unknown)=>{const result=object(value);if(!Array.isArray(result.checks))throw new Error('检查回执不完整，请重试原操作。');return result}
  const previous=checkResult.value
  const result=checkAction.pending.value ? await checkAction.retry(validate) : await checkAction.submit('/elders/'+encodeURIComponent(props.elderId)+'/followups/check-today',kind ? {kinds:[kind]} : {},validate)
  if (result) {
    const checks=rows(result.checks)
    checkResult.value={...result,checks:[...rows(previous?.checks || []).filter(old=>!checks.some(current=>current.kind===old.kind)),...checks]}
  }
  await load()
}

async function loadReplay(event: Event, item: Row) {
  if (!(event.target as HTMLDetailsElement).open) return
  const ticket=epoch
  replay.value=[];replayError.value=''
  const subject=item.kind==='quality'?object(item.context).report_id:item.object_id
  try {
    const result=rows(await request('/items/'+encodeURIComponent(String(subject))+'/timeline'))
    if(ticket===epoch&&selected.value?.id===item.id)replay.value=result
  } catch(failure) { if(ticket===epoch) replayError.value=(failure as Error).message }
}
const visible=computed(()=>items.value.filter(r=>r.state===state.value))
const states=[{key:'pending',label:'待处理'},{key:'review',label:'待复查'},{key:'closed',label:'已处理'}]
let epoch=0
async function load(){
  const ticket=++epoch;loading.value=true;error.value=''
  try{
    const result=object(await request('/followups'+(props.elderId?'?elder_id='+encodeURIComponent(props.elderId):'')))
    if(ticket!==epoch||!scope.valid())return
    items.value=rows(result.items)
    if(selected.value) selected.value=items.value.find(item=>item.id===selected.value?.id) || null
  }catch(failure){if(ticket===epoch)error.value=(failure as Error).message}
  finally{if(ticket===epoch)loading.value=false}
}
const context=computed(()=>{
  const item=selected.value;if(!item)return{}
  return { ...object(item.context || {}), elder_id:item.elder_id, elder:item.elder_id,
    incident_id:item.kind==='incident'?item.object_id:undefined,
    case_id:item.kind==='change'?item.object_id:undefined,
    report_id:item.kind==='quality'?object(item.context).report_id:undefined,
    issue_id:item.kind==='quality'?item.object_id:undefined }
})
watch(()=>props.elderId,()=>{selected.value=null;items.value=[];void load()},{immediate:true})
watch(()=>route.query,()=>{selected.value=null})
onBeforeUnmount(()=>epoch++)
</script>
<template>
  <section class="workspace-panel care-followups" aria-label="照护跟进">
    <header class="followups-header"><div><h3>照护跟进</h3><p>只显示需要下一步处理的事项。</p></div><button class="followups-refresh" type="button" :disabled="loading" @click="load">刷新</button></header>
    <button v-if="scope.management && elderId" class="followups-check" type="button" :disabled="checkAction.busy.value" @click="checkToday()">{{checkAction.pending.value?'核实上次检查':'检查今天的照护'}}</button>
    <p v-if="checkAction.error.value" role="alert">{{checkAction.error.value}}</p>
    <div v-if="checkResult?.checks?.length" class="followup-checks" aria-label="今日检查结果"><span v-for="check in (checkResult?.checks as Row[] || [])" :key="String(check.kind)" :class="check.status==='completed'?'check-ok':'check-pending'">{{check.kind==='quality'?'记录检查':'安排核对'}} · {{check.status==='completed'?'已完成':'待重试'}}<button v-if="check.status==='failed'" type="button" @click="checkToday(String(check.kind))">重试</button></span></div>
    <div class="followup-tabs" role="tablist"><button v-for="tab in states" :key="tab.key" type="button" role="tab" :aria-selected="state===tab.key" :class="{active:state===tab.key}" @click="state=tab.key;selected=null">{{ tab.label }} <b>{{ items.filter(r=>r.state===tab.key).length }}</b></button></div>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="loading" role="status">正在读取跟进事项…</p>
    <p v-if="!loading&&!error&&!visible.length">这一栏暂时没有事项。</p>
    <article v-for="item in visible" :key="String(item.id)" class="followup-item">
      <div class="followup-item-head"><div><strong>{{ item.elder_name || '当前老人' }}</strong><h4>{{ item.title }}</h4></div><span class="followup-state">{{ item.state==='review'?'待复查':'待处理' }}</span></div>
      <p class="followup-owner">{{ item.owner_name || '待安排负责人' }}<span v-if="item.due_at"> · 截止 {{ workspaceDate(item.due_at) }}</span></p>
      <p v-if="item.reason" class="followup-reason">{{ item.reason }}</p>
      <div class="followup-actions"><RouterLink v-if="item.group==='elder'" :to="{path:'/elders/'+String(item.elder_id),query:{section:String(object(item.context).section || 'understanding')}}">查看并办理</RouterLink><button v-else type="button" @click="selected=selected?.id===item.id?null:item">{{ selected?.id===item.id?'收起详情':(item.next_action || '开始处理') }}</button></div>
      <template v-if="selected?.id===item.id">
        <div class="followup-detail">
        <CareSafety focused v-if="item.state!=='closed' && item.group==='incidents'" :context="context" :initial-action="item.action_path ? String(item.action_path) : undefined" :record-path="mobile?'/records/new':'/workflows/records'" @changed="load" />
        <WorkflowPanel focused v-else-if="item.state!=='closed'" :group="String(item.group)" :context="context" :initial-action="String(item.action_path || item.path || '')" :auto-read="!item.action_path" @changed="load" />
        <details @toggle="loadReplay($event,item)"><summary>查看相关过程</summary><p v-if="replayError" role="alert">{{ replayError }}</p><ol><li v-for="event in replay" :key="String(event.id)"><strong>{{ event.label }}</strong> · {{ event.actor }}<p>登记 {{ workspaceDate(event.recorded_at) }}<span v-if="event.happened_at"> · 发生 {{ workspaceDate(event.happened_at) }}</span></p><p>{{ event.detail }}</p></li></ol></details>
        </div>
      </template>
    </article>
    <details v-if="scope.management && !mobile"><summary>检查与核对工具</summary>
      <RouterLink :to="{path:'/quality',query:{elder:elderId}}">记录质量检查</RouterLink> ·
      <RouterLink :to="{path:'/coverage',query:{elder:elderId}}">计划执行核对</RouterLink> ·
      <RouterLink :to="{path:'/changes',query:{elder:elderId}}">变更核验</RouterLink>
    </details>
    <RouterLink :to="mobile?'/safety?report=1':{path:'/workflows/incidents',query:{report:'1',elder:elderId}}">上报照护安全情况</RouterLink>
  </section>
</template>
<style scoped>
.care-followups{background:rgba(255,255,255,.72)}
.followups-header{display:flex;align-items:center;justify-content:space-between;gap:16px}.followups-header h3{margin:0}.followups-header p{margin:4px 0 0;color:#71817f;font-size:13px}
.care-followups button,.care-followups a{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border:1px solid #cfe0da;border-radius:10px;background:#fff;color:#237d6d;padding:7px 12px;font:inherit;font-size:13px;text-decoration:none;cursor:pointer;transition:all .18s ease}.care-followups button:hover,.care-followups a:hover{border-color:#56a998;background:#edf8f4;transform:translateY(-1px)}
.followups-refresh{min-height:34px!important;background:#f3faf7!important}.followups-check{margin:16px 0 4px;background:linear-gradient(135deg,#2e927f,#4aa994)!important;border-color:transparent!important;color:#fff!important;box-shadow:0 5px 12px rgba(43,139,119,.18)}
.followup-checks{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.followup-checks>span{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:6px 10px;font-size:12px}.check-ok{background:#eaf7ef;color:#27734c}.check-pending{background:#fff3df;color:#9b691d}.followup-checks button{min-height:25px;padding:2px 7px;border-radius:7px;font-size:11px}
.followup-tabs{display:flex;gap:8px;margin:16px 0;border-bottom:1px solid #e3ece8;padding-bottom:8px}.followup-tabs button{background:transparent;border-color:transparent;color:#637571}.followup-tabs button.active{background:#e8f5f0;border-color:#b9ddd1;color:#177965;font-weight:700}.followup-tabs b{font-size:11px}
.followup-item{margin:12px 0;padding:16px;border:1px solid #dce9e4;border-radius:14px;background:linear-gradient(135deg,rgba(255,255,255,.94),rgba(247,252,250,.9));box-shadow:0 5px 14px rgba(45,90,80,.06)}.followup-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.followup-item h4{margin:5px 0 0;font-size:15px;color:#254d48}.followup-state{white-space:nowrap;border-radius:999px;padding:4px 8px;background:#fff3df;color:#9b691d;font-size:11px}.followup-owner{margin:8px 0;color:#71817f;font-size:12px}.followup-reason{color:#536966;font-size:13px}.followup-actions{display:flex;gap:8px;flex-wrap:wrap}.followup-detail{margin-top:14px;padding-top:12px;border-top:1px solid #e5efeb}.followup-detail :deep(.workspace-panel){margin:10px 0;padding:12px;border-radius:10px}.followup-detail details{margin-top:12px;color:#46625c}.followup-detail ol{padding-left:20px}.followup-detail li{margin:8px 0;font-size:13px}
@media (max-width:600px){.followups-header{align-items:flex-start}.followup-item{padding:13px}.followup-tabs{overflow-x:auto}.followup-tabs button{white-space:nowrap}}
</style>
