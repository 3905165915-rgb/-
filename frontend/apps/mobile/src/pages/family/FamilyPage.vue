<script setup lang="ts">
import { mode } from '../../services/data'
import DemoFamilyPage from './DemoFamilyPage.vue'
import ServerFamilyPage from './ServerFamilyPage.vue'
</script>
<template>
  <DemoFamilyPage v-if="mode === 'demo'" /><ServerFamilyPage v-else />
</template>
