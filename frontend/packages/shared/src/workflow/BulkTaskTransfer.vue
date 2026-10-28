<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { listAll, request, WorkflowRequestError, type Row } from './model'
import { object, workspaceStorageKey } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { withSubmissionLock } from './recovery'
import { ordinaryTransferIssue, validateTransferReceipt } from './bulk-transfer'
const props=defineProps<{taskIds:string[]}>(), emit=defineEmits<{changed:[]}>()
const scope=useWorkspaceScope()
type Entry={id:string;title:string;revision:number;key:string;assignee:string;note:string;state:'pending'|'success'|'failed';message:string}
const entries=ref<Entry[]>([]), preview=ref<Row[]>([]), issues=ref<string[]>([])
const assignee=ref(''), note=ref(''), staff=ref<Row[]>([]), shifts=ref<Row[]>([])
const busy=ref(false), error=ref(''), ready=ref(false)
const hasPending=computed(()=>entries.value.some(entry=>entry.state==='pending'))
const key=workspaceStorageKey(scope.owner,'','bulk-transfer')
let disposed=false
let readable=true
function preserve(){sessionStorage.setItem(key,JSON.stringify({queue:entries.value,updated_at:new Date().toISOString()}))}
try{
  const saved=sessionStorage.getItem(key)
  if(saved){const value=object(JSON.parse(saved));if(!Array.isArray(value.queue))throw new Error();entries.value=value.queue.map(raw=>{const entry=object(raw);if(['id','title','key','assignee','note','message'].some(field=>typeof entry[field]!=='string')||!Number.isSafeInteger(entry.revision)||!['pending','success','failed'].includes(String(entry.state)))throw new Error();return entry as unknown as Entry})}
}catch{readable=false;error.value='批量转交恢复日志无法读取，请先核实服务器任务，不可重新创建同一批操作。'}
async function prepare(){
  if(busy.value||hasPending.value||!readable||!scope.valid())return
  error.value='';ready.value=false;busy.value=true
  try{
    if(!props.taskIds.length||props.taskIds.length>20)throw new Error('请选择本页 1 至 20 项任务。')
    const [directory, shiftRows, ...tasks]=await Promise.all([listAll('/staff/directory'),listAll('/shifts'),...props.taskIds.map(id=>request('/tasks/'+encodeURIComponent(id)))])
    if(disposed||!scope.valid())return
    staff.value=directory as Row[];shifts.value=shiftRows as Row[];preview.value=tasks.map(object);ready.value=true
  }catch(failure){if(scope.valid())error.value=(failure as Error).message}
  finally{busy.value=false}
}
async function submit(){
  if(busy.value||!scope.valid()||!scope.management||!readable)return
  if(!hasPending.value){
    issues.value=preview.value.map(task=>ordinaryTransferIssue(task,assignee.value,shifts.value.find(shift=>shift.id===task.shift_id)))
    if(!ready.value||!note.value.trim()||!assignee.value){error.value='请先预览，并选择接任人员、填写转交原因。';return}
    if(!window.confirm(`确认逐项转交这 ${preview.value.length} 项任务？不满足权限、版本或普通任务要求的项目会单独列为失败，其他项目继续办理。`))return
    entries.value=preview.value.map((task,index)=>({id:String(task.id),title:String(task.title),revision:Number(task.revision),key:crypto.randomUUID(),assignee:assignee.value,note:note.value.trim(),state:issues.value[index]?'failed':'pending',message:issues.value[index]||'结果待核实'}))
  }
  busy.value=true;error.value=''
  try{
    preserve()
    await withSubmissionLock(key,async()=>{
      for(const entry of entries.value){
        if(disposed||!scope.valid())break
        if(entry.state!=='pending')continue
        preserve()
        try{
          const value=await request('/tasks/'+encodeURIComponent(entry.id)+'/transition','post',{action:'transfer',expected_revision:entry.revision,assigned_to:entry.assignee,note:entry.note},entry.key)
          if(disposed||!scope.valid())break
          validateTransferReceipt(value,entry.id,entry.revision,entry.assignee)
          entry.state='success';entry.message='服务器已确认转交'
        }catch(failure){
          if(disposed||!scope.valid())break
          entry.message=(failure as Error).message
          if(failure instanceof WorkflowRequestError && failure.status>=400 && failure.status<500)entry.state='failed'
          else entry.message+='；保留原请求，需核实结果。'
        }
        preserve()
      }
    })
    if(scope.valid())emit('changed')
  }catch(failure){if(scope.valid())error.value=(failure as Error).message}
  finally{busy.value=false;ready.value=false}
}
watch(()=>props.taskIds.join('|'),()=>{ready.value=false})
onBeforeRouteLeave(()=>!busy.value)
onBeforeUnmount(()=>{disposed=true})
</script>
<template>
  <section v-if="scope.active.value&&scope.management" class="workspace-panel" aria-label="普通任务批量转交">
    <h3>普通任务批量转交</h3><p>仅处理本页选中的未开始普通任务，最多 20 项。按服务器允许动作、当前版本和班次逐项校验，不包含临床确认或任务完成。</p>
    <button type="button" :disabled="busy||hasPending||!taskIds.length" @click="prepare">预览所选 {{taskIds.length}} 项</button>
    <template v-if="ready&&!hasPending">
      <ul><li v-for="task in preview" :key="String(task.id)">{{task.elder_name || '老人信息待核对'}} · {{task.title}} · {{task.assignee_name || '负责人未提供'}}</li></ul>
      <label>接任人员<select v-model="assignee" :disabled="busy"><option value="">请选择</option><option v-for="person in staff.filter(row=>row.active!==false&&row.role==='caregiver')" :key="String(person.id)" :value="person.id">{{person.display_name}}</option></select></label>
      <label>转交原因<textarea v-model="note" maxlength="2000" :disabled="busy" /></label>
    </template>
    <button type="button" :disabled="busy||(!hasPending&&!ready)" @click="submit">{{busy?'逐项确认中…':hasPending?'使用原请求核实未确认项目':'确认影响并逐项转交'}}</button>
    <p v-if="error" role="alert">{{error}}</p>
    <p v-if="entries.length" role="status">共 {{entries.length}} 项：成功 {{entries.filter(row=>row.state==='success').length}} 项，失败 {{entries.filter(row=>row.state==='failed').length}} 项，待核实 {{entries.filter(row=>row.state==='pending').length}} 项。</p>
    <ul><li v-for="entry in entries" :key="entry.key"><RouterLink :to="{path:'/tasks',query:{task:entry.id}}">{{entry.title}}</RouterLink>：{{entry.message}}</li></ul>
  </section>
</template>
