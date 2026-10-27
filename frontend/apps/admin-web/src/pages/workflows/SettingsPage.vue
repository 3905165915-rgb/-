<script setup lang="ts">
import { allowedRoutes } from '../../router/access'
import { readSession } from '@hulao/shared'
const items=allowedRoutes(readSession()?.role||null).filter(item=>!['/dashboard','/elders','/tasks','/workflows/records','/workflows/handovers','/followups','/family','/settings'].includes(item.path))
</script>
<template><section><h1>更多管理</h1><p>日常照护从老人工作区开始；机构配置和历史办理集中在这里。</p><div class="settings-grid"><RouterLink v-for="item in items" :key="item.path" :to="item.path">{{ item.label }}</RouterLink></div></section></template>
<style scoped>.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}.settings-grid a{padding:20px;border:1px solid rgba(255,255,255,.7);border-radius:20px;background:rgba(255,255,255,.52);backdrop-filter:blur(20px);transition:transform .2s,background .2s}.settings-grid a:hover{transform:translateY(-2px);background:rgba(255,255,255,.72)}@media(prefers-reduced-motion:reduce){.settings-grid a{transition:none}}</style>
