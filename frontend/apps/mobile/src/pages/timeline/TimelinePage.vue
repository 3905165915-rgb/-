<script setup lang="ts">
import { readDemoState } from '@hulao/shared'
const state = readDemoState()
</script>

<template><section><h1>过程回放</h1><van-notice-bar text="发生时间与录入时间分开显示，缺失信息不由AI补写。" left-icon="info-o" /><van-steps direction="vertical" :active="state.timeline.length - 1" class="mobile-card"><van-step v-for="event in state.timeline" :key="event.id"><h3>{{ event.label }}</h3><p>{{ event.detail }}</p><p class="muted">{{ event.happenedAt }} · 录入 {{ event.enteredAt }} · {{ event.actor }}</p></van-step></van-steps></section></template>
