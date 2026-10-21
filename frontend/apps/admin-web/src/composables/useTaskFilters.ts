import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  emptyTaskFilters,
  filterTasks,
  type Task,
  type Elder,
} from '@hulao/shared'
export { taskStatusLabels } from '@hulao/shared'
export function useTaskFilters(
  rows: () => Task[],
  elders: () => Elder[] = () => [],
) {
  const route = useRoute()
  const router = useRouter()
  const filters = ref(emptyTaskFilters())
  watch(
    () => route.query,
    (query) => {
      const defaults = emptyTaskFilters()
      for (const key of Object.keys(defaults) as Array<keyof typeof defaults>)
        filters.value[key] =
          typeof query[key] === 'string' ? query[key] : defaults[key]
      if (!['source', 'due_asc', 'due_desc'].includes(filters.value.sort))
        filters.value.sort = 'source'
    },
    { immediate: true },
  )
  function sync() {
    void router.replace({
      query: {
        ...route.query,
        ...Object.fromEntries(
          Object.entries(filters.value).map(([key, value]) => [
            key,
            !value || (key === 'sort' && value === 'source')
              ? undefined
              : value,
          ]),
        ),
      },
    })
  }
  function reset() {
    filters.value = emptyTaskFilters()
    sync()
  }
  const filtered = computed(() => filterTasks(rows(), filters.value, elders()))
  const shifts = computed(() => [
    ...new Set(
      rows()
        .map((task) => task.shift)
        .filter(Boolean),
    ),
  ])
  const assignees = computed(() => [
    ...new Set(
      rows()
        .map((task) => task.assignee)
        .filter(Boolean),
    ),
  ])
  return { filters, filtered, shifts, assignees, sync, reset }
}
