<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { readSession } from '../session'
import { listWorkspaceDrafts, deleteWorkspaceDraft, type WorkspaceDraft } from './workspace-drafts'
import { formatBusinessTime } from '../business-time'
const props=defineProps<{mobile?:boolean}>(), emit=defineEmits<{navigate:[]}>()
const rows=ref<WorkspaceDraft[]>([]),error=ref(''),filter=ref('')
function load(){try{rows.value=listWorkspaceDrafts(sessionStorage,readSession());error.value=''}catch{error.value='工作区恢复内容无法读取，请检查浏览器存储。'}}
function remove(entry:WorkspaceDraft){if(!window.confirm('确认删除这一条本机编辑？服务器记录不会删除。'))return;try{deleteWorkspaceDraft(sessionStorage,entry,readSession());load()}catch(failure){error.value=(failure as Error).message}}
function location(entry:WorkspaceDraft){
  if(entry.operation==='bulk-transfer')return{path:'/tasks'}
  if(entry.operation==='task-result-text')return props.mobile?{path:'/tasks/'+encodeURIComponent(entry.objectId)}:{path:'/tasks',query:{task:entry.objectId}}
  return{path:'/elders/'+encodeURIComponent(entry.objectId),query:{section:entry.operation.startsWith('record')?'records':entry.operation.startsWith('arrangement')?'assessment':'today'}}
}
onMounted(()=>{load();window.addEventListener('focus',load);window.addEventListener('hulao:unauthorized',load)})
onBeforeUnmount(()=>{window.removeEventListener('focus',load);window.removeEventListener('hulao:unauthorized',load)})
</script>
<template>
  <section aria-label="工作区草稿与待核实提交">
    <header><h3>工作区草稿与待核实提交</h3><button type="button" @click="load">刷新工作区草稿</button></header>
    <p>这些内容保存在当前浏览器会话。{{rows.length}} 项，估算 {{(rows.reduce((sum,row)=>sum+row.bytes,0)/1024).toFixed(1)}} KiB；待核实凭证始终受保护。</p>
    <label>筛选工作区内容<input v-model="filter" type="search" /></label><p v-if="error" role="alert">{{error}}</p>
    <p v-if="!rows.length&&!error">当前会话没有可读取的工作区草稿。</p>
    <ul><li v-for="entry in rows.filter(row=>!filter||row.title.includes(filter))" :key="entry.key">
      <strong>{{entry.title}}</strong><p>{{entry.protected?'提交凭证受保护，先核实结果':'本机编辑'}} · {{entry.updatedAt?formatBusinessTime(entry.updatedAt):'未记录保存时间'}} · {{entry.bytes}} B</p>
      <RouterLink :to="location(entry)" @click="emit('navigate')">返回业务恢复</RouterLink> <button type="button" :disabled="entry.protected" @click="remove(entry)">删除此条本机编辑</button>
    </li></ul>
  </section>
</template>
<style scoped>header{display:flex;align-items:center;justify-content:space-between;gap:12px}ul{padding:0;list-style:none}li{padding:12px 0;border-bottom:1px solid var(--hl-border)}a,button{display:inline-flex;align-items:center;min-height:44px}input{max-width:100%}</style>
