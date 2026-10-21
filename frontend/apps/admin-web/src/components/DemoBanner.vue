<script setup lang="ts">
import { mode } from '../services/data'
</script>
<template>
  <el-alert
    v-if="mode === 'demo'"
    title="虚构演示数据"
    type="warning"
    show-icon
    :closable="false"
  />
</template>
