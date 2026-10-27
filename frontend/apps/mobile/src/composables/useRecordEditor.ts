import { computed, onScopeDispose, ref, toRaw } from 'vue'
import {
  canConfirm,
  createRecordEditor,
  listRecordEditors,
  loadRecordEditor,
  saveRecordEditor,
  touchRecordEditor,
  writeRecordJournal,
  clearRecordJournal,
  saveDemoManualRecord,
  saveDemoOriginal,
  loadDemoState,
  claimWriteAttempt,
  finishWriteAttempt,
  subscribeDraftDeletions,
  draftKey,
  type RecordDraft,
  type RecordEditor,
} from '@hulao/shared'
import { toUiError } from '@hulao/api-client'
import {
  mode,
  accountKey,
  gateway,
  errorMessage,
  refreshData,
  localDraftsClearing,
} from '../services/data'

function validDraft(value: unknown): value is RecordDraft {
  const draft = value as RecordDraft | null
  return Boolean(
    draft &&
    typeof draft.id === 'string' &&
    draft.id &&
    typeof draft.elderId === 'string' &&
    typeof draft.originalText === 'string' &&
    draft.fields &&
    ['observation', 'followUp', 'contactTarget'].every(
      (key) =>
        typeof draft.fields[key as keyof RecordDraft['fields']] === 'string',
    ) &&
    Array.isArray(draft.evidence) &&
    draft.evidence.every((item) => typeof item === 'string') &&
    Array.isArray(draft.warnings) &&
    draft.warnings.every((item) => typeof item === 'string'),
  )
}
export function useRecordEditor() {
  const editor = ref<RecordEditor>(createRecordEditor(mode, accountKey.value))
  const drafts = ref<RecordEditor[]>([])
  const busy = ref(false)
  const pendingSaves = ref(0)
  const savingLocal = computed(() => pendingSaves.value > 0)
  const saved = ref(false)
  const saveError = ref('')
  const error = ref('')
  const notice = ref('')
  const deleted = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let saving = Promise.resolve()
  const baselines = new Map<string, number>()
  const confirmable = computed(
    () =>
      !deleted.value &&
      canConfirm(editor.value) &&
      Boolean(editor.value.review.observation.trim()),
  )
  const frozen = computed(() =>
    ['submitting', 'submitted', 'uncertain', 'discarded_local'].includes(
      editor.value.phase,
    ),
  )
  function snapshot() {
    return structuredClone(toRaw(editor.value))
  }
  function matchesSource(source: RecordEditor) {
    const current = editor.value
    return (
      source.localId === current.localId &&
      source.elderId === current.elderId &&
      source.sourceRevision === current.sourceRevision &&
      source.text === current.text
    )
  }
  async function checkDemoEpoch(source: RecordEditor) {
    if (mode === 'demo' && source.demoEpoch !== (await loadDemoState()).epoch)
      throw new Error('演示数据已重置，请新建草稿后继续。')
  }
  function changed(sourceChanged = false) {
    if (localDraftsClearing.value || deleted.value) return
    if (
      sourceChanged &&
      ['reviewing', 'extracting'].includes(editor.value.phase)
    )
      editor.value.phase = 'editing'
    touchRecordEditor(editor.value, sourceChanged)
    saved.value = false
    try {
      writeRecordJournal(snapshot())
    } catch (failure) {
      saveError.value = '恢复日志保存失败：' + errorMessage(failure)
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      void persist()
    }, 300)
  }
  async function list() {
    drafts.value = await listRecordEditors(mode, accountKey.value)
  }
  async function persist() {
    clearTimeout(timer)
    if (localDraftsClearing.value || deleted.value) return false
    const next = snapshot()
    pendingSaves.value += 1
    saving = saving
      .catch(() => {})
      .then(() => {
        if (localDraftsClearing.value) throw new Error('正在清理本机草稿')
        next.persistedVersion =
          baselines.get(next.localId) ?? next.persistedVersion
        return saveRecordEditor(next).then(() => {
          baselines.set(next.localId, next.editVersion)
          if (editor.value.localId === next.localId) {
            editor.value.persistedVersion = next.editVersion
            if (editor.value.editVersion !== next.editVersion)
              writeRecordJournal(snapshot())
          }
        })
      })
    try {
      await saving
      if (
        editor.value.localId === next.localId &&
        editor.value.editVersion === next.editVersion
      ) {
        saved.value = true
        saveError.value = ''
      }
      try {
        await list()
      } catch {
        /* The committed draft remains saved if listing is unavailable. */
      }
      return true
    } catch (failure) {
      saveError.value = '本机保存失败：' + errorMessage(failure)
      saved.value = false
      return false
    } finally {
      pendingSaves.value -= 1
    }
  }
  async function initialize(localId?: string, elderId?: string) {
    deleted.value = false
    try {
      await list()
      const candidate = localId
        ? await loadRecordEditor(mode, accountKey.value, localId)
        : drafts.value.find(
            (item) => (!elderId || item.elderId === elderId) && !['submitted', 'discarded_local'].includes(item.phase),
          )
      clearTimeout(timer)
      if (candidate)
        editor.value =
          candidate.phase === 'submitting'
            ? { ...candidate, phase: 'uncertain' }
            : candidate
      else {
        editor.value = createRecordEditor(mode, accountKey.value, elderId)
        if (mode === 'demo')
          editor.value.demoEpoch = (await loadDemoState()).epoch
        if (localId) error.value = '未找到本账号的草稿，已新建空白草稿。'
      }
      if (editor.value.persistedVersion !== undefined)
        baselines.set(editor.value.localId, editor.value.persistedVersion)
      saveError.value = ''
      saved.value = Boolean(candidate)
      if (mode === 'demo' && candidate && !frozen.value) {
        const state = await loadDemoState()
        const original = state.originals?.find(row => row.localId === `${editor.value.localId}:${editor.value.sourceRevision}` && row.text === editor.value.text && row.elderId === editor.value.elderId)
        const result = state.drafts?.find(row => row.id === original?.draftId)
        if (original) {
          editor.value.originalId = original.id
          editor.value.originalRevision = editor.value.sourceRevision
        }
        if (result && !editor.value.ai) {
          editor.value.ai = { draft: result, localId: editor.value.localId, elderId: editor.value.elderId, sourceText: editor.value.text, sourceRevision: editor.value.sourceRevision }
          editor.value.review = { ...editor.value.review, ...result.fields }
          editor.value.phase = 'reviewing'
        }
      }
    } catch (failure) {
      saveError.value = '草稿恢复失败：' + errorMessage(failure)
    }
  }
  async function restore(localId: string) {
    if (busy.value || !(await persist())) return
    error.value = ''
    notice.value = ''
    await initialize(localId)
  }
  async function fresh() {
    if (busy.value) return
    let epoch: string | undefined
    try {
      if (mode === 'demo') epoch = (await loadDemoState()).epoch
    } catch (failure) {
      saveError.value = errorMessage(failure)
      return
    }
    if (
      (mode !== 'demo' || epoch === editor.value.demoEpoch) &&
      !(await persist())
    )
      return
    clearTimeout(timer)
    editor.value = createRecordEditor(mode, accountKey.value)
    deleted.value = false
    if (mode === 'demo') editor.value.demoEpoch = epoch
    saveError.value = ''
    error.value = ''
    notice.value = ''
    saved.value = false
  }
  async function copyAsNew() {
    if (busy.value || frozen.value) return
    const source = snapshot()
    const next = createRecordEditor(mode, accountKey.value, source.elderId)
    next.text = source.text
    next.review = structuredClone(source.review)
    if (mode === 'demo') {
      try {
        next.demoEpoch = (await loadDemoState()).epoch
      } catch (failure) {
        saveError.value = errorMessage(failure)
        return
      }
    }
    clearTimeout(timer)
    editor.value = next
    deleted.value = false
    error.value = ''
    notice.value = ''
    saveError.value = ''
    changed(true)
    if (await persist()) {
      try {
        clearRecordJournal(source)
        await list()
      } catch {
        /* The new draft is already committed. */
      }
      notice.value = '当前内容已另存为新草稿，请重新提取或手工核对。'
    }
  }
  async function extract() {
    if (busy.value || frozen.value || deleted.value) return
    error.value = ''
    notice.value = ''
    if (!editor.value.elderId || !editor.value.text.trim()) {
      error.value = '请选择老人并填写原文。'
      return
    }
    busy.value = true
    editor.value.phase = 'extracting'
    changed()
    const source = snapshot()
    try {
      if (!(await persist())) {
        editor.value.phase = 'editing'
        changed()
        return
      }
      await checkDemoEpoch(source)
      if (!matchesSource(source)) {
        notice.value = '原文已变更，请重新提取。'
        return
      }
      if (mode === 'demo') {
        const originalId = await saveDemoOriginal(source)
        if (!matchesSource(source)) { notice.value = '原文已变化，请保存当前版本后重新整理。'; return }
        editor.value.originalId = originalId
        editor.value.originalRevision = source.sourceRevision
        notice.value = '原文已保存到本机。正在整理相关信息。'
        changed()
        if (!(await persist())) return
      }
      const result: unknown = await gateway.extractRecord({
        text: source.text,
        elder_id: source.elderId,
        ...(mode === 'demo' ? { expectedEpoch: source.demoEpoch, sourceKey: `${source.localId}:${source.sourceRevision}` } : {}),
      })
      await checkDemoEpoch(source)
      const current = editor.value
      if (!matchesSource(source)) {
        notice.value = '原文已变更，本次提取结果未采用。'
        return
      }
      if (
        !validDraft(result) ||
        result.elderId !== source.elderId ||
        result.originalText !== source.text
      )
        throw new Error('AI结果与本次原文不匹配，请改用手工录入。')
      current.ai = {
        draft: structuredClone(result),
        localId: source.localId,
        elderId: source.elderId,
        sourceText: source.text,
        sourceRevision: source.sourceRevision,
      }
      current.review.observation = result.fields.observation
      current.review.followUp = result.fields.followUp
      current.review.contactTarget = result.fields.contactTarget
      current.phase = 'reviewing'
      changed()
      await persist()
      notice.value = mode === 'demo' ? '原文已保存到本机，整理结果已就绪。请核对后确认。' : notice.value
    } catch (failure) {
      if (editor.value.localId === source.localId) {
        editor.value.phase = 'editing'
        changed()
      }
      error.value = errorMessage(failure) + ' 可单独重试整理或继续手工录入。'
      if (mode === 'demo' && editor.value.originalId && editor.value.originalRevision === source.sourceRevision)
        notice.value = '原文已保存到本机。整理失败不影响已保存的内容。'
    } finally {
      busy.value = false
    }
  }
  async function discard() {
    if (busy.value || frozen.value) return
    if (!editor.value.discardReason.trim()) {
      error.value = '请填写放弃原因。'
      return
    }
    editor.value.phase = 'discarded_local'
    changed()
    if (await persist()) notice.value = '已在本机放弃；未通知服务端。'
  }
  async function submit(manual = false) {
    if (busy.value || frozen.value || deleted.value) return
    error.value = ''
    notice.value = ''
    if (
      !editor.value.elderId ||
      !editor.value.text.trim() ||
      !editor.value.review.observation.trim()
    ) {
      error.value = '请选择老人，填写原文和观察结果。'
      return
    }
    if (!manual && !confirmable.value) {
      error.value = '原文已变更，请重新提取后核对。'
      return
    }
    busy.value = true
    const source = snapshot()
    let attempted = false
    let claimed = false
    let confirmKey = ''
    try {
      await checkDemoEpoch(source)
      if (
        !matchesSource(source) ||
        source.editVersion !== editor.value.editVersion
      ) {
        notice.value = '内容已变更，请重新核对后提交。'
        return
      }
      editor.value.phase = 'submitting'
      changed()
      const intent = snapshot()
      if (!(await persist())) {
        editor.value.phase = manual ? 'editing' : 'reviewing'
        changed()
        return
      }
      await checkDemoEpoch(intent)
      if (
        !matchesSource(intent) ||
        intent.editVersion !== editor.value.editVersion
      ) {
        editor.value.phase = 'editing'
        changed()
        notice.value = '内容已变更，请重新核对后提交。'
        return
      }
      if (mode === 'api') {
        confirmKey = JSON.stringify([
          mode,
          manual ? 'manual-record' : 'record',
          manual ? intent.localId : intent.ai!.draft.id,
        ])
        claimed = await claimWriteAttempt(confirmKey)
        if (!claimed) {
          editor.value.phase = 'uncertain'
          changed()
          await persist()
          notice.value = '此草稿已有提交记录，结果待核实，请勿重复提交。'
          return
        }
      }
      if (
        !matchesSource(intent) ||
        intent.editVersion !== editor.value.editVersion
      ) {
        if (claimed) await finishWriteAttempt(confirmKey)
        editor.value.phase = 'editing'
        changed()
        notice.value = '内容已变更，请重新核对后提交。'
        return
      }
      attempted = true
      const result: unknown = manual
        ? mode === 'demo'
          ? await saveDemoManualRecord(intent)
          : await gateway.manualRecord(
              {
                elder_id: intent.elderId,
                raw_text: intent.text,
                review: {
                  observation: intent.review.observation,
                  followUp: intent.review.followUp,
                  contactTarget: '',
                },
              },
              intent.localId,
            )
        : await gateway.confirmRecord(intent.ai!.draft.id, {
            ...(mode === 'demo' ? { demoEpoch: intent.demoEpoch } : {}),
            taskCandidates: mode === 'demo' && intent.review.followUp.trim() ? [{ title: intent.review.followUp, assigned_to: intent.review.assigneeId, deadline_at: intent.review.dueAt ? (/(Z|[+-]\d{2}:\d{2})$/.test(intent.review.dueAt) ? intent.review.dueAt : `${intent.review.dueAt}:00+08:00`) : '' }] : intent.ai!.draft.taskCandidates,
            fields: {
              observation: intent.review.observation,
              followUp: intent.review.followUp,
              contactTarget: intent.review.contactTarget,
            },
          })
      editor.value.phase = 'submitted'
      if (result && typeof result === 'object' && 'record_id' in result && typeof result.record_id === 'string') editor.value.confirmedRecordId = result.record_id
      changed()
      if (mode === 'demo') notice.value = '记录已确认并保存到本机。' + (intent.review.followUp.trim() && result && typeof result === 'object' && 'task_ids' in result && Array.isArray(result.task_ids) && !result.task_ids.length ? '任务未生成，请补充责任人和期限后新建任务。' : '可在历史中查看。')
      else if (
        result &&
        typeof result === 'object' &&
        'record' in result &&
        'tasks' in result &&
        Array.isArray(result.tasks)
      )
        notice.value =
          '服务端记录已确认；关联任务 ' + result.tasks.length + ' 项。'
      else notice.value = '已提交；记录状态与任务结果请以服务端查询为准。'
      await persist()
      await refreshData()
    } catch (failure) {
      const kind = toUiError(failure).kind
      if (claimed && ['validation', 'forbidden', 'unauthorized'].includes(kind))
        await finishWriteAttempt(confirmKey)
      editor.value.phase =
        attempted &&
        mode === 'api' &&
        !['validation', 'forbidden', 'unauthorized'].includes(kind)
          ? 'uncertain'
          : matchesSource(source)
            ? source.phase
            : 'editing'
      changed()
      await persist()
      error.value = errorMessage(failure)
      if (editor.value.phase === 'uncertain')
        notice.value = '提交结果待核实，请联系主管核查，勿重复提交。'
    } finally {
      busy.value = false
    }
  }
  const unsubscribe = subscribeDraftDeletions((rows) => {
    if (
      rows.some(
        (row) =>
          row.store === 'recordEditors' &&
          row.key === draftKey(mode, accountKey.value, editor.value.localId),
      )
    ) {
      deleted.value = true
      clearTimeout(timer)
      saved.value = false
      saveError.value = '此草稿已被清理，请另存当前内容。'
    }
    void list().catch(() => {})
  })
  onScopeDispose(() => {
    unsubscribe()
    clearTimeout(timer)
  })
  return {
    editor,
    drafts,
    busy,
    savingLocal,
    saved,
    saveError,
    error,
    notice,
    frozen,
    confirmable,
    changed,
    persist,
    initialize,
    restore,
    fresh,
    copyAsNew,
    extract,
    discard,
    submit,
  }
}
