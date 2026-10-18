<script setup lang="ts">
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { readDemoState, writeDemoState } from '@hulao/shared'
const state = ref(readDemoState()); const text = ref('午餐只吃一半，晚上联系女儿。'); const saved = ref(false)
const draft = computed(() => state.value.drafts[0])
function saveDraft() { saved.value = true; showToast('草稿已保存在本机，网络恢复后可继续提交。') }
async function confirmDraft() { await showConfirmDialog({ title: '确认正式记录', message: '确认后才会形成正式记录和后续任务。' }); if (draft.value) draft.value.status = 'confirmed'; writeDemoState(state.value); showToast('已确认，正式记录待接口提交') }
async function rejectDraft() { await showConfirmDialog({ title: '放弃AI草稿', message: '原文和放弃原因会保留。' }); if (draft.value) draft.value.status = 'rejected'; writeDemoState(state.value); showToast('已放弃草稿，可手工录入') }
</script>

<template><section><div class="page-title-row"><div><h1>快速记录</h1><p class="muted">老人：王阿姨 · 305床</p></div><van-tag type="warning">演示</van-tag></div><van-cell-group inset class="mobile-card"><van-field v-model="text" rows="4" autosize type="textarea" label="原文" placeholder="输入护理观察、待办或沟通内容" /><van-cell title="语音入口" value="当前为文字降级" is-link @click="showToast('语音服务不可用，可继续手工输入')" /></van-cell-group><van-button block type="primary" class="mobile-action" :disabled="!text" @click="saveDraft">保存草稿</van-button><van-cell-group v-if="draft" inset class="mobile-card"><van-cell title="AI草稿" value="待核对" /><van-cell title="结构化字段" label="原文在上，结构化结果、证据和警告分开展示" /><div class="draft-box"><p><b>观察：</b>{{ draft.fields.observation }}</p><p><b>后续：</b>{{ draft.fields.followUp }}</p><p><b>联系对象：</b>{{ draft.fields.contactTarget }}</p><van-divider /> <p><b>证据：</b>{{ draft.evidence.join('；') }}</p><van-tag v-for="warning in draft.warnings" :key="warning" type="warning" plain>{{ warning }}</van-tag></div><div class="draft-actions"><van-button size="small" type="primary" @click="confirmDraft">确认</van-button><van-button size="small" type="danger" plain @click="rejectDraft">放弃</van-button><van-button size="small" plain @click="showToast('可直接修改上方原文后重新生成')">手工录入</van-button></div></van-cell-group><van-notice-bar v-if="saved" type="success" text="草稿已保存；提交失败时不会丢失输入。" /></section></template>
