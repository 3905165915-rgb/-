<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { listAll, request, type Row } from './model'
import {
  object,
  rows,
  useWorkspaceAction,
  workspaceDate,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { matchesRuleReceipt } from './workspace-rule'
const props = defineProps<{ elderId: string }>()
const scope = useWorkspaceScope(),
  { active, management } = scope
const rule = ref<Row | null>(null),
  rules = ref<Row[]>([]),
  plans = ref<Row[]>([]),
  shifts = ref<Row[]>([]),
  staff = ref<Row[]>([])
const enabled = ref(false),
  activities = ref(false),
  preferences = ref(false),
  reason = ref(''),
  plan = ref(''),
  shift = ref(''),
  person = ref(''),
  planEnabled = ref(false),
  planReason = ref('')
const error = ref(''),
  notice = ref(''),
  loading = ref(false)
const action = useWorkspaceAction(() => props.elderId, 'automation'),
  { pending, busy, error: saveError } = action
let epoch = 0
const selectedShift = computed(() =>
  shifts.value.find((row) => row.id === shift.value),
)
const people = computed(() =>
  staff.value.filter(
    (row) =>
      Array.isArray(selectedShift.value?.caregiver_ids) &&
      selectedShift.value!.caregiver_ids.includes(row.id),
  ),
)
const selectedRule = computed(() =>
  rules.value.find(
    (row) => row.plan_id === plan.value && row.shift_id === shift.value,
  ),
)
async function load() {
  const ticket = ++epoch
  if (!scope.valid() || !management) return
  loading.value = true
  error.value = ''
  try {
    const [followup, scheduled, planRows, shiftRows, staffRows] =
      await Promise.all([
        request('/elders/' + encodeURIComponent(props.elderId) + '/automation'),
        request(
          '/elders/' + encodeURIComponent(props.elderId) + '/plan-automation',
        ),
        listAll('/care-plans?elder_id=' + encodeURIComponent(props.elderId)),
        listAll('/shifts'),
        listAll('/staff'),
      ])
    if (ticket !== epoch || !scope.valid()) return
    rule.value = object(followup)
    rules.value = rows(object(scheduled).items)
    if (
      rule.value.elder_id !== props.elderId ||
      rules.value.some((row) => row.elder_id !== props.elderId)
    )
      throw new Error('授权资料与当前老人不匹配。')
    enabled.value = rule.value.enabled === true
    const permitted = Array.isArray(rule.value.permitted_actions)
      ? rule.value.permitted_actions
      : []
    activities.value = permitted.includes('activity_invitation')
    preferences.value = permitted.includes('preference_check')
    plans.value = planRows.filter(
      (row) => row.elder_id === props.elderId && row.status === 'active',
    )
    shifts.value = shiftRows.filter((row) => row.status === 'open')
    staff.value = staffRows
  } catch (failure) {
    if (ticket === epoch && scope.valid()) {
      error.value = (failure as Error).message
      rule.value = null
      plans.value = []
      shifts.value = []
      staff.value = []
    }
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function validate(value: unknown) {
  const row = object(value)
  if (
    row.elder_id !== props.elderId ||
    !Number.isInteger(row.revision) ||
    typeof row.enabled !== 'boolean' ||
    !pending.value || !matchesRuleReceipt(row, pending.value, String(row.approved_by || ''))
  )
    throw new Error('授权回执异常，请重试原请求核实。')
  return row
}
async function saved(result: Row | null) {
  if (result && scope.valid()) {
    notice.value = '服务器已确认本次授权设置。'
    await load()
  }
}
async function save(kind: 'followup' | 'plan') {
  if (!scope.valid() || !management || pending.value) return
  error.value = ''
  notice.value = ''
  try {
    let body: Row, path: string
    if (kind === 'followup') {
      if (!rule.value || !reason.value.trim())
        throw new Error('请先读取当前设置并填写授权或停用原因。')
      const actions = [
        ...(activities.value ? ['activity_invitation'] : []),
        ...(preferences.value ? ['preference_check'] : []),
      ]
      if (enabled.value && !actions.length)
        throw new Error('请选择允许自动安排的询问类型。')
      body = {
        expected_revision: rule.value.revision,
        enabled: enabled.value,
        permitted_actions: actions,
        reason: reason.value.trim(),
      }
      path = '/automation'
    } else {
      if (
        !plans.value.some((row) => row.id === plan.value) ||
        !selectedShift.value ||
        !people.value.some((row) => row.id === person.value) ||
        !planReason.value.trim()
      )
        throw new Error('请选择已批准计划、开放班次、实际责任人并填写原因。')
      body = {
        expected_revision: selectedRule.value?.revision || 0,
        enabled: planEnabled.value,
        plan_id: plan.value,
        shift_id: shift.value,
        assigned_to: person.value,
        reason: planReason.value.trim(),
      }
      path = '/plan-automation'
    }
    await saved(
      await action.submit(
        '/elders/' + encodeURIComponent(props.elderId) + path,
        body,
        validate,
        'put',
      ),
    )
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
async function retry() {
  await saved(await action.retry(validate))
}
async function verify() {
  const attempt = pending.value
  if (!attempt || !scope.valid()) return
  error.value = ''
  try {
    const result = object(await request(attempt.path))
    if (!scope.valid() || pending.value?.key !== attempt.key) return
    const candidates = attempt.path.endsWith('/plan-automation') ? rows(result.items) : [result]
    const match = candidates.find(row => row.elder_id === props.elderId && matchesRuleReceipt(row, attempt, scope.owner?.userId))
    if (!match) throw new Error('服务器当前设置不能确认原请求已保存；已保留原提交，请核对最新状态后重试。')
    await saved(action.verifyReceipt(match, validate))
  } catch (failure) { if (scope.valid()) error.value = (failure as Error).message }
}
async function stopRule(row: Row) {
  const reason = typeof row.stop_reason === 'string' ? row.stop_reason.trim() : ''
  if (!reason || !scope.valid() || !management || pending.value) return
  await saved(await action.submit('/elders/' + encodeURIComponent(props.elderId) + '/plan-automation', { expected_revision: row.revision, enabled: false, plan_id: row.plan_id, shift_id: row.shift_id, assigned_to: row.assigned_to, reason }, validate, 'put'))
}
watch(
  () => props.elderId,
  () => {
    rule.value = null
    rules.value = []
    plans.value = []
    shifts.value = []
    staff.value = []
    plan.value = ''
    shift.value = ''
    person.value = ''
    void load()
  },
  { immediate: true },
)
watch(shift, () => {
  person.value = ''
})
watch(selectedRule, (row) => {
  planEnabled.value = row?.enabled === true
})
watch(active, (value) => {
  if (!value) {
    epoch++
    rule.value = null
    rules.value = []
    plans.value = []
    shifts.value = []
    staff.value = []
  }
})
onBeforeUnmount(() => {
  epoch++
})
</script>
<template>
  <section
    v-if="active && management"
    class="workspace-panel"
    aria-label="主管授权安排"
  >
    <header>
      <h3>主管授权安排</h3>
      <button
        type="button"
        :disabled="loading || busy"
        @click="load"
      >
        读取最新设置
      </button>
    </header>
    <p>
      只允许明确的活动邀请与意愿询问。不会自动修改评估、用药或照护要求；计划排期只执行已批准计划。
    </p>
    <p
      v-if="error || saveError"
      role="alert"
      class="workspace-error"
    >
      {{ error || saveError }}
    </p>
    <p
      v-if="notice"
      role="status"
    >
      {{ notice }}
    </p>
    <p
      v-if="pending"
      class="workspace-warning"
    >
      原授权提交回执待核实，已锁定原请求。若资料版本已变化，请先读取最新设置并核对服务器状态。
    </p>
    <button
      v-if="pending"
      type="button"
      :disabled="busy"
      @click="retry"
    >
      核实并重试原授权
    </button>
    <button
      v-if="pending"
      type="button"
      :disabled="busy"
      @click="verify"
    >
      核对服务器是否已保存原授权
    </button>
    <form @submit.prevent="save('followup')">
      <fieldset :disabled="loading || busy || !!pending || !rule">
        <legend>明确原文的跟进安排</legend>
        <label class="workspace-check"><input
          v-model="enabled"
          type="checkbox"
        >允许系统按明确的原文安排</label><label class="workspace-check"><input
          v-model="activities"
          type="checkbox"
        >活动邀请（需本人当次同意）</label><label class="workspace-check"><input
          v-model="preferences"
          type="checkbox"
        >生活偏好与意愿询问</label><label>设置原因<textarea
          v-model="reason"
          maxlength="1000"
          required
        /></label><button type="submit">
          保存跟进授权
        </button>
      </fieldset>
    </form>
    <form @submit.prevent="save('plan')">
      <fieldset :disabled="loading || busy || !!pending">
        <legend>已批准计划的排期</legend>
        <p
          v-if="!plans.length"
          class="muted"
        >
          暂无可选择的已批准计划；请先按机构流程完成评估与计划审批。
        </p>
        <label>已批准计划<select
          v-model="plan"
          required
        >
          <option value="">请选择计划</option>
          <option
            v-for="row in plans"
            :key="String(row.id)"
            :value="row.id"
          >
            {{ row.title || row.id }}
          </option>
        </select></label>
        <div class="workspace-form-grid">
          <label>实际班次<select
            v-model="shift"
            required
          >
            <option value="">请选择开放班次</option>
            <option
              v-for="row in shifts"
              :key="String(row.id)"
              :value="row.id"
            >
              {{ row.name || row.id }} · {{ workspaceDate(row.start_at) }}
            </option>
          </select></label><label>实际责任人<select
            v-model="person"
            required
          >
            <option value="">请选择成员</option>
            <option
              v-for="row in people"
              :key="String(row.id)"
              :value="row.id"
            >
              {{ row.display_name }}
            </option>
          </select></label>
        </div>
        <label class="workspace-check"><input
          v-model="planEnabled"
          type="checkbox"
        >自动按该计划与班次排期</label><label>设置原因<textarea
          v-model="planReason"
          maxlength="1000"
          required
        /></label><button type="submit">
          保存计划排期授权
        </button>
      </fieldset>
    </form>
    <details v-if="rules.length">
      <summary>当前计划排期授权</summary>
      <article
        v-for="row in rules"
        :key="String(row.id)"
        class="workspace-job"
      >
        <p>
          {{
            plans.find((plan) => plan.id === row.plan_id)?.title || row.plan_id
          }}
          ·
          {{
            staff.find((person) => person.id === row.assigned_to)?.display_name ||
              row.assigned_to
          }}
          · {{ row.enabled ? '已启用' : '已停用'
          }}{{ row.error_code ? '；需要重新核对计划、评估或班次' : '' }}
        </p>
        <template v-if="row.enabled">
          <label>停用原因<input
            v-model="row.stop_reason"
            maxlength="1000"
            :disabled="busy || !!pending"
          ></label><button
            type="button"
            :disabled="busy || !!pending || !row.stop_reason"
            @click="stopRule(row)"
          >
            停用此排期授权
          </button>
        </template>
      </article>
    </details>
  </section>
</template>
