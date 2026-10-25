<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { display, type Row } from './model'
import ServiceCareHints from './ServiceCareHints.vue'
const props = defineProps<{ elderId: string; tasks: Row[]; available: boolean }>()
const scene = ref('communication')
const related = computed(() => props.tasks.filter(row => row.elder_id === props.elderId))
watch(() => props.elderId, () => { scene.value = 'communication' })
</script>
<template>
  <section v-if="elderId" class="wf-task-context" aria-label="所选老人的任务与照护提示">
    <h4>该老人已有任务</h4>
    <p v-if="!available" role="status">相关任务尚未成功载入，请刷新可选数据后核对。</p>
    <p v-else-if="!related.length" class="wf-muted">暂无可查看的相关任务。</p>
    <ul v-else><li v-for="task in related" :key="String(task.id)">{{ task.title }} · {{ display(task.status) }} · {{ display(task.due_at, 'due_at') }}</li></ul>
    <label class="wf-field"><span>照护提示场景</span><select v-model="scene"><option value="communication">沟通</option><option value="dining">饮食</option><option value="bathing">洗浴</option><option value="activity">活动</option><option value="rest">休息</option><option value="other">其他</option></select></label>
    <ServiceCareHints :elder-id="elderId" :scene="scene" />
  </section>
</template>
<style scoped>
.wf-task-context { padding-block: 12px; border-block: 1px solid var(--hl-border, #dce3e7); }
h4 { margin: 0 0 8px; font-size: 16px; }
ul { padding-left: 20px; }
li { padding-block: 6px; overflow-wrap: anywhere; }
</style>
