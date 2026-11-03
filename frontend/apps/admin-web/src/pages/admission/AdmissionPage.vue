<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import AdmissionJourney from '../../../../../packages/shared/src/workflow/AdmissionJourney.vue'
import { useRoute } from 'vue-router'
import { mode } from '../../services/data'
const route = useRoute()
</script>
<template>
  <section>
    <h1>入住与床位</h1>
    <AdmissionJourney
      v-if="mode === 'api'"
      :elder-id="typeof route.query.elder_id === 'string' ? route.query.elder_id : undefined"
    />
    <p
      v-else
      class="muted"
    >
      办理正式入住请使用服务器账号。
    </p>
    <details
      :open="!!route.query.action || !!route.query.admission_id"
      class="admission-more"
    >
      <summary>床位管理、历史入住与转床／外出／返院／离院</summary><WorkflowPanel
        group="admission"
        :context="route.query"
        :initial-action="typeof route.query.action === 'string' ? route.query.action : ''"
        :auto-read="route.query.read === '1'"
      />
    </details>
  </section>
</template>
<style scoped>
.admission-more{margin-top:24px;border:1px solid var(--hl-border,#d9e4dd);border-radius:12px;background:white;padding:8px 18px}.admission-more>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}
</style>
