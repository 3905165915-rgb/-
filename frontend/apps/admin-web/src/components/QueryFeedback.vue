<script setup lang="ts">
import { computed } from 'vue'
import { toUiError } from '@hulao/api-client'
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-vue-next'
const props = defineProps<{
  loading?: boolean
  error?: unknown
  empty?: boolean
  emptyText?: string
}>()
defineEmits<{ retry: [] }>()
const failure = computed(() => toUiError(props.error))
const fieldMessages = computed(() => [...new Set(Object.values(failure.value.fieldErrors || {}))])
</script>
<template>
  <div
    v-if="loading"
    class="query-feedback"
    role="status"
  >
    <LoaderCircle
      :size="22"
      class="is-spinning"
      aria-hidden="true"
    /><span>正在加载…</span>
  </div>
  <div
    v-else-if="error"
    class="query-feedback is-error"
    role="alert"
  >
    <CircleAlert
      :size="24"
      aria-hidden="true"
    />
    <div class="query-feedback-content">
      <strong>加载失败</strong>
      <p>{{ failure.message }}</p>
      <ul v-if="fieldMessages.length">
        <li
          v-for="message in fieldMessages"
          :key="message"
        >
          {{ message }}
        </li>
      </ul>
      <el-button
        v-if="failure.canRetry || failure.status === 409"
        @click="$emit('retry')"
      >
        <RefreshCw
          :size="16"
          aria-hidden="true"
        />{{ failure.status === 409 ? '读取最新资料' : '重新加载' }}
      </el-button>
    </div>
  </div>
  <el-empty
    v-else-if="empty"
    :description="emptyText || '暂无数据'"
  />
</template>
