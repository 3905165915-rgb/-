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
const states=[{key:'pending',label:'待处理'},{key:'review',label:'待复核'},{key:'closed',label:'已结束'}]
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
  <section class="workspace-panel" aria-label="照护跟进">
    <header><h3>照护跟进</h3><button type="button" :disabled="loading" @click="load">刷新</button></header>
    <p>看看哪里需要接续、由谁办理、下一步做什么。</p>
    <button v-if="scope.management && elderId" type="button" :disabled="checkAction.busy.value" @click="checkToday()">{{checkAction.pending.value?'核实上次检查':'检查今天的照护'}}</button>
    <p v-if="checkAction.error.value" role="alert">{{checkAction.error.value}}</p>
    <p v-for="check in (checkResult?.checks as Row[] || [])" :key="String(check.kind)">{{check.kind==='quality'?'记录检查':'安排核对'}}：{{check.status==='completed'?'已完成':'未完成，可单独重试'}}。<button v-if="check.status==='failed'" type="button" :disabled="checkAction.busy.value" @click="checkToday(String(check.kind))">重试{{check.kind==='quality'?'记录检查':'安排核对'}}</button></p>
    <div class="workspace-actions"><button v-for="tab in states" :key="tab.key" type="button" :aria-pressed="state===tab.key" @click="state=tab.key;selected=null">{{ tab.label }} {{ items.filter(r=>r.state===tab.key).length }}</button></div>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="loading" role="status">正在读取跟进事项…</p>
    <p v-if="!loading&&!error&&!visible.length">这一栏暂时没有事项。</p>
    <article v-for="item in visible" :key="String(item.id)" class="workspace-panel">
      <strong>{{ item.elder_name }} · {{ item.title }}</strong>
      <p>{{ item.owner_name }}<span v-if="item.due_at"> · 截止 {{ workspaceDate(item.due_at) }}</span></p>
      <p v-if="item.reason">{{ item.reason }}</p>
      <RouterLink v-if="item.group==='elder'" :to="{path:'/elders/'+String(item.elder_id),query:{section:String(object(item.context).section || 'understanding')}}">查看老人资料并办理</RouterLink>
      <button v-else type="button" @click="selected=selected?.id===item.id?null:item">{{ selected?.id===item.id?'收起':item.next_action }}</button>
      <template v-if="selected?.id===item.id">
        <CareSafety focused v-if="item.state!=='closed' && item.group==='incidents'" :context="context" :initial-action="item.action_path ? String(item.action_path) : undefined" :record-path="mobile?'/records/new':'/workflows/records'" @changed="load" />
        <WorkflowPanel focused v-else-if="item.state!=='closed'" :group="String(item.group)" :context="context" :initial-action="String(item.action_path || item.path || '')" :auto-read="!item.action_path" @changed="load" />
        <details @toggle="loadReplay($event,item)"><summary>查看此事项的相关过程</summary><p v-if="replayError" role="alert">{{ replayError }}</p><ol><li v-for="event in replay" :key="String(event.id)"><strong>{{ event.label }}</strong> · {{ event.actor }}<p>登记 {{ workspaceDate(event.recorded_at) }}<span v-if="event.happened_at"> · 发生 {{ workspaceDate(event.happened_at) }}</span></p><p>{{ event.detail }}</p></li></ol></details>
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
