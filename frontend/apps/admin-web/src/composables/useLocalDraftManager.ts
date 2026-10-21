import { computed, onScopeDispose, ref, watch } from 'vue'
import {
  deleteLocalDrafts,
  listLocalDrafts,
  subscribeDraftDeletions,
  storageFailure,
  type LocalDraftRow,
} from '@hulao/shared'
import { accountKey, mode, localDraftsClearing } from '../services/data'
export function useLocalDraftManager() {
  const open = ref(false)
  const rows = ref<LocalDraftRow[]>([])
  const selected = ref<string[]>([])
  const keyword = ref('')
  const type = ref('')
  const state = ref('')
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const estimate = ref<number>()
  const phases: Record<string, string> = {
    editing: '编辑中',
    extracting: '提取中',
    reviewing: '待核对',
    submitting: '提交中',
    uncertain: '待核实',
    submitted: '已提交',
    discarded_local: '已放弃',
    saved_local: '本机版本',
    submitted_demo: '演示已提交',
  }
  const rowKey = (row: LocalDraftRow) => JSON.stringify([row.store, row.key])
  const filtered = computed(() =>
    rows.value.filter(
      (row) =>
        (!type.value || row.type === type.value) &&
        (!state.value || row.status === state.value) &&
        (!keyword.value.trim() ||
          (row.title + row.id)
            .toLowerCase()
            .includes(keyword.value.trim().toLowerCase())),
    ),
  )
  const selectedRows = computed(() =>
    filtered.value.filter(
      (row) => !row.protected && selected.value.includes(rowKey(row)),
    ),
  )
  const bytes = computed(() =>
    rows.value.reduce((sum, row) => sum + row.bytes, 0),
  )
  const formatBytes = (size: number) =>
    size >= 1024 * 1024
      ? (size / 1024 / 1024).toFixed(1) + ' MB'
      : Math.ceil(size / 1024) + ' KB'
  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      rows.value = await listLocalDrafts(mode, accountKey.value)
      selected.value = selected.value.filter((key) =>
        rows.value.some((row) => rowKey(row) === key && !row.protected),
      )
      try {
        estimate.value = (await navigator.storage?.estimate?.())?.usage
      } catch {
        estimate.value = undefined
      }
    } catch (failure) {
      error.value = storageFailure(failure)
    } finally {
      loading.value = false
    }
  }
  watch(open, (value) => {
    if (value) void refresh()
  })
  watch([keyword, type, state], () => {
    selected.value = []
  })
  function toggleAll(value: boolean) {
    selected.value = value
      ? filtered.value.filter((row) => !row.protected).map(rowKey)
      : []
  }
  async function remove(targets: LocalDraftRow[]) {
    if (busy.value || !targets.length) return
    busy.value = true
    localDraftsClearing.value = true
    error.value = ''
    try {
      await deleteLocalDrafts(mode, accountKey.value, targets)
      selected.value = []
      await refresh()
    } catch (failure) {
      error.value = storageFailure(failure)
    } finally {
      busy.value = false
      localDraftsClearing.value = false
    }
  }
  const unsubscribe = subscribeDraftDeletions(() => {
    if (open.value && !busy.value) void refresh()
  })
  onScopeDispose(unsubscribe)
  return {
    open,
    rows,
    selected,
    keyword,
    type,
    state,
    loading,
    busy,
    error,
    estimate,
    filtered,
    selectedRows,
    bytes,
    phases,
    rowKey,
    formatBytes,
    refresh,
    toggleAll,
    remove,
  }
}
