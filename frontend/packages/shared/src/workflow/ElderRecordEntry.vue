<script setup lang="ts">
import { ref, watch } from 'vue'
import { request, type Row } from './model'
import { rows } from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import ElderQuickRecord from './ElderQuickRecord.vue'
import './elder-workspace.css'
const props = defineProps<{ elderId?: string }>()
const scope = useWorkspaceScope(),
  { active } = scope
const elders = ref<Row[]>([]),
  selected = ref(''),
  error = ref(''),
  loading = ref(false)
let epoch = 0
async function load() {
  const ticket = ++epoch
  if (!scope.valid()) return
  loading.value = true
  error.value = ''
  try {
    const result = rows(await request('/elders'))
    if (ticket !== epoch || !scope.valid()) return
    elders.value = result.filter((row) =>
      ['active', 'out'].includes(String(row.status)),
    )
    if (props.elderId)
      selected.value = elders.value.some((row) => row.id === props.elderId)
        ? props.elderId
        : ''
    if (!props.elderId && elders.value.length === 1)
      selected.value = String(elders.value[0].id)
    if (props.elderId && !selected.value)
      error.value = '当前账号没有这位老人的有效照护资料。'
  } catch (failure) {
    if (ticket === epoch && scope.valid())
      error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
watch(
  () => props.elderId,
  () => {
    selected.value = ''
    elders.value = []
    void load()
  },
  { immediate: true },
)
watch(active, (value) => {
  if (!value) {
    epoch++
    elders.value = []
    selected.value = ''
  }
})
</script>
<template>
  <section v-if="active" class="elder-workspace">
    <h2>快速记录</h2>
    <p>选择一次老人，写下本次观察后直接保存。</p>
    <div class="workspace-panel">
      <label
        >老人<select v-model="selected" :disabled="loading || !!elderId">
          <option value="">请选择老人</option>
          <option v-for="row in elders" :key="String(row.id)" :value="row.id">
            {{ row.name }}{{ row.bed_label ? ' · ' + row.bed_label : '' }}
          </option>
        </select></label
      >
      <p v-if="error" role="alert" class="workspace-error">
        {{ error }}
      </p>
      <button v-if="error" type="button" @click="load">重新读取老人</button
      ><RouterLink
        v-if="selected"
        :to="{
          path: '/elders/' + encodeURIComponent(selected),
          query: { section: 'records' },
        }"
      >
        进入这位老人的照护记录
      </RouterLink>
    </div>
    <ElderQuickRecord v-if="selected" :key="selected" :elder-id="selected" />
  </section>
</template>
