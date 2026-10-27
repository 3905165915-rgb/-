<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { mode, useElders } from '../../services/data'
import DemoCarePlanPage from './DemoCarePlanPage.vue'
import CareArrangement from '../../../../../packages/shared/src/workflow/CareArrangement.vue'
const route = useRoute(),
  elders = useElders(),
  selected = ref('')
const residents = computed(() => elders.data.value || [])
watch(
  [residents, () => route.query.elder],
  () => {
    const id =
      typeof route.query.elder === 'string' ? route.query.elder : selected.value
    selected.value = residents.value.some((e) => e.id === id)
      ? id
      : residents.value.length === 1
        ? residents.value[0].id
        : ''
  },
  { immediate: true },
)
</script>
<template>
  <DemoCarePlanPage v-if="mode === 'demo' || route.query.compat === '1'" />
  <section v-else>
    <h1>照护安排</h1>
    <p>先了解本人情况，再核对服务、时间和负责人。</p>
    <label
      >老人<select v-model="selected">
        <option value="">请选择老人</option>
        <option v-for="elder in residents" :key="elder.id" :value="elder.id">
          {{ elder.name }} · {{ elder.bedLabel }}
        </option>
      </select></label
    >
    <CareArrangement v-if="selected" :key="selected" :elder-id="selected" />
    <details>
      <summary>历史计划与其他办理</summary>
      <RouterLink
        :to="{ path: '/care-plan', query: { elder: selected, compat: '1' } }"
        >继续原版计划草稿</RouterLink
      >
      <WorkflowPanel
        group="plans"
        :context="{ elder_id: selected, elder: selected }"
      />
    </details>
  </section>
</template>
