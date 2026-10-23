import { computed, onScopeDispose, ref, toRaw, watch } from 'vue'
import {
  createTaskEditor,
  loadTaskEditor,
  saveTaskEditor,
  validateTaskEditor,
  canSendTaskAction,
  claimWriteAttempt,
  finishWriteAttempt,
  applyDemoTaskAction,
  loadDemoState,
  writeWorkingJournal,
  clearWorkingJournal,
  workingId,
  touchWorking,
  rememberTaskDraft,
  hasWriteAttempt,
  subscribeDraftDeletions,
  draftKey,
  storageFailure,
  type TaskEditor,
  isKnownStatus,
  taskStatusMeta,
  snapshotTaskEditor,
} from '@hulao/shared'
import { toUiError } from '@hulao/api-client'
import {
  accountKey,
  mode,
  gateway,
  queryClient,
  queryKey,
  fetchTasks,
  useTasks,
  refreshData,
  errorMessage,
  localDraftsClearing,
} from '../services/data'

export function useTaskAction(
  taskId: () => string,
  draftId: () => string | undefined = () => undefined,
  enabled: () => boolean = () => true,
) {
  const form = ref<TaskEditor>()
  const busy = ref(false)
  const loading = ref(false)
  const error = ref('')
  const message = ref('')
  const saved = ref(false)
  const savingNow = ref(false)
  const deleted = ref(false)
  const taskQuery = useTasks()
  const terminal = computed(() =>
    ['completed', 'not_done', 'cancelled'].includes(
      taskQuery.data.value?.find((task) => task.id === taskId())?.status ?? '',
    ),
  )
  const uncertain = computed(() =>
    ['submitting', 'uncertain'].includes(form.value?.phase ?? ''),
  )
  const submitted = computed(
    () => form.value?.phase === 'submitted' || terminal.value,
  )
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let saving = Promise.resolve()
  const baselines = new Map<string, number>()
  const errors = computed(() =>
    form.value ? validateTaskEditor(form.value) : [],
  )
  const canSend = computed(() =>
    Boolean(
      form.value &&
      canSendTaskAction(form.value) &&
      !busy.value &&
      !loading.value &&
      !uncertain.value &&
      !submitted.value &&
      !deleted.value &&
      !taskQuery.error.value &&
      taskQuery.data.value?.some(
        (task) =>
          task.id === taskId() && isKnownStatus(taskStatusMeta, task.status),
      ),
    ),
  )
  const saveStatus = computed(() =>
    savingNow.value ? '保存中' : saved.value ? '已保存到本机' : '有未保存修改',
  )
  const operationKey = (id: string) => JSON.stringify([mode, id])
  const snapshot = () => snapshotTaskEditor(toRaw(form.value!))
  async function initialize(fresh = false, durable = false) {
    if (!enabled()) return
    const current = ++generation
    clearTimeout(timer)
    loading.value = true
    savingNow.value = false
    error.value = ''
    message.value = ''
    saved.value = false
    deleted.value = false
    const id = taskId()
    if (durable && form.value) clearWorkingJournal('task', snapshot())
    form.value = undefined
    try {
      if (!id) return
      const restored = fresh
        ? undefined
        : await loadTaskEditor(mode, accountKey.value, id, draftId())
      const next = restored ?? createTaskEditor(id, mode, accountKey.value)
      if (fresh) next.localId = crypto.randomUUID()
      if (mode === 'demo' && !next.demoEpoch)
        next.demoEpoch = (await loadDemoState()).epoch
      if (
        next.phase !== 'submitted' &&
        ((await hasWriteAttempt(next.idempotencyKey)) ||
          (await hasWriteAttempt(operationKey(id))))
      ) {
        next.phase = 'uncertain'
      }
      if (current !== generation) return
      form.value = next
      rememberTaskDraft(next)
      if (next.persistedVersion !== undefined)
        baselines.set(workingId(next), next.persistedVersion)
      saved.value = Boolean(
        restored && next.editVersion === next.persistedVersion,
      )
      if (next.missingAttachments?.length)
        message.value = '部分附件尚未保存，请重新选择或移除缺失附件。'
      if (uncertain.value) message.value = '提交结果待核实，请勿重复提交。'
    } catch (failure) {
      if (current === generation) error.value = storageFailure(failure)
    } finally {
      if (current === generation) loading.value = false
    }
  }
  watch(
    () => [taskId(), draftId()],
    () => {
      void initialize()
    },
    { immediate: true },
  )
  async function save() {
    clearTimeout(timer)
    if (!form.value || localDraftsClearing.value || deleted.value) return false
    const next = snapshot()
    const current = generation
    const id = workingId(next)
    savingNow.value = true
    const queued = saving
      .catch(() => {})
      .then(async () => {
        if (localDraftsClearing.value) throw new Error('正在清理本机草稿')
        next.persistedVersion = baselines.get(id) ?? next.persistedVersion
        await saveTaskEditor(next)
        baselines.set(id, next.editVersion ?? 0)
        if (
          current === generation &&
          form.value &&
          workingId(form.value) === id
        ) {
          form.value.persistedVersion = next.editVersion
          if (form.value.editVersion !== next.editVersion)
            writeWorkingJournal('task', snapshot())
        }
      })
    saving = queued
    try {
      await queued
      if (
        current === generation &&
        form.value &&
        workingId(form.value) === id &&
        form.value.editVersion === next.editVersion
      ) {
        saved.value = true
        error.value = ''
      }
      return true
    } catch (failure) {
      if (current === generation) {
        saved.value = false
        error.value = '本机保存失败：' + storageFailure(failure)
      }
      return false
    } finally {
      if (current === generation && saving === queued) savingNow.value = false
    }
  }
  function journal() {
    if (!form.value || localDraftsClearing.value || deleted.value) return
    try {
      writeWorkingJournal('task', snapshot())
      rememberTaskDraft(form.value)
    } catch (failure) {
      error.value = '恢复日志保存失败：' + storageFailure(failure)
    }
  }
  function changed() {
    if (!form.value || localDraftsClearing.value || deleted.value) return
    touchWorking(form.value)
    saved.value = false
    journal()
    clearTimeout(timer)
    timer = setTimeout(() => {
      void save()
    }, 300)
  }
  function addFiles(event: Event) {
    const input = event.target as HTMLInputElement
    const files = [...(input.files ?? [])]
    if (
      !form.value ||
      busy.value ||
      uncertain.value ||
      submitted.value ||
      deleted.value
    )
      return
    if (
      form.value.attachments.length + files.length > 3 ||
      files.some((file) => file.size > 5 * 1024 * 1024)
    ) {
      error.value = '最多选择3个文件，每个不超过5MB。'
      input.value = ''
      return
    }
    form.value.attachments.push(...files)
    form.value.missingAttachments = form.value.missingAttachments?.filter(
      (name) => !files.some((file) => file.name === name),
    )
    changed()
    input.value = ''
    void save()
  }
  function removeMissing(name: string) {
    if (!form.value) return
    form.value.missingAttachments = form.value.missingAttachments?.filter(
      (item) => item !== name,
    )
    changed()
  }
  async function copyAsNew() {
    if (!form.value || busy.value || uncertain.value || submitted.value) return
    const source = snapshot()
    const next = snapshotTaskEditor(source)
    clearTimeout(timer)
    next.localId = crypto.randomUUID()
    next.idempotencyKey = crypto.randomUUID()
    next.persistedVersion = undefined
    next.editVersion = 0
    next.phase = 'editing'
    form.value = next
    deleted.value = false
    error.value = ''
    changed()
    if (await save()) {
      try {
        clearWorkingJournal('task', source)
      } catch {
        /* The independent draft is already durable. */
      }
      message.value = '当前内容已另存为独立草稿。'
    }
  }
  async function phase(value: TaskEditor['phase']) {
    if (!form.value) return false
    form.value.phase = value
    changed()
    return await save()
  }
  async function reconcile() {
    try {
      const rows = await queryClient.fetchQuery({
        queryKey: queryKey('tasks'),
        queryFn: fetchTasks,
        staleTime: 0,
      })
      const task = rows.find((item) => item.id === taskId())
      if (
        task &&
        ['completed', 'not_done', 'cancelled'].includes(task.status)
      ) {
        await phase('submitted')
        message.value =
          task.status === 'completed'
            ? '已核实任务为已完成。'
            : '已核实任务已结束。'
        if (form.value) await finishWriteAttempt(form.value.idempotencyKey)
        return true
      }
      message.value = '提交结果仍待核实，请勿重复提交。'
    } catch (failure) {
      error.value = '状态核实失败：' + errorMessage(failure)
    }
    return false
  }
  async function submit() {
    if (!form.value || !canSend.value) return
    busy.value = true
    error.value = ''
    message.value = ''
    let claimed = false
    let taskClaimed = false
    let attempted = false
    const attemptKey = form.value.idempotencyKey
    const taskKey = operationKey(form.value.taskId)
    try {
      if (!(await save())) return
      const latest = await queryClient.fetchQuery({
        queryKey: queryKey('tasks'),
        queryFn: fetchTasks,
        staleTime: 0,
      })
      const task = latest.find((item) => item.id === form.value!.taskId)
      if (!task || !isKnownStatus(taskStatusMeta, task.status)) {
        message.value = '任务不存在或状态未知，请刷新列表。'
        return
      }
      if (['completed', 'not_done', 'cancelled'].includes(task.status)) {
        await phase('submitted')
        message.value = '任务已结束，请以最新状态为准。'
        return
      }
      claimed = await claimWriteAttempt(attemptKey)
      if (!claimed) {
        await phase('uncertain')
        await reconcile()
        return
      }
      taskClaimed = await claimWriteAttempt(taskKey)
      if (!taskClaimed) {
        await finishWriteAttempt(attemptKey)
        claimed = false
        await phase('uncertain')
        await reconcile()
        return
      }
      if (!(await phase('submitting'))) return
      const next = snapshot()
      attempted = true
      if (mode === 'demo') {
        await applyDemoTaskAction(next)
        await finishWriteAttempt(attemptKey)
        await finishWriteAttempt(taskKey)
        await phase('submitted')
        message.value = '演示操作已保存。'
      } else {
        await gateway.completeTask(next.taskId, {
          result: next.result.trim(),
          idempotencyKey: next.idempotencyKey,
        })
        await phase('uncertain')
        await reconcile()
      }
      await refreshData()
    } catch (failure) {
      const kind = toUiError(failure).kind
      if (
        attempted &&
        mode === 'api' &&
        !['validation', 'forbidden', 'unauthorized'].includes(kind)
      ) {
        await phase('uncertain')
        message.value = '结果待核实，请勿重复提交。'
        await reconcile()
      } else {
        if (claimed) await finishWriteAttempt(attemptKey)
        if (taskClaimed) await finishWriteAttempt(taskKey)
        await phase('editing')
      }
      error.value = errorMessage(failure)
    } finally {
      if (!attempted && claimed && taskClaimed) {
        await finishWriteAttempt(attemptKey)
        await finishWriteAttempt(taskKey)
        if (form.value?.phase === 'submitting') await phase('editing')
      }
      busy.value = false
    }
  }
  const unsubscribe = subscribeDraftDeletions((rows) => {
    if (
      form.value &&
      rows.some(
        (row) =>
          row.store === 'taskEditors' &&
          row.key === draftKey(mode, accountKey.value, workingId(form.value!)),
      )
    ) {
      deleted.value = true
      clearTimeout(timer)
      saved.value = false
      error.value = '此草稿已被清理，可另存当前内容。'
    }
  })
  if (typeof window !== 'undefined')
    window.addEventListener('pagehide', journal)
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', journal)
  onScopeDispose(() => {
    clearTimeout(timer)
    generation++
    unsubscribe()
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', journal)
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', journal)
  })
  return {
    form,
    busy,
    loading,
    error,
    message,
    uncertain,
    submitted,
    saved,
    saveStatus,
    deleted,
    errors,
    canSend,
    save,
    changed,
    addFiles,
    removeMissing,
    copyAsNew,
    submit,
    reconcile,
    initialize,
    loadSaved: () => initialize(false, true),
  }
}
