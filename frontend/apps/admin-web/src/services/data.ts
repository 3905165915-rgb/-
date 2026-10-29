import { computed, ref } from 'vue'
import { QueryClient, useQuery } from '@tanstack/vue-query'
import { createGateway } from '@hulao/api-client/gateway'
import { ContractError, toUiError } from '@hulao/api-client'
import {
  readSession,
  subscribeDemo,
  type AppMode,
  type Elder,
  type Task,
  type HandoverItem,
  type FamilyCase,
  type TimelineEvent,
  isFollowupTask,
} from '@hulao/shared'

export const mode: AppMode =
  import.meta.env.VITE_APP_MODE === 'demo' ? 'demo' : 'api'
export const session = ref(readSession())
export const localDraftsClearing = ref(false)
export const accountKey = computed(
  () => session.value?.accountKey ?? 'anonymous',
)
export const gateway = createGateway(mode, import.meta.env.VITE_API_BASE_URL)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
})
export const errorMessage = (error: unknown) => toUiError(error).message
export const queryKey = (resource: string, ...ids: string[]) => [
  mode,
  accountKey.value,
  resource,
  ...ids,
]
subscribeDemo(() => {
  if (mode === 'demo')
    void queryClient.invalidateQueries({ queryKey: ['demo'] })
})

export function checkedList<T extends { id: string }>(
  value: unknown,
  fields: string[],
): T[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        !item.id.trim() ||
        fields.some((field) => typeof item[field] !== 'string'),
    )
  ) {
    throw new ContractError('返回数据格式不正确，请联系管理员。')
  }
  return value as T[]
}
const enabled = computed(() =>
  Boolean(session.value?.accountKey && session.value.mode === mode),
)
export function useElders() {
  return useQuery({
    queryKey: computed(() => queryKey('elders')),
    enabled,
    queryFn: async () =>
      checkedList<Elder>(await gateway.elders(), [
        'name',
        'bedLabel',
        'status',
      ]),
  })
}
export async function fetchTasks() {
  const rows = checkedList<Task>(await gateway.tasks(), [
    'elderId',
    'title',
    'shift',
    'assignee',
    'status',
  ])
  return rows.filter(isFollowupTask)
}
export function useTasks() {
  return useQuery({
    queryKey: computed(() => queryKey('tasks')),
    enabled,
    queryFn: fetchTasks,
  })
}
export function useHandover(shiftId: () => string) {
  return useQuery({
    queryKey: computed(() => queryKey('handover', shiftId())),
    enabled: computed(() => enabled.value && Boolean(shiftId())),
    queryFn: async () =>
      checkedList<HandoverItem>(await gateway.handover(shiftId()), [
        'title',
        'detail',
        'status',
        'owner',
      ]),
  })
}
export function useTimeline(itemId: () => string) {
  return useQuery({
    queryKey: computed(() => queryKey('timeline', itemId())),
    enabled: computed(() => enabled.value && Boolean(itemId())),
    queryFn: async () =>
      checkedList<TimelineEvent>(await gateway.timeline(itemId()), [
        'label',
        'detail',
        'actor',
      ]),
  })
}
export function useFamilyCases() {
  return useQuery({
    queryKey: computed(() => queryKey('family')),
    enabled,
    queryFn: async () => {
      const rows = checkedList<FamilyCase>(await gateway.familyCases(), [
        'subject',
        'status',
      ])
      if (rows.some((row) => typeof row.public !== 'boolean'))
        throw new ContractError('家属数据可见范围缺失。')
      return rows.filter((row) => row.public)
    },
  })
}
export async function refreshData() {
  await queryClient.invalidateQueries({ queryKey: [mode, accountKey.value] })
}
