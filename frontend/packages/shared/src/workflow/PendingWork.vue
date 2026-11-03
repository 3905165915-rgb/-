<script setup lang="ts">
import { readSession } from '../session'
import WorkInbox from './WorkInbox.vue'
import LegacyNotificationWork from './LegacyNotificationWork.vue'
defineProps<{ mobile?: boolean }>()
const api = readSession()?.mode === 'api'
</script>
<template><WorkInbox v-if="api" :mobile="mobile" /><LegacyNotificationWork v-else :mobile="mobile" /></template>
