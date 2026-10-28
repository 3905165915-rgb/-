<script setup lang="ts">
import { useRoute } from 'vue-router'
import ChangeReviewCenter from '../../../../../packages/shared/src/workflow/ChangeReviewCenter.vue'
const route = useRoute()
</script>
<template>
  <ChangeReviewCenter :context="route.query" />
</template>
