<script setup lang="ts">
import { ref } from 'vue'
import { showToast } from 'vant'
import { readDemoState } from '@hulao/shared'
const state = ref(readDemoState())
</script>

<template><section><h1>家属动态</h1><van-notice-bar text="仅展示已授权、已审核和已发布内容。" left-icon="info-o" /><van-cell-group inset class="mobile-card"><van-cell title="王阿姨" label="305床 · 今日服务摘要"><template #value><van-tag type="success">已审核</van-tag></template></van-cell><van-cell title="午餐进食观察" label="记录已完成审核，晚餐情况待更新" /></van-cell-group><h2>我的诉求</h2><van-cell-group inset class="mobile-card"><van-cell v-for="item in state.familyCases.filter((item) => item.public)" :key="item.id" :title="item.subject" :label="item.reply"><template #value><van-tag type="primary">{{ item.status }}</van-tag></template></van-cell></van-cell-group><van-button block plain type="primary" @click="showToast('提交问题入口将在接口接入后启用')">提交问题</van-button></section></template>
