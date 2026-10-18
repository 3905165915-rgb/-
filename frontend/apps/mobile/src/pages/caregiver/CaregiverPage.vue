<script setup lang="ts">
import { computed, ref } from 'vue'
import { showToast } from 'vant'
import { readDemoState, writeDemoState } from '@hulao/shared'
import { useRouter } from 'vue-router'
const router = useRouter(); const state = ref(readDemoState())
const tasks = computed(() => state.value.tasks.filter((task) => task.status !== 'completed'))
function complete(id: string) { const task = state.value.tasks.find((item) => item.id === id); if (!task || task.status === 'completed') return; task.status = 'completed'; writeDemoState(state.value); showToast('任务已完成') }
</script>

<template><section><div class="page-title-row"><div><h1>护理员工作台</h1><p class="muted">早班 · 3区 · {{ tasks.length }} 项待处理</p></div><van-tag type="warning">演示</van-tag></div><van-notice-bar left-icon="info-o" text="AI草稿仅供核对，正式记录必须人工确认。" /><van-cell-group inset class="mobile-card"><van-cell title="待核对草稿" value="1条" is-link to="/records/new" /><van-cell title="待接班事项" :value="state.handover.filter((item) => item.status === '待接收').length + '条'" is-link to="/handover" /></van-cell-group><h2>今日任务</h2><van-cell-group inset class="mobile-card"><van-cell v-for="task in tasks" :key="task.id" :title="task.title" :label="`${task.dueAt} · ${task.assignee}`"><template #value><van-button size="small" type="primary" @click="complete(task.id)">完成</van-button></template></van-cell><van-empty v-if="!tasks.length" description="今日任务已处理完" /></van-cell-group><van-button block plain type="primary" class="mobile-action" @click="router.push('/timeline/elder-305-wang')">查看过程回放</van-button></section></template>
