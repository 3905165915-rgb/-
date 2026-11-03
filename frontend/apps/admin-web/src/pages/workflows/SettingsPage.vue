<script setup lang="ts">
import { computed } from 'vue'
import { allowedRoutes } from '../../router/access'
import { mode, session } from '../../services/data'
const sections = computed(() => {
  const allowed = allowedRoutes(session.value?.role || null)
  return [
    { title: '人员与班次', paths: ['/workflows/staff', '/workflows/shifts', '/elders'] },
    { title: '入住与照护资料', paths: ['/admission', '/assessment', '/care-plan', '/workflows/memories'] },
    { title: '沟通与记录', paths: ['/family', '/notifications', '/workflows/records', '/workflows/handovers'] },
    { title: '质量与追溯', paths: ['/followups', '/quality', '/coverage', '/changes', '/workflows/incidents', '/timeline', '/workflows/reports'] },
    { title: '本机与演示', paths: ['/recovery', ...(mode === 'demo' ? ['/demo'] : [])] },
  ].map(section => ({ ...section, items: section.paths.flatMap(path => allowed.filter(item => item.path === path)) }))
    .filter(section => section.items.length)
})
</script>
<template>
  <section>
    <h1>机构管理</h1><p>按工作职责进入配置和历史办理；本机草稿可从导航底部打开。</p>
    <section v-for="section in sections" :key="section.title" class="settings-section">
      <h2>{{ section.title }}</h2>
      <div class="settings-grid"><RouterLink v-for="item in section.items" :key="item.path" :to="item.path">{{ item.label }}</RouterLink></div>
    </section>
  </section>
</template>
<style scoped>
.settings-section { margin:24px 0; }
.settings-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
.settings-grid a { display:flex; align-items:center; min-height:48px; padding:12px 16px; border:1px solid var(--hl-border); border-radius:8px; background:var(--hl-surface); }
.settings-grid a:hover { border-color:var(--hl-primary); }
</style>
