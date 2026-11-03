<script setup lang="ts">
import { computed } from 'vue'
import { toUiError } from '@hulao/api-client'
const props = withDefaults(
  defineProps<{
    loading?: boolean
    error?: unknown
    empty?: boolean
    emptyText?: string
  }>(),
  { emptyText: '暂无数据', error: undefined },
)
defineEmits<{ retry: [] }>()
const failure = computed(() => toUiError(props.error))
const fieldMessages = computed(() => [...new Set(Object.values(failure.value.fieldErrors || {}))])
</script>
<template>
  <div
    v-if="error"
    class="feedback feedback-error"
    role="alert"
  >
    <van-icon
      name="warning-o"
      size="28"
      aria-hidden="true"
    />
    <p>加载失败</p>
    <p class="muted">
      {{ failure.message }}
    </p>
    <ul v-if="fieldMessages.length">
      <li
        v-for="message in fieldMessages"
        :key="message"
      >
        {{ message }}
      </li>
    </ul>
    <van-button
      v-if="failure.canRetry || failure.status === 409"
      size="small"
      icon="replay"
      @click="$emit('retry')"
    >
      {{ failure.status === 409 ? '读取最新资料' : '重新加载' }}
    </van-button>
  </div>
  <div
    v-else-if="loading"
    class="feedback"
    role="status"
  >
    <van-loading color="var(--hl-primary, #1767CF)">
      正在加载
    </van-loading>
  </div>
  <van-empty
    v-else-if="empty"
    :description="emptyText"
  />
</template>
