<script setup lang="ts">
import { ref } from 'vue'
import { showDialog, showToast } from 'vant'
import { readDemoState, writeDemoState } from '@hulao/shared'
const state = ref(readDemoState())
async function receive(item: (typeof state.value.handover)[number], status: '已接收' | '需澄清') {
  if (status === '需澄清') await showDialog({ title: '补充澄清', message: '请在后端交班接口接入后填写澄清内容。' })
  item.status = status; item.receivedAt = '刚刚'; writeDemoState(state.value); showToast(status === '已接收' ? '已记录接收人和时间' : '已标记需澄清')
}
</script>

<template><section><div class="page-title-row"><div><h1>接班</h1><p class="muted">晚班 · 逐项接收，未接收事项仍对主管可见</p></div><van-tag type="warning">演示</van-tag></div><van-cell-group inset class="mobile-card"><van-cell v-for="item in state.handover" :key="item.id" :title="item.title" :label="item.detail"><template #value><van-tag :type="item.status === '已接收' ? 'success' : item.status === '需澄清' ? 'danger' : 'warning'">{{ item.status }}</van-tag></template><template #label><div>{{ item.detail }}</div><div class="muted">责任人：{{ item.owner }}<span v-if="item.receivedAt"> · {{ item.receivedAt }}</span></div></template><template #right-icon><div class="handover-actions"><van-button v-if="item.status === '待接收'" size="small" type="primary" @click="receive(item, '已接收')">接收</van-button><van-button v-if="item.status === '待接收'" size="small" plain @click="receive(item, '需澄清')">澄清</van-button></div></template></van-cell></van-cell-group></section></template>
