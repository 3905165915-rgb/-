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
  const scoped = computed(() => {
    const query = filters.value.q.trim().toLowerCase()
    const people = new Map(elders().map(elder => [elder.id, elder.name + ' ' + elder.bedLabel]))
    const tasks = rows().map(task => ({ ...task, dueAt: task.deadlineAt || task.dueAt, shift: task.shiftName || task.shift }))
    return filterTasks(tasks, { ...filters.value, status: '', q: '' }, elders()).filter(task =>
      !query || [task.id, task.title, task.elderId, people.get(task.elderId), task.bedSnapshot, task.assignee, task.shift, task.result]
        .join(' ').toLowerCase().includes(query),
    )
  })
  const filtered = computed(() => scoped.value.filter(task => !filters.value.status || task.status === filters.value.status))
  const shifts = computed(() => [
    ...new Set(
      rows()
        .map((task) => task.shiftName || task.shift)
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
  return { filters, filtered, scoped, shifts, assignees, sync, reset }
}
