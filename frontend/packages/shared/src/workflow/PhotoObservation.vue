<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ImagePlus, RefreshCw, ShieldCheck, Upload, X } from 'lucide-vue-next'
import { readSession } from '../session'
import { request, requestBinary, requestBlob, type Row } from './model'
import { sameCareSession } from './task-care-context'
import { canReviewPhoto, parsePhotoRecovery, photoFileIssue, reviewedObservations, validatePhoto, validatePhotoAnalysis, validatePhotoPage, type PhotoRecovery } from './photo-observation'

const props = defineProps<{ elderId: string; attachmentId?: string; analysisId?: string; readOnly?: boolean }>()
const session = ref(readSession())
const manager = computed(() => ['admin', 'supervisor'].includes(session.value?.role || ''))
const photos = ref<Row[]>([]), selected = ref<Row | null>(null), analysis = ref<Row | null>(null)
const configured = ref<boolean | null>(null), file = ref<File | null>(null)
const preview = ref(''), photoUrl = ref(''), occurredAt = ref(localDateTime()), caption = ref('')
const observations = ref<string[]>([]), note = ref(''), error = ref('')
const busy = ref(false), loadingPhotos = ref(false)
const recovery = ref<PhotoRecovery>({})
const recoveryBlocked = ref(false)
const locked = computed(() => busy.value || recoveryBlocked.value || !!recovery.value.upload || !!recovery.value.review)
let epoch = 0
const fileName = computed(() => file.value?.name || '')
const stateLabels: Record<string, string> = {
  processing: '识别中', pending_review: '待人工核对', pending_management: '待主管审核',
  confirmed: '已确认', approved: '已审核', rejected: '已放弃', discarded: '来源已变化',
  visible_observations: '已整理可见观察', unable_to_determine: '无法判断', failed: '识别失败', unavailable: '识别未配置',
}
function localDateTime() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
function storageKey() { const s = session.value; return 'hulao:photo-requests:v1:' + JSON.stringify([s?.mode, s?.accountKey, s?.userId, s?.role, props.elderId]) }
function saveRecovery() { sessionStorage.setItem(storageKey(), JSON.stringify(recovery.value)) }
function readRecovery() {
  try { recovery.value = parsePhotoRecovery(sessionStorage.getItem(storageKey()) || '{}', props.elderId) }
  catch { recoveryBlocked.value = true; throw new Error('本机照片请求恢复日志无法读取，已暂停写入。请先核对服务器照片与审核状态，避免重复操作。') }
}
function releasePreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = '' }
function releasePhoto() { if (photoUrl.value) URL.revokeObjectURL(photoUrl.value); photoUrl.value = '' }
function clearSelection() { selected.value = null; analysis.value = null; observations.value = []; note.value = ''; releasePhoto() }
function reset() {
  epoch++; clearSelection(); releasePreview(); file.value = null; photos.value = []; configured.value = null
  occurredAt.value = localDateTime(); caption.value = ''; busy.value = false; loadingPhotos.value = false; error.value = ''; recovery.value = {}; recoveryBlocked.value = false
}
function current(ticket: number, elderId: string) {
  return ticket === epoch && props.elderId === elderId && sameCareSession(readSession(), session.value)
}
function signature(candidate: File) { return JSON.stringify([candidate.name, candidate.size, candidate.lastModified]) }
function chooseFile(event: Event) {
  if (busy.value || recoveryBlocked.value || recovery.value.review) return
  const target = event.target as HTMLInputElement, candidate = target.files?.[0]
  error.value = ''
  if (!candidate) return
  const issue = photoFileIssue(candidate)
  if (issue) { error.value = issue; target.value = ''; return }
  if (recovery.value.upload && signature(candidate) !== recovery.value.upload.signature) {
    error.value = '上次上传结果待核实，请重新选择原文件并重试原请求。'; target.value = ''; return
  }
  clearSelection(); releasePreview(); file.value = candidate; preview.value = URL.createObjectURL(candidate)
}
function applyAnalysis(row: Row) {
  const pending = recovery.value.review
  if (pending && pending.id === row.id && Number(row.revision) > Number(pending.payload.expected_revision)) {
    delete recovery.value.review; saveRecovery()
  }
  analysis.value = row; observations.value = reviewedObservations(row); note.value = ''
  const retry = recovery.value.review
  if (retry && retry.id === row.id) {
    observations.value = retry.payload.observations as string[]
    note.value = String(retry.payload.note)
  }
}
async function fetchPhotos(ticket: number, elderId: string) {
  const rows = validatePhotoPage(await request(`/attachments?elder_id=${encodeURIComponent(elderId)}&limit=100&offset=0`), elderId)
  if (current(ticket, elderId)) photos.value = rows
}
async function fetchPhoto(id: string, ticket: number, elderId: string) {
  const row = validatePhoto(await request(`/attachments/${encodeURIComponent(id)}`), elderId, id)
  if (!current(ticket, elderId)) return
  const blob = await requestBlob(`/attachments/${encodeURIComponent(id)}/content`)
  if (!current(ticket, elderId)) return
  if (blob.type !== 'image/jpeg' || !blob.size) throw new Error('照片内容格式异常。')
  releasePhoto(); selected.value = row; photoUrl.value = URL.createObjectURL(blob)
}
async function poll(row: Row, ticket: number, elderId: string) {
  applyAnalysis(row)
  for (let attempt = 0; row.status === 'processing' && attempt < 90; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (!current(ticket, elderId)) return
    row = validatePhotoAnalysis(await request(`/attachments/analyses/${encodeURIComponent(String(row.id))}`), elderId, String(row.attachment_id), String(row.id))
    if (!current(ticket, elderId)) return
    applyAnalysis(row)
  }
  if (row.status === 'processing') error.value = '识别仍在处理中，请稍后刷新恢复同一任务。'
}
async function resume(id: string, ticket: number, elderId: string) {
  const row = validatePhotoAnalysis(await request(`/attachments/analyses/${encodeURIComponent(id)}`), elderId, props.attachmentId || undefined, id)
  if (!current(ticket, elderId)) return
  await fetchPhoto(String(row.attachment_id), ticket, elderId)
  if (!current(ticket, elderId)) return
  await poll(row, ticket, elderId)
}
async function loadPhotos() {
  if (busy.value || recovery.value.review) return
  const ticket = ++epoch, elderId = props.elderId
  if (!elderId || session.value?.mode !== 'api' || !['admin', 'supervisor', 'caregiver'].includes(session.value.role || '')) return
  loadingPhotos.value = true; error.value = ''
  try { await fetchPhotos(ticket, elderId) }
  catch (failure) { showFailure(failure, ticket, elderId) }
  finally { if (ticket === epoch) loadingPhotos.value = false }
}
async function loadPhoto(row: Row) {
  if (busy.value || recovery.value.review || recovery.value.upload) return
  const ticket = ++epoch, elderId = props.elderId
  clearSelection(); busy.value = true; error.value = ''
  try {
    await fetchPhoto(String(row.id), ticket, elderId)
    const saved = recovery.value.analyze
    if (current(ticket, elderId) && saved && saved.attachmentId === row.id && saved.id) await resume(saved.id, ticket, elderId)
  } catch (failure) { showFailure(failure, ticket, elderId) }
  finally { if (ticket === epoch) busy.value = false }
}
function showFailure(failure: unknown, ticket: number, elderId: string) {
  if (current(ticket, elderId)) {
    if ((failure as { status?: number })?.status === 403) { clearSelection(); photos.value = [] }
    error.value = failure instanceof Error ? failure.message : '操作结果未确认，请使用原请求重试。'
  }
}
async function upload() {
  if (props.readOnly || recoveryBlocked.value || !file.value || !props.elderId || busy.value || !sameCareSession(readSession(), session.value)) return
  const ticket = ++epoch, elderId = props.elderId, currentFile = file.value
  busy.value = true; error.value = ''
  try {
    if (!recovery.value.upload) {
      const at = new Date(occurredAt.value)
      if (!Number.isFinite(at.getTime()) || at.getTime() > Date.now()) throw new Error('请填写有效且不晚于当前时间的观察时间。')
      const query = new URLSearchParams({ elder_id: elderId, occurred_at: at.toISOString(), caption: caption.value.trim() })
      recovery.value.upload = { key: crypto.randomUUID(), signature: signature(currentFile), query: String(query), type: currentFile.type as 'image/jpeg' | 'image/png' }
    }
    saveRecovery()
    const attempt = recovery.value.upload
    const row = validatePhoto(await requestBinary(`/attachments?${attempt.query}`, currentFile, attempt.type, attempt.key), elderId)
    if (!current(ticket, elderId)) return
    delete recovery.value.upload; saveRecovery(); file.value = null; releasePreview()
    await fetchPhotos(ticket, elderId)
    if (current(ticket, elderId)) await fetchPhoto(String(row.id), ticket, elderId)
  } catch (failure) { showFailure(failure, ticket, elderId) }
  finally { if (ticket === epoch) busy.value = false }
}
async function analyze() {
  if (props.readOnly || recoveryBlocked.value || !selected.value || busy.value || !configured.value || !sameCareSession(readSession(), session.value)) return
  const ticket = ++epoch, elderId = props.elderId, attachmentId = String(selected.value.id)
  busy.value = true; error.value = ''
  try {
    if (recovery.value.analyze?.attachmentId !== attachmentId) recovery.value.analyze = { key: crypto.randomUUID(), attachmentId }
    saveRecovery()
    const saved = recovery.value.analyze!
    const row = validatePhotoAnalysis(await request(`/attachments/${encodeURIComponent(attachmentId)}/analyze`, 'post', undefined, saved.key), elderId, attachmentId)
    if (!current(ticket, elderId)) return
    saved.id = String(row.id); saveRecovery()
    await poll(row, ticket, elderId)
  } catch (failure) { showFailure(failure, ticket, elderId) }
  finally { if (ticket === epoch) busy.value = false }
}
async function refreshAnalysis() {
  const id = String(analysis.value?.id || recovery.value.review?.id || recovery.value.analyze?.id || '')
  if (!id || busy.value) return
  const ticket = ++epoch, elderId = props.elderId
  busy.value = true; error.value = ''
  try { await resume(id, ticket, elderId) }
  catch (failure) { showFailure(failure, ticket, elderId) }
  finally { if (ticket === epoch) busy.value = false }
}
async function review(decision: 'confirm' | 'reject' | 'request_management') {
  if (props.readOnly || recoveryBlocked.value || !analysis.value || busy.value || !sameCareSession(readSession(), session.value)) return
  if (!canReviewPhoto(analysis.value, session.value?.role || null, decision)) { error.value = '当前状态或角色不能执行此审核操作。'; return }
  if (recovery.value.review && recovery.value.review.payload.decision !== decision) { error.value = '上次审核结果待核实，请重试原审核操作。'; return }
  if (!note.value.trim()) { error.value = '请填写核对说明。'; return }
  const items = observations.value.map(item => item.trim()).filter(Boolean)
  if (items.length > 20 || (decision !== 'reject' && !items.length)) { error.value = '人工核对观察需为1至20条；放弃时可为空。'; return }
  const ticket = ++epoch, elderId = props.elderId, id = String(analysis.value.id)
  busy.value = true; error.value = ''
  try {
    recovery.value.review ||= { key: crypto.randomUUID(), id, payload: { expected_revision: analysis.value.revision, decision, observations: items, note: note.value.trim() } }
    saveRecovery()
    const attempt = recovery.value.review
    const row = validatePhotoAnalysis(await request(`/attachments/analyses/${encodeURIComponent(id)}/review`, 'post', attempt.payload, attempt.key), elderId, String(selected.value?.id), id)
    if (!current(ticket, elderId)) return
    delete recovery.value.review; saveRecovery(); applyAnalysis(row)
    if (row.status === 'confirmed') await fetchPhotos(ticket, elderId)
  } catch (failure) { showFailure(failure, ticket, elderId) }
  finally { if (ticket === epoch) busy.value = false }
}
function setObservations(value: string) { if (!locked.value) observations.value = value.split('\n') }
function setNote(value: string) { if (!locked.value) note.value = value }
function fieldList(field: string): string[] { return ((analysis.value?.output as Row | null)?.[field] as string[]) || [] }
function requiresProfessionalReview() { return (analysis.value?.output as Row | null)?.requires_professional_review === true }
function inputValue(event: Event) { return (event.target as HTMLTextAreaElement).value }
function statusLabel(row: Row) { return stateLabels[String(row.id === selected.value?.id && analysis.value ? analysis.value.status : row.status)] || '状态待核实' }
async function initialize() {
  reset(); session.value = readSession(); const ticket = epoch, elderId = props.elderId
  if (!elderId || session.value?.mode !== 'api' || !['admin', 'supervisor', 'caregiver'].includes(session.value.role || '')) return
  loadingPhotos.value = true; busy.value = true
  try {
    if (!props.readOnly) readRecovery()
    if (props.readOnly) {
      if (props.analysisId) await resume(props.analysisId, ticket, elderId)
      else if (props.attachmentId) await fetchPhoto(props.attachmentId, ticket, elderId)
      return
    }
    const status = await request('/attachments/vision/status') as Row
    if (!current(ticket, elderId)) return
    if (typeof status.configured !== 'boolean') throw new Error('视觉服务状态格式异常。')
    configured.value = status.configured
    await fetchPhotos(ticket, elderId)
    if (!current(ticket, elderId)) return
    const id = props.analysisId || recovery.value.review?.id || recovery.value.analyze?.id
    if (id) await resume(id, ticket, elderId)
    else if (props.attachmentId) await fetchPhoto(props.attachmentId, ticket, elderId)
  } catch (failure) { showFailure(failure, ticket, elderId) }
  finally { if (ticket === epoch) { loadingPhotos.value = false; busy.value = false } }
}
function changed() { if (!sameCareSession(readSession(), session.value)) void initialize() }
function revoked() { reset(); session.value = null }
watch(() => [props.elderId, props.attachmentId, props.analysisId], () => { void initialize() })
onMounted(() => { void initialize(); window.addEventListener('focus', changed); window.addEventListener('storage', changed); window.addEventListener('hulao:unauthorized', revoked) })
onBeforeUnmount(() => { reset(); window.removeEventListener('focus', changed); window.removeEventListener('storage', changed); window.removeEventListener('hulao:unauthorized', revoked) })
</script>

<template>
  <section class="photo-observation" aria-label="照片辅助观察">
    <h4><ImagePlus :size="18" aria-hidden="true" />照片辅助观察</h4>
    <p class="warning">AI识别可能有误，不构成诊断或处置建议，请人工核对。专业处理请由有权限人员审核决定。</p>
    <p v-if="configured === false" class="muted" role="status">视觉服务当前未配置。照片可安全上传；不要把照片或识别结果当作已保存的正式观察。</p>
    <p v-else-if="configured === null && !readOnly" class="muted" role="status">正在检查视觉服务状态…</p>
    <p v-if="!elderId" class="muted">选择老人后可添加照片。</p>
    <template v-else>
      <div v-if="!readOnly" class="photo-form">
        <label>拍照或选择照片<input type="file" accept="image/jpeg,image/png" capture="environment" :disabled="busy || recoveryBlocked" @change="chooseFile" /></label>
        <label>观察时间<input v-model="occurredAt" type="datetime-local" :disabled="locked" required /></label>
        <label>照片说明<input v-model="caption" maxlength="1000" :disabled="locked" placeholder="可选，描述观察背景" /></label>
        <img v-if="preview" :src="preview" alt="待上传照片本机预览" class="preview" />
        <p v-if="fileName" class="muted">{{ fileName }} · {{ Math.ceil((file?.size || 0) / 1024) }} KB</p>
        <button v-if="file" type="button" :disabled="busy || recoveryBlocked" @click="upload"><Upload :size="16" aria-hidden="true" />{{ busy ? '上传中…' : '上传并保存照片' }}</button>
      </div>
      <p v-if="recovery.upload" class="warning" role="status">上传结果待核实，已固定原文件和原请求。刷新后请重新选择原文件，再重试上传。</p>
      <p v-if="recovery.review" class="warning" role="status">审核结果待核实，已锁定原审核内容。可重试原操作或核实服务器状态。</p>
      <button v-if="analysis || recovery.review || recovery.analyze?.id" type="button" :disabled="busy" @click="refreshAnalysis">核实服务器识别与审核状态</button>
      <div v-if="!readOnly" class="saved-photos">
        <div class="row-heading"><strong>已上传照片</strong><button type="button" aria-label="刷新已上传照片" :disabled="loadingPhotos || busy" @click="loadPhotos"><RefreshCw :size="16" /></button></div>
        <p v-if="loadingPhotos" class="muted" role="status">正在载入照片…</p>
        <p v-else-if="!photos.length" class="muted">暂无可查看的已上传照片。</p>
        <ul v-else><li v-for="photo in photos" :key="String(photo.id)"><button type="button" class="photo-choice" :disabled="busy" @click="loadPhoto(photo)"><span>{{ photo.caption || '照片观察' }} · {{ new Date(String(photo.occurred_at)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</span><span>{{ statusLabel(photo) }}</span></button></li></ul>
      </div>
      <div v-if="selected" class="photo-review">
        <img v-if="photoUrl" :src="photoUrl" alt="服务器授权读取的私有照片" class="preview" />
        <p>照片状态：{{ stateLabels[String(analysis?.status || selected.status)] || '状态待核实' }}<span v-if="analysis?.revision"> · 版本 {{ analysis.revision }}</span></p>
        <p v-if="analysis?.record_id" role="status">人工确认记录已创建：{{ analysis.record_id }}</p>
        <p v-if="analysis?.warning || analysis?.notice" class="warning">{{ analysis.warning }} {{ analysis.notice }}</p>
        <button v-if="!readOnly && !analysis && selected.status !== 'rejected'" type="button" :disabled="busy || configured !== true" @click="analyze"><ShieldCheck :size="16" aria-hidden="true" />{{ busy ? '正在识别…' : configured === false ? '视觉服务未配置' : '整理可见观察' }}</button>
        <p v-if="analysis && ['failed', 'unavailable', 'unable_to_determine'].includes(String(analysis.model_status))" class="muted">{{ analysis.model_status === 'unable_to_determine' ? '照片信息不足，无法判断；请勿据此推断正常或异常。可由人工补充观察。' : '识别不可用或失败；已上传照片保留，可手工补充观察。' }}</p>
        <p v-if="readOnly && observations.length">人工核对观察：{{ observations.join('；') }}</p>
        <template v-if="readOnly && analysis && Array.isArray(analysis.reviews)">
          <p v-for="(reviewed, index) in (analysis.reviews as Row[])" :key="index">审核说明：{{ reviewed.note }}</p>
        </template>
        <template v-if="!readOnly && analysis && ['pending_review', 'pending_management'].includes(String(analysis.status))">
          <label>人工核对观察<textarea :value="observations.join('\n')" :disabled="locked || (analysis.status === 'pending_management' && !manager)" rows="4" @input="setObservations(($event.target as HTMLTextAreaElement).value)" /></label>
          <p v-if="fieldList('missing_information').length">待补充：{{ fieldList('missing_information').join('、') }}</p>
          <p v-if="fieldList('verification_items').length">请核实：{{ fieldList('verification_items').join('、') }}</p>
          <label>核对说明<textarea :value="note" :disabled="locked || (analysis.status === 'pending_management' && !manager)" rows="2" @input="setNote(inputValue($event))" /></label>
          <p v-if="analysis.status === 'pending_management' && !manager" role="status">已提交主管审核，护理员不能绕过专业审核。</p>
          <div class="actions">
            <button v-if="analysis.status === 'pending_review' && !manager && !requiresProfessionalReview()" type="button" :disabled="busy" @click="review('confirm')">人工核对并保存正式记录</button>
            <button v-if="analysis.status === 'pending_review' && !manager && requiresProfessionalReview()" type="button" :disabled="busy" @click="review('request_management')">提交主管审核</button>
            <button v-if="manager" type="button" :disabled="busy" @click="review('confirm')">主管核对并保存正式记录</button>
            <button type="button" class="secondary" :disabled="busy || (analysis.status === 'pending_management' && !manager)" @click="review('reject')"><X :size="16" aria-hidden="true" />放弃此观察</button>
          </div>
        </template>
        <p v-if="analysis?.status === 'confirmed'" role="status">已由人工确认并生成正式记录；原图和审核记录保留在服务器。</p>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.photo-observation { min-width: 0; padding-block: 12px; border-block: 1px solid var(--hl-border, #dce3e7); overflow-wrap: anywhere; }
h4, .row-heading, .actions { display: flex; align-items: center; gap: 8px; }
h4 { margin: 0 0 10px; font-size: 16px; }
.photo-form, .photo-review { display: grid; gap: 10px; min-width: 0; margin-block: 12px; }
label { display: grid; gap: 6px; }
input, textarea { width: 100%; min-width: 0; min-height: 42px; padding: 8px; color: var(--hl-ink, #20282e); background: #fff; border: 1px solid var(--hl-border, #dce3e7); border-radius: 6px; }
input[type=file] { padding: 6px; }
textarea { resize: vertical; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; max-width: 100%; padding: 8px 12px; color: white; background: var(--hl-primary, #1767cf); border: 1px solid var(--hl-primary, #1767cf); border-radius: 6px; overflow-wrap: anywhere; }
button:disabled { opacity: .55; }
.secondary { color: var(--hl-ink, #20282e); background: #fff; border-color: var(--hl-border, #dce3e7); }
.preview { display: block; width: min(100%, 480px); max-height: 320px; object-fit: contain; background: #eef2f4; border-radius: 6px; }
.row-heading { justify-content: space-between; }
.row-heading button { min-width: 42px; padding: 8px; color: var(--hl-ink, #20282e); background: #fff; border-color: var(--hl-border, #dce3e7); }
ul { padding: 0; list-style: none; }
li { border-top: 1px solid var(--hl-border, #dce3e7); }
.photo-choice { display: flex; justify-content: space-between; width: 100%; color: var(--hl-ink, #20282e); text-align: left; background: #fff; border: 0; }
.photo-choice span { min-width: 0; }
.muted { color: var(--hl-muted, #5f6b73); }
.warning { padding: 8px; color: #714b08; background: #fff8e8; border-left: 3px solid #b7791f; }
.error { color: var(--hl-danger, #b52d38); }
.actions { flex-wrap: wrap; }
@media (max-width: 360px) { .photo-choice { align-items: flex-start; flex-direction: column; } }
</style>
