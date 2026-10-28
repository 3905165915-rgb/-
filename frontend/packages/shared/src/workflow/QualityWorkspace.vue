<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import WorkflowPanel from './WorkflowPanel.vue'
import CareFollowups from './CareFollowups.vue'
import { listAll, request, type Row } from './model'
import { object, rows, workspaceDate } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { qualityFeedback } from './quality-check'
const scope = useWorkspaceScope(), route = useRoute()
const context = computed(() => ({ ...route.query, elder_id: route.query.elder_id || route.query.elder }))
const report = ref<Row|null>(null), history = ref<Row[]>([]), historyError = ref(''), reportError = ref('')
const historyOpen = ref(false), loading = ref(false), selectedIssue = ref(''), revision = ref(0)
let epoch = 0
function accept(value:unknown) { qualityFeedback(value); return object(value) }
async function updated(value?:unknown) {
  try {if(value) report.value=accept(value); selectedIssue.value=''; revision.value++; if(historyOpen.value)await loadHistory()}
  catch(failure){reportError.value=(failure as Error).message}
}
async function loadHistory() {
  loading.value=true; historyError.value=''
  const ticket=epoch
  try {const result=await listAll('/quality/checks'+(context.value.elder_id?'?elder_id='+encodeURIComponent(String(context.value.elder_id)):''));if(ticket===epoch&&scope.valid())history.value=result}
  catch(failure){if(ticket===epoch&&scope.valid())historyError.value=(failure as Error).message}
  finally{if(ticket===epoch)loading.value=false}
}
async function selectReport(id:string) {
  const ticket=++epoch; reportError.value=''; selectedIssue.value=''
  try {const result=await request('/quality/checks/'+encodeURIComponent(id));if(ticket===epoch&&scope.valid())report.value=accept(result)}
  catch(failure){if(ticket===epoch&&scope.valid())reportError.value=(failure as Error).message}
}
function location(sourceId:unknown) {
  const source=Array.isArray(report.value?.sources)?rows(report.value!.sources).find(source=>source.source_id===sourceId):undefined
  if(source?.kind==='task')return{path:'/tasks',query:{task:String(sourceId),elder:String(source.elder_id || '')}}
  if(source?.kind==='record')return{path:'/workflows/records',query:{record_id:String(sourceId),action:'/records/{record_id}',read:'1'}}
  return null
}
watch(()=>[route.query.report_id,route.query.elder_id,route.query.elder],()=>{epoch++;report.value=null;history.value=[];if(typeof route.query.report_id==='string')void selectReport(route.query.report_id)},{immediate:true})
onBeforeUnmount(()=>epoch++)
</script>
<template>
  <section v-if="scope.active.value" aria-label="照护检查工作区">
    <h1>质量与安全</h1><p>核对范围后开始检查；结果是扫描时的提示，需要结合证据人工判断。</p>
    <WorkflowPanel group="quality" title="照护检查" initial-action="/quality/checks" :context="context" focused @changed="updated" />
    <p v-if="reportError" role="alert">{{reportError}}</p>
    <section v-if="report" class="workspace-panel" aria-label="检查结果">
      <h2>本次检查结果</h2><p>{{qualityFeedback(report)}} · {{workspaceDate(report.created_at)}}</p>
      <p v-if="!rows(report.issues).length">{{Array.isArray(report.sources)&&report.sources.length?'本次检查未产生待核对提示；不代表医学达标或全部业务已完成。':'暂无可检查资料；不能据此认定照护全部正常。'}}</p>
      <article v-for="issue in rows(report.issues)" :key="String(issue.id)" class="workspace-panel">
        <h3>{{issue.title || '需要人工核对的提示'}}</h3><p>{{issue.explanation}}</p><p>{{issue.status==='pending_review'?'待人工核对':issue.status==='not_applicable'?'已核对本次不适用':'已记录核对结论，关联业务仍需办理'}}</p>
        <details><summary>查看依据</summary><blockquote v-for="(citation,index) in (Array.isArray(issue.citations)?rows(issue.citations):[])" :key="index">{{citation.quote}}<p><RouterLink v-if="location(citation.source_id)" :to="location(citation.source_id)!">进入来源办理</RouterLink><span v-else>来源入口暂未提供，请结合原文人工核对。</span></p></blockquote></details>
        <RouterLink v-if="object(report.scope || {}).handover_id" :to="{path:'/workflows/handovers',query:{handover_id:String(object(report.scope || {}).handover_id)}}">进入关联交班</RouterLink>
        <button v-if="issue.status==='pending_review'" type="button" @click="selectedIssue=String(issue.id)">记录核对结论</button>
        <WorkflowPanel v-if="selectedIssue===issue.id" :key="String(report.id)+':'+selectedIssue" group="quality" title="人工核对说明（不会自动解决关联业务）" initial-action="/quality/checks/{report_id}/issues/{issue_id}/resolve" :context="{report_id:report.id,issue_id:issue.id}" focused @changed="updated" />
      </article>
    </section>
    <details @toggle="historyOpen=($event.target as HTMLDetailsElement).open; historyOpen&&loadHistory()"><summary>历史检查报告</summary>
      <p v-if="loading" role="status">正在读取历史报告…</p><p v-if="historyError" role="alert">{{historyError}} <button type="button" @click="loadHistory">重试历史报告</button></p>
      <p v-if="!loading&&!historyError&&!history.length">当前范围没有历史检查报告。</p>
      <ul><li v-for="entry in history" :key="String(entry.id)"><button type="button" @click="selectReport(String(entry.id))">{{workspaceDate(entry.created_at)}} · {{Array.isArray(entry.issues)?entry.issues.length:'未提供'}} 条提示</button></li></ul>
    </details>
    <CareFollowups :key="revision" :elder-id="typeof context.elder_id==='string'?context.elder_id:undefined" />
  </section>
</template>
