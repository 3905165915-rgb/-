<script setup lang="ts">
withDefaults(defineProps<{ type?: 'loading' | 'empty' | 'error' | 'success'; title: string; description?: string; actionText?: string }>(), { type: 'empty' })
defineEmits<{ retry: [] }>()
</script>

<template>
  <el-result :icon="type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'loading' ? 'info' : 'warning'" :title="title" :sub-title="description">
    <template #extra><el-button v-if="actionText" @click="$emit('retry')">{{ actionText }}</el-button></template>
  </el-result>
</template>
