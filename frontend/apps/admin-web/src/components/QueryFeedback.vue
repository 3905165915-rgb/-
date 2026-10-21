<script setup lang="ts">
import { errorMessage } from '../services/data'
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-vue-next'
defineProps<{
  loading?: boolean
  error?: unknown
  empty?: boolean
  emptyText?: string
}>()
defineEmits<{ retry: [] }>()
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
      <p>{{ errorMessage(error) }}</p>
      <el-button @click="$emit('retry')">
        <RefreshCw
          :size="16"
          aria-hidden="true"
        />重新加载
      </el-button>
    </div>
  </div>
  <el-empty
    v-else-if="empty"
    :description="emptyText || '暂无数据'"
  />
</template>
