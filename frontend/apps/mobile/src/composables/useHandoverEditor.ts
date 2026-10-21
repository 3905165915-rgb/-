import { computed, onScopeDispose, ref, toRaw, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  createHandoverEditor,
  listHandoverEditors,
  saveHandoverEditor,
  submitDemoHandover,
  loadDemoState,
  loadHandoverWorkingDraft,
  saveWorkingDraft,
  listWorkingDrafts,
  writeWorkingJournal,
  clearWorkingJournal,
  touchWorking,
  workingId,
  subscribeDraftDeletions,
  draftKey,
  storageFailure,
  type HandoverEditor,
} from '@hulao/shared'
import {
  accountKey,
  mode,
  queryKey,
  queryClient,
  refreshData,
  localDraftsClearing,
} from '../services/data'

export function useHandoverEditor(
  shiftId: () => string,
  draftId: () => string | undefined,
  validItems: () => string[],
) {
  const editor = ref<HandoverEditor>()
  const busy = ref(false)
  const savingNow = ref(false)
  const dirty = ref(false)
  const deleted = ref(false)
  const error = ref('')
  const message = ref('')
  const branches = ref<HandoverEditor[]>([])
  const versions = useQuery({
    queryKey: computed(() => queryKey('handover-editors', shiftId())),
    queryFn: () => listHandoverEditors(mode, accountKey.value, shiftId()),
    enabled: computed(() => Boolean(shiftId())),
  })
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let saving = Promise.resolve()
  const baselines = new Map<string, number>()
  const baselineKey = (draft: HandoverEditor) =>
    draftKey(draft.mode, draft.accountKey, draft.localId)
  const snapshot = () => structuredClone(toRaw(editor.value!))
  const activeKey = () =>
    'hulao:active-handover:' + draftKey(mode, accountKey.value, shiftId())
  const saveStatus = computed(() =>
    savingNow.value
      ? '保存中'
      : dirty.value
        ? '有未保存修改'
        : editor.value?.persistedVersion !== undefined
          ? '已保存到本机'
          : '尚未保存',
  )
  async function listBranches() {
    const current = generation
    const shift = shiftId()
    const account = accountKey.value
    const rows = (await listWorkingDrafts(
      'handover',
      mode,
      account,
      shift,
    )) as HandoverEditor[]
    if (
      current === generation &&
      shift === shiftId() &&
      account === accountKey.value
    )
      branches.value = rows
  }
  async function initialize(durable = false) {
    const current = ++generation
    const account = accountKey.value
    const shift = shiftId()
    clearTimeout(timer)
    if (durable && editor.value) clearWorkingJournal('handover', snapshot())
    editor.value = undefined
    branches.value = []
    dirty.value = false
    busy.value = false
    savingNow.value = false
    error.value = ''
    message.value = ''
    deleted.value = false
    try {
      const id = draftId() ?? sessionStorage.getItem(activeKey()) ?? shiftId()
      const restored = await loadHandoverWorkingDraft(mode, account, shift, id)
      const next = restored ?? createHandoverEditor(mode, account, shift)
      if (!restored) next.localId = id
      if (mode === 'demo' && !next.demoEpoch)
        next.demoEpoch = (await loadDemoState()).epoch
      if (
        current !== generation ||
        account !== accountKey.value ||
        shift !== shiftId()
      )
        return
      editor.value = next
      sessionStorage.setItem(activeKey(), next.localId)
      if (next.persistedVersion !== undefined)
        baselines.set(baselineKey(next), next.persistedVersion)
      dirty.value = Boolean(
        restored && next.editVersion !== next.persistedVersion,
      )
      if (dirty.value) message.value = '已恢复未保存的交班内容。'
      await listBranches()
    } catch (failure) {
      if (current === generation) error.value = storageFailure(failure)
    }
  }
  watch(
    () => [shiftId(), draftId(), accountKey.value],
    () => {
      void initialize()
    },
    { immediate: true },
  )
  function journal() {
    if (!editor.value || deleted.value || localDraftsClearing.value) return
    try {
      writeWorkingJournal('handover', snapshot())
      sessionStorage.setItem(activeKey(), editor.value.localId)
    } catch (failure) {
      error.value = '恢复日志保存失败：' + storageFailure(failure)
    }
  }
  function changed() {
    if (!editor.value || deleted.value || localDraftsClearing.value) return
    touchWorking(editor.value)
    dirty.value = true
    message.value = ''
    journal()
    clearTimeout(timer)
    timer = setTimeout(() => {
      void persist()
    }, 300)
  }
  async function persist() {
    clearTimeout(timer)
    if (!editor.value || deleted.value || localDraftsClearing.value)
      return false
    const next = snapshot()
    const current = generation
    savingNow.value = true
    const queued = saving
      .catch(() => {})
      .then(async () => {
        if (localDraftsClearing.value) throw new Error('正在清理本机草稿')
        next.persistedVersion =
          baselines.get(baselineKey(next)) ?? next.persistedVersion
        await saveWorkingDraft('handover', next)
        baselines.set(baselineKey(next), next.editVersion ?? 0)
        if (current === generation && editor.value?.localId === next.localId) {
          editor.value.persistedVersion = next.editVersion
          if (editor.value.editVersion !== next.editVersion) journal()
        }
      })
    saving = queued
    try {
      await queued
      if (
        current === generation &&
        editor.value?.localId === next.localId &&
        editor.value.editVersion === next.editVersion
      ) {
        dirty.value = false
        error.value = ''
      }
      return true
    } catch (failure) {
      if (current === generation) {
        dirty.value = true
        error.value = storageFailure(failure)
      }
      return false
    } finally {
      if (current === generation && saving === queued) savingNow.value = false
    }
  }
  async function save(submitDemo = false) {
    if (!editor.value || busy.value || deleted.value) return false
    if (
      submitDemo &&
      (mode !== 'demo' ||
        !editor.value.itemIds.length ||
        editor.value.itemIds.some((id) => !validItems().includes(id)))
    ) {
      error.value = '请选择当前有效的延续事项。'
      return false
    }
    busy.value = true
    error.value = ''
    message.value = ''
    const source = snapshot()
    const current = generation
    const matches = () =>
      current === generation &&
      source.shiftId === shiftId() &&
      source.accountKey === accountKey.value &&
      editor.value?.localId === source.localId &&
      editor.value?.editVersion === source.editVersion
    try {
      if (!(await persist())) return false
      if (!matches()) return false
      const previous = await listHandoverEditors(
        mode,
        source.accountKey,
        source.shiftId,
      )
      if (!matches()) return false
      const next: HandoverEditor = {
        ...source,
        localId: crypto.randomUUID(),
        version: Math.max(0, ...previous.map((row) => row.version)) + 1,
        persistedVersion: undefined,
        phase: 'saved_local',
        updatedAt: new Date().toISOString(),
      }
      await saveHandoverEditor(next)
      if (!matches()) return false
      if (submitDemo) {
        await submitDemoHandover(next)
        next.phase = 'submitted_demo'
        await saveHandoverEditor(next)
        if (!matches()) return false
        await refreshData()
      }
      if (!matches()) return false
      if (
        editor.value?.localId === source.localId &&
        editor.value.editVersion === source.editVersion
      ) {
        editor.value.version = next.version
        changed()
        await persist()
      }
      if (
        current !== generation ||
        source.shiftId !== shiftId() ||
        source.accountKey !== accountKey.value
      )
        return false
      message.value = submitDemo
        ? '演示交班已提交；版本 ' + next.version
        : '版本 ' + next.version + ' 已保存到本机。'
      await queryClient.invalidateQueries({
        queryKey: queryKey('handover-editors', source.shiftId),
      })
      return true
    } catch (failure) {
      if (current === generation) error.value = storageFailure(failure)
      return false
    } finally {
      if (current === generation) busy.value = false
    }
  }
  async function restore(version: HandoverEditor) {
    if (
      version.shiftId !== shiftId() ||
      version.accountKey !== accountKey.value ||
      version.mode !== mode
    ) {
      error.value = '此版本不属于当前班次或账号。'
      return
    }
    const generationAtStart = generation
    if (busy.value || (dirty.value && !(await persist()))) return
    if (generationAtStart !== generation || version.shiftId !== shiftId())
      return
    const current = editor.value!
    editor.value = {
      ...structuredClone(toRaw(version)),
      localId: current.localId,
      editVersion: current.editVersion,
      persistedVersion: current.persistedVersion,
      phase: 'editing',
    }
    changed()
    if ((await persist()) && generationAtStart === generation)
      message.value = '已恢复版本 ' + version.version + '；修改后将另存新版本。'
  }
  async function copyAsNew() {
    if (!editor.value || busy.value) return
    const generationAtStart = generation
    const source = snapshot()
    const next = structuredClone(source)
    next.localId = crypto.randomUUID()
    next.editVersion = 0
    next.persistedVersion = undefined
    editor.value = next
    deleted.value = false
    error.value = ''
    changed()
    if ((await persist()) && generationAtStart === generation) {
      try {
        clearWorkingJournal('handover', source)
      } catch {
        /* The independent draft is already durable. */
      }
      message.value = '当前交班内容已另存为独立草稿。'
    }
    await listBranches()
  }
  async function loadBranch(branch: HandoverEditor) {
    if (
      branch.shiftId !== shiftId() ||
      branch.accountKey !== accountKey.value ||
      branch.mode !== mode
    ) {
      error.value = '此草稿不属于当前班次或账号。'
      return
    }
    const generationAtStart = generation
    if (busy.value || (dirty.value && !(await persist()))) return
    if (generationAtStart !== generation || branch.shiftId !== shiftId()) return
    editor.value = structuredClone(toRaw(branch))
    deleted.value = false
    if (branch.persistedVersion !== undefined)
      baselines.set(baselineKey(branch), branch.persistedVersion)
    sessionStorage.setItem(activeKey(), branch.localId)
    dirty.value = branch.editVersion !== branch.persistedVersion
  }
  const unsubscribe = subscribeDraftDeletions((rows) => {
    if (
      editor.value &&
      rows.some(
        (row) =>
          row.store === 'handoverWorkingDrafts' &&
          row.key ===
            draftKey(mode, accountKey.value, workingId(editor.value!)),
      )
    ) {
      deleted.value = true
      clearTimeout(timer)
      error.value = '此交班草稿已被清理，可另存当前内容。'
    }
    void listBranches()
  })
  window.addEventListener('pagehide', journal)
  document.addEventListener('visibilitychange', journal)
  onScopeDispose(() => {
    clearTimeout(timer)
    generation++
    unsubscribe()
    window.removeEventListener('pagehide', journal)
    document.removeEventListener('visibilitychange', journal)
  })
  return {
    editor,
    busy,
    savingNow,
    dirty,
    deleted,
    error,
    message,
    branches,
    versions,
    saveStatus,
    changed,
    save,
    persist,
    restore,
    copyAsNew,
    loadBranch,
    loadSaved: () => initialize(true),
  }
}
