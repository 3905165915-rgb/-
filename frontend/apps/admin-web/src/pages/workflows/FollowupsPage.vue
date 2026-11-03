<script setup lang="ts">
import PendingWork from '../../../../../packages/shared/src/workflow/PendingWork.vue'
import { mode } from '../../services/data'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import CareFollowups from '../../../../../packages/shared/src/workflow/CareFollowups.vue'
const route = useRoute()
const elder = computed(() =>
  typeof route.query.elder === 'string' ? route.query.elder : undefined,
)
</script>
<template>
  <section>
    <h1>照护跟进</h1>
    <PendingWork v-if="mode === 'demo'" /><CareFollowups
      v-else
      :elder-id="elder"
    />
  </section>
</template>
