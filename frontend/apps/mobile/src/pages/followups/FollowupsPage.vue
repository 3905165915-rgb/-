<script setup lang="ts">
import PendingWork from '../../../../../packages/shared/src/workflow/PendingWork.vue'
import { mode } from '../../services/data'
import CareFollowups from '../../../../../packages/shared/src/workflow/CareFollowups.vue'
</script>
<template>
  <section>
    <h1>照护跟进</h1>
    <PendingWork v-if="mode === 'demo'" mobile /><CareFollowups v-else mobile />
  </section>
</template>
