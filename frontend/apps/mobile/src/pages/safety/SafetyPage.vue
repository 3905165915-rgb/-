<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import CareSafety from '@hulao/shared/care-safety'
const route = useRoute()
const context = computed(() => ({ ...route.query, elder_id: typeof route.query.elder === 'string' ? route.query.elder : typeof route.query.elder_id === 'string' ? route.query.elder_id : '' }))
</script>
<template><CareSafety :context="context" :report="route.query.report === '1'" /></template>
