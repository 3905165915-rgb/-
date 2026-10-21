<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean
    error?: unknown
    empty?: boolean
    emptyText?: string
  }>(),
  { emptyText: '暂无数据', error: undefined },
)
defineEmits<{ retry: [] }>()
import { errorMessage } from '../services/data'
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
      {{ errorMessage(error) }}
    </p>
    <van-button
      size="small"
      icon="replay"
      @click="$emit('retry')"
    >
      重新加载
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
