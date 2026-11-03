<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listAll, request, WorkflowRequestError, type Row } from './model'
import { useWorkspaceScope } from './workspace-scope'
import { WorkflowRecovery, recoveryKey, withSubmissionLock, type PendingWrite } from './recovery'
import { admissionBeds, admissionCandidates, createdElderReceipt, newAdmissionPayload, newAdmissionReceipt } from './admission-journey'
const props = defineProps<{ elderId?: string }>()
const emit = defineEmits<{ changed: [] }>()
const router = useRouter(), scope = useWorkspaceScope()
interface Journey { step: number; mode: 'existing' | 'new'; elderId: string; bedId: string; name: string; contactName: string; contactPhone: string; notes: string; reason: string; elder: Row | null; receipt: Row | null }
const empty = (): Journey => ({ step: 0, mode: 'existing', elderId: props.elderId || '', bedId: '', name: '', contactName: '', contactPhone: '', notes: '', reason: '', elder: null, receipt: null })
const state = ref<Journey>(empty())
const elders = ref<Row[]>([]), beds = ref<Row[]>([]), busy = ref(false), loading = ref(false), error = ref(''), storageError = ref(''), pending = ref<PendingWrite>()
const candidates = computed(() => admissionCandidates(elders.value)), availableBeds = computed(() => admissionBeds(beds.value))
const selectedElder = computed(() => state.value.elder || candidates.value.find(row => row.id === state.value.elderId))
const selectedBed = computed(() => availableBeds.value.find(row => row.id === state.value.bedId))
const steps = ['选择或建立档案', '选择床位', '核对并办理入住', '完成入住']
let journal: WorkflowRecovery | undefined, epoch = 0
function persist() {
  if (!journal) throw new Error('入住办理日志未就绪，请先重新读取。')
  journal.save({ operation: 'new-admission', params: {}, body: JSON.parse(JSON.stringify(state.value)), phase: pending.value ? 'pending' : state.value.receipt ? 'succeeded' : 'editing', pending: pending.value, result: state.value.receipt })
}
function saveDraft() { if (scope.valid() && !busy.value && !pending.value) try { persist(); storageError.value = '' } catch (failure) { storageError.value = (failure as Error).message } }
async function load() {
  const ticket = ++epoch
  if (!scope.valid() || !scope.management) return
  loading.value = true; error.value = ''
  try {
    const [people, rooms] = await Promise.all([listAll('/elders'), listAll('/beds')])
    if (ticket !== epoch || !scope.valid()) return
    elders.value = people; beds.value = rooms
    if (state.value.elder && !pending.value && !state.value.receipt) state.value.elder = people.find(row => row.id === state.value.elder?.id) || state.value.elder
  } catch (failure) { if (ticket === epoch && scope.valid()) error.value = (failure as Error).message }
  finally { if (ticket === epoch) loading.value = false }
}
async function send(path?: string, payload?: Row) {
  if (busy.value || !scope.valid() || !scope.management || storageError.value) return
  if (!pending.value && (!path || !payload)) return
  busy.value = true; error.value = ''
  try {
    if (!journal) throw new Error('请重新读取入住办理日志。')
    await withSubmissionLock(journal.key, async () => {
      if (!scope.valid() || !journal!.isCurrent()) throw new Error('其他窗口已更新办理进度，请重新打开本页核对。')
      if (!pending.value) {
        const key = crypto.randomUUID()
        pending.value = { path: path!, method: 'post', payload, key, signature: JSON.stringify([path, payload]), retryable: true }
        try { persist() } catch (failure) { pending.value = undefined; throw failure }
      }
      const attempt = JSON.parse(JSON.stringify(pending.value!)) as PendingWrite
      const before = structuredClone(JSON.parse(JSON.stringify(state.value)))
      const response = await request(attempt.path, 'post', attempt.payload, attempt.key)
      if (!scope.valid()) return
      if (attempt.path === '/elders') {
        const elder = createdElderReceipt(response, attempt.payload as Row)
        state.value.elder = elder; state.value.elderId = String(elder.id); state.value.step = 1
      } else {
        const elderId = decodeURIComponent(attempt.path.split('/')[2])
        state.value.receipt = newAdmissionReceipt(response, elderId, attempt.payload as Row)
        state.value.elder = state.value.receipt.elder as Row; state.value.step = 3
      }
      pending.value = undefined
      try { persist() } catch (failure) { state.value = before; pending.value = attempt; throw failure }
      emit('changed')
    })
    await load()
  } catch (failure) {
    if (!scope.valid()) return
    const message = (failure as Error).message
    error.value = message
    if (failure instanceof WorkflowRequestError && [400, 403, 404, 409, 422].includes(failure.status)) {
      pending.value = undefined
      try { persist() } catch (saveFailure) { storageError.value = (saveFailure as Error).message }
      await load()
      error.value = message
    }
  } finally { busy.value = false }
}
async function personNext() {
  error.value = ''
  if (pending.value || busy.value) return
  if (state.value.mode === 'new') {
    if (!state.value.name.trim()) { error.value = '请填写老人姓名。'; return }
    await send('/elders', { name: state.value.name.trim(), ...(state.value.contactName.trim() ? { contact_name: state.value.contactName.trim() } : {}), ...(state.value.contactPhone.trim() ? { contact_phone: state.value.contactPhone.trim() } : {}), ...(state.value.notes.trim() ? { notes: state.value.notes.trim() } : {}) })
  } else {
    if (!candidates.value.some(row => row.id === state.value.elderId)) { error.value = '请选择待入住或已离院的老人。'; return }
    state.value.elder = candidates.value.find(row => row.id === state.value.elderId)!; state.value.step = 1; saveDraft()
  }
}
function review() {
  try { newAdmissionPayload(selectedElder.value, selectedBed.value, state.value.reason); state.value.step = 2; saveDraft() }
  catch (failure) { error.value = (failure as Error).message }
}
async function admit() {
  try { const body = newAdmissionPayload(selectedElder.value, selectedBed.value, state.value.reason); await send('/elders/' + encodeURIComponent(state.value.elderId) + '/admissions', body) }
  catch (failure) { error.value = (failure as Error).message }
}
function restart() {
  if (busy.value || pending.value) return
  if (!window.confirm('开始办理另一位老人入住？已保存的档案和入住记录会继续保留。')) return
  state.value = empty(); error.value = ''; saveDraft()
}
onMounted(() => {
  try {
    const owner = scope.owner
    if (!owner?.accountKey) return
    journal = new WorkflowRecovery(recoveryKey(owner.accountKey, 'new-admission', {}), localStorage, crypto.randomUUID())
    const saved = journal.restore()
    if (saved) {
      const draft = saved.body as unknown as Journey
      if (!steps[draft.step] || !['existing', 'new'].includes(draft.mode) || typeof draft.elderId !== 'string' || typeof draft.reason !== 'string') throw new Error('本机入住进度需要核实，请保留日志并查看服务器记录。')
      state.value = draft; pending.value = saved.pending
      if (pending.value && pending.value.path !== '/elders' && !/^\/elders\/[^/]+\/admissions$/.test(pending.value.path)) throw new Error('本机入住请求无法识别，请保留日志核实。')
    }
  } catch (failure) { storageError.value = (failure as Error).message }
  void load()
})
onBeforeUnmount(() => epoch++)
</script>
<template>
  <section
    v-if="scope.active.value && scope.management"
    class="admission-journey"
    aria-label="新入住办理"
    @input="saveDraft"
    @change="saveDraft"
  >
    <header>
      <div><h2>办理新入住</h2><p>选好老人和床位，再核对入住信息。</p></div><button
        type="button"
        :disabled="loading || busy"
        @click="load"
      >
        刷新可用档案与床位
      </button>
    </header>
    <ol class="admission-steps">
      <li
        v-for="(title,index) in steps"
        :key="title"
        :aria-current="state.step === index ? 'step' : undefined"
      >
        {{ index + 1 }} {{ title }}
      </li>
    </ol>
    <p
      v-if="error || storageError"
      class="admission-error"
      role="alert"
    >
      {{ storageError || error }}
    </p><p
      v-if="loading"
      role="status"
    >
      正在读取老人档案与可用床位…
    </p>
    <section
      v-if="pending"
      class="admission-pending"
    >
      <h3>原提交结果待核实</h3><p>{{ pending.path === '/elders' ? '建档' : '入住' }}请求已保留。继续核实使用同一请求编号和原内容。</p><button
        type="button"
        :disabled="busy"
        @click="send()"
      >
        核实原请求结果
      </button>
    </section>
    <fieldset :disabled="busy || loading || !!pending || !!storageError">
      <template v-if="state.step === 0">
        <div class="admission-mode">
          <label><input
            v-model="state.mode"
            type="radio"
            value="existing"
          >已有档案</label><label><input
            v-model="state.mode"
            type="radio"
            value="new"
          >首次建档</label>
        </div><label v-if="state.mode === 'existing'">选择老人<CareSelect v-model="state.elderId"><option value="">请选择待入住老人</option><option
          v-for="elder in candidates"
          :key="String(elder.id)"
          :value="String(elder.id)"
        >{{ elder.name }} · {{ elder.status === 'discharged' ? '已离院，办理再次入住' : '待入住' }}</option></CareSelect></label><template v-else>
          <div class="admission-grid">
            <label>老人姓名<input
              v-model="state.name"
              maxlength="100"
              required
            ></label><label>联系人姓名（选填）<input
              v-model="state.contactName"
              maxlength="100"
            ></label><label>联系电话（选填）<input
              v-model="state.contactPhone"
              maxlength="50"
              inputmode="tel"
            ></label>
          </div><label>照护注意事项（选填）<textarea
            v-model="state.notes"
            maxlength="2000"
            rows="3"
          /></label>
        </template><button
          type="button"
          class="admission-primary"
          @click="personNext"
        >
          {{ state.mode === 'new' ? '保存档案，继续选择床位' : '继续选择床位' }}
        </button>
      </template>
      <template v-if="state.step === 1">
        <h3>{{ selectedElder?.name }} · 选择入住床位</h3><label>空闲床位<CareSelect v-model="state.bedId"><option value="">请选择空闲床位</option><option
          v-for="bed in availableBeds"
          :key="String(bed.id)"
          :value="String(bed.id)"
        >{{ bed.room }} · {{ bed.label }} · 空闲</option></CareSelect></label><p v-if="!availableBeds.length">
          暂无空闲床位，请在下方床位管理中建立或核对床位后刷新。
        </p><label>入住说明<textarea
          v-model="state.reason"
          maxlength="2000"
          rows="3"
          placeholder="例如：本人及联系人已核对入住信息，安排本次入住。"
        /></label><div class="admission-actions">
          <button
            type="button"
            @click="state.step = 0; state.elder = null; state.mode = 'existing'; saveDraft()"
          >
            重新选择老人
          </button><button
            type="button"
            class="admission-primary"
            @click="review"
          >
            核对入住信息
          </button>
        </div>
      </template>
      <template v-if="state.step === 2">
        <h3>请核对本次入住</h3><dl><div><dt>老人</dt><dd>{{ selectedElder?.name }}</dd></div><div><dt>床位</dt><dd>{{ selectedBed?.room }} · {{ selectedBed?.label }}</dd></div><div><dt>入住说明</dt><dd>{{ state.reason }}</dd></div></dl><div class="admission-actions">
          <button
            type="button"
            @click="state.step = 1; saveDraft()"
          >
            返回修改
          </button><button
            type="button"
            class="admission-primary"
            @click="admit"
          >
            确认办理入住
          </button>
        </div>
      </template>
      <template v-if="state.step === 3">
        <h3>入住已完成</h3><p>{{ selectedElder?.name }}已入住{{ (state.receipt?.bed as Row)?.room }} · {{ (state.receipt?.bed as Row)?.label }}。</p><p>接下来核对评估，再制定照护安排。</p><div class="admission-actions">
          <button
            type="button"
            class="admission-primary"
            @click="router.push({ path: '/elders/' + encodeURIComponent(state.elderId), query: { section: 'assessment' } })"
          >
            进入评估与照护安排
          </button><button
            type="button"
            @click="restart"
          >
            办理下一位老人入住
          </button>
        </div><details><summary>查看入住凭证</summary><p>入住单：{{ (state.receipt?.admission as Row)?.id }}</p><p>登记时间：{{ (state.receipt?.admission as Row)?.registered_at }}</p></details>
      </template>
    </fieldset>
  </section>
</template>
<style scoped>
.admission-journey{background:var(--hl-surface,#fff);border:1px solid var(--hl-border,#d9e4dd);border-radius:16px;padding:24px;min-width:0;overflow-wrap:anywhere}.admission-journey header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}.admission-journey h2{margin:0}.admission-journey p{line-height:1.7}.admission-steps{list-style:none;display:flex;gap:14px;padding:0;flex-wrap:wrap;margin:24px 0}.admission-steps li{padding:10px 4px;border-bottom:3px solid #e1e9e3;color:#5b6e62}.admission-steps li[aria-current]{border-color:#287657;color:#225d46;font-weight:600}.admission-journey fieldset{border:0;padding:0;min-width:0}.admission-journey label:not(.admission-mode label){display:flex;flex-direction:column;gap:8px;margin:16px 0;min-width:0}.admission-journey input:not([type=radio]),.admission-journey textarea{box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;border:1px solid #bacfc1;border-radius:8px;color:inherit;background:white;font:inherit}.admission-journey button{min-height:44px;padding:10px 15px;border:1px solid #bed0c5;border-radius:9px;background:white;color:#265e47;font:inherit;cursor:pointer}.admission-journey button.admission-primary{background:#287456;border-color:#287456;color:white}.admission-journey button:disabled{opacity:.55;cursor:default}.admission-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}.admission-mode,.admission-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.admission-mode label{display:flex;gap:8px;align-items:center;min-height:44px}.admission-journey dd{margin:6px 0 18px;font-weight:600}.admission-journey dt{color:#5b6d61}.admission-error{color:#a92822}.admission-pending{background:#fff5df;border:1px solid #e4c98d;padding:16px;border-radius:12px;margin:16px 0}.admission-journey summary{min-height:44px;display:flex;align-items:center;cursor:pointer}@media(max-width:600px){.admission-journey{padding:16px}.admission-grid{grid-template-columns:1fr}.admission-steps{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px}}
</style>
