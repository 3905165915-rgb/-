<script setup lang="ts">
import { ref } from 'vue'
import {
  formatBusinessTime,
  isKnownStatus,
  handoverDisplayStatusMeta,
  resolveStatus,
  type HandoverItem,
} from '@hulao/shared'
import { mode, gateway, errorMessage, refreshData } from '../services/data'
const props = withDefaults(
  defineProps<{ items: HandoverItem[]; writable?: boolean }>(),
  { writable: true },
)
const emit = defineEmits<{ reload: [] }>()
const notes = ref<Record<string, string>>({})
const busy = ref('')
const error = ref('')
const message = ref('')
async function receive(item: HandoverItem, status: 'received' | 'clarifying') {
  if (
    mode !== 'demo' ||
    busy.value ||
    !props.writable ||
    !isKnownStatus(handoverDisplayStatusMeta, item.status)
  )
    return
  const note = notes.value[item.id]?.trim() ?? ''
  if (status === 'clarifying' && !note) {
    error.value = '请填写需要澄清的内容。'
    return
  }
  busy.value = item.id
  error.value = ''
  message.value = ''
  try {
    await gateway.receiveHandover(item.id, { status, note: note || undefined, expectedEpoch: item.demoEpoch })
    notes.value[item.id] = ''
    await refreshData()
    emit('reload')
    message.value = '演示处理已提交，接收信息以刷新列表为准。'
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    busy.value = ''
  }
}
</script>
<template>
  <section class="handover-receive">
    <p
      v-if="mode === 'api'"
      class="muted"
    >
      接班只读预览；当前接口接收对象尚未核实，提交暂不可用。
    </p>
    <p
      v-if="error"
      class="error-text"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
    >
      {{ message }}
    </p>
    <van-empty
      v-if="!items.length"
      description="暂无交班事项"
    />
    <article
      v-for="item in items"
      :key="item.id"
      class="receive-item"
    >
      <div class="page-title-row">
        <h3>{{ item.title }}</h3>
        <span
          class="status-label"
          :data-tone="
            resolveStatus(handoverDisplayStatusMeta, item.status).tone
          "
        >
          {{ resolveStatus(handoverDisplayStatusMeta, item.status).label }}
        </span>
      </div>
      <p>{{ item.detail }}</p>
      <p class="muted">
        责任人：{{ item.owner || '未提供' }}
      </p>
      <p class="muted">
        接收人：{{ item.receivedBy || item.receiverId || '未提供' }} ·
        接收时间：{{ item.receivedAt ? formatBusinessTime(item.receivedAt, true) : '未提供' }}
      </p>
      <p v-if="item.note">
        备注：{{ item.note }}
      </p>
      <van-button
        v-if="item.itemId"
        size="small"
        icon="clock-o"
        :to="'/timeline/' + encodeURIComponent(item.itemId)"
      >
        来源回放
      </van-button>
      <p
        v-else
        class="muted"
      >
        来源事项编号未提供
      </p>
      <template v-if="item.status !== '已接收'">
        <van-field
          v-model="notes[item.id]"
          type="textarea"
          label="接班备注"
          :disabled="
            !!busy ||
              !writable ||
              !isKnownStatus(handoverDisplayStatusMeta, item.status)
          "
          placeholder="需要澄清时请填写具体问题"
        />
        <div class="action-row">
          <van-button
            size="small"
            type="primary"
            :disabled="
              mode !== 'demo' ||
                !!busy ||
                !writable ||
                !isKnownStatus(handoverDisplayStatusMeta, item.status)
            "
            :loading="busy === item.id"
            @click="receive(item, 'received')"
          >
            接收
          </van-button><van-button
            size="small"
            :disabled="
              mode !== 'demo' ||
                !!busy ||
                !writable ||
                !isKnownStatus(handoverDisplayStatusMeta, item.status)
            "
            @click="receive(item, 'clarifying')"
          >
            提交澄清
          </van-button>
        </div>
      </template>
    </article>
  </section>
</template>
