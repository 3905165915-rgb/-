<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { listAll, request, type Row } from './model'
import { careScenes } from './task-care-context'
import {
  careContentTypeDescriptions,
  careContentTypeLabels,
  careContentTypes,
  careHintScenes,
  careReminderOccasions,
  contentTypeRecommendation,
  defaultRecordWhat,
  supportsCareType,
  validateCareGuidance,
  validateCareLine,
  validCareDay,
  type CareContentType,
} from './care-arrangement'
import {
  object,
  rows,
  useWorkspaceAction,
  workspaceDate,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { date, localTime } from './workspace-time'
import { beijingDay } from '../demo-metrics'
import './elder-workspace.css'
const props = defineProps<{ elderId: string; mobile?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const scope = useWorkspaceScope()
const { active, management } = scope
const advice = ref<Row[]>([]),
  shifts = ref<Row[]>([]),
  staff = ref<Row[]>([])
const loading = ref(false),
  generating = ref(false),
  error = ref(''),
  notice = ref(''),
  scene = ref('activity'),
  open = ref(''),
  mode = ref('adopt')
const shift = ref(''),
  assignee = ref(''),
  due = ref(''),
  title = ref(''),
  criteria = ref(''),
  reason = ref(''),
  response = ref('unclear'),
  observation = ref(''),
  happened = ref(''),
  decision = ref('insufficient_evidence')
const adoptType = ref<CareContentType | ''>('')
const occasion = ref('before_activity')
const hintScene = ref('communication')
const recordWhat = ref('')
const hintInstruction = ref('')
const serviceDate = ref(beijingDay(Date.now()))
const capabilities = ref<Row | null>(null)
const directoryError = ref('')
const contentTypeOptions = careContentTypes.map((value) => ({
  value,
  label: careContentTypeLabels[value],
  description: careContentTypeDescriptions[value],
}))
const action = useWorkspaceAction(() => props.elderId, 'care-advice')
const { pending, busy, error: saveError } = action
let epoch = 0
const selectedShift = computed(() =>
  shifts.value.find((row) => row.id === shift.value),
)
const people = computed(() =>
  staff.value.filter(
    (row) =>
      Array.isArray(selectedShift.value?.caregiver_ids) &&
      selectedShift.value!.caregiver_ids.includes(row.id) &&
      (management || row.id === scope.owner?.userId),
  ),
)
function task(row: Row) {
  return row.task && typeof row.task === 'object' ? object(row.task) : null
}
function citations(row: Row) {
  return Array.isArray(row.citations) ? rows(row.citations) : []
}
function feedback(row: Row) {
  return Array.isArray(row.feedback) ? rows(row.feedback) : []
}
function alive(ticket: number) {
  return ticket === epoch && scope.valid()
}
async function load() {
  const ticket = ++epoch
  if (!scope.valid()) return
  loading.value = true
  error.value = ''
  try {
    const [adviceResult, shiftResult, staffResult] = await Promise.allSettled([
      request('/elders/' + encodeURIComponent(props.elderId) + '/care-advice'),
      listAll('/shifts'),
      listAll('/staff'),
    ])
    if (!alive(ticket)) return
    if (adviceResult.status === 'rejected') throw adviceResult.reason
    const result = adviceResult.value
    capabilities.value = object(result)
    const items = rows(object(result).items)
    if (
      items.some(
        (row) =>
          row.elder_id !== props.elderId ||
          typeof row.id !== 'string' ||
          ![
            'proposed',
            'adopted',
            'rejected',
            'pending',
            'enabled',
            'needs_adjustment',
            'disabled',
          ].includes(String(row.status)),
      )
    )
      throw new Error('建议资料与当前老人或状态不匹配。')
    advice.value = items
    shifts.value =
      shiftResult.status === 'fulfilled'
        ? shiftResult.value.filter((row) => row.status === 'open')
        : []
    staff.value = staffResult.status === 'fulfilled' ? staffResult.value : []
    directoryError.value =
      shiftResult.status === 'rejected' || staffResult.status === 'rejected'
        ? '排班或人员暂未读取，不能确认跟进任务；日常提示和本次提醒仍可核对。'
        : ''
  } catch (failure) {
    if (alive(ticket)) {
      error.value = (failure as Error).message
      advice.value = []
      capabilities.value = null
      shifts.value = []
      staff.value = []
    }
  } finally {
    if (alive(ticket)) loading.value = false
  }
}
async function generate() {
  if (!scope.valid() || generating.value || busy.value || pending.value) return
  const ticket = epoch
  generating.value = true
  error.value = ''
  try {
    const result = object(
      await request(
        '/elders/' +
          encodeURIComponent(props.elderId) +
          '/care-advice/generate',
        'post',
        { scene: scene.value },
        undefined,
        120000,
      ),
    )
    if (!alive(ticket)) return
    rows(result.items)
    notice.value =
      result.model_status === 'demo'
        ? '演示建议，仅供核对流程；请以本人实际意愿和有效资料为准。'
        : '已根据可核对资料整理建议，请先看依据和适用条件。'
    await load()
  } catch (failure) {
    if (alive(ticket)) error.value = (failure as Error).message
  } finally {
    generating.value = false
  }
}
function begin(row: Row, intent: string) {
  if (busy.value || loading.value || pending.value || !scope.valid()) return
  open.value = String(row.id)
  mode.value = intent
  shift.value = ''
  assignee.value = ''
  due.value = ''
  reason.value = ''
  adoptType.value = ''
  occasion.value = 'before_activity'
  recordWhat.value = ''
  hintInstruction.value = ''
  serviceDate.value = beijingDay(Date.now())
  hintScene.value = 'communication'
  observation.value = ''
  response.value = 'unclear'
  decision.value = 'insufficient_evidence'
  title.value = String(row.action || row.title || '')
  criteria.value = '询问并记录本人当次意愿、实际回应及是否需要调整'
  happened.value = localTime(new Date())
  const assigned = task(row)
  if (intent === 'feedback' && assigned) {
    shift.value = String(assigned.shift_id || '')
    assignee.value = String(assigned.assigned_to || '')
  }
}
function validate(value: unknown) {
  const row = object(value),
    expected = pending.value?.path.split('/').at(-2)
  if (
    row.elder_id !== props.elderId ||
    row.id !== expected ||
    !Number.isInteger(row.revision) ||
    ![
      'proposed',
      'adopted',
      'rejected',
      'pending',
      'enabled',
      'needs_adjustment',
      'disabled',
    ].includes(String(row.status))
  )
    throw new Error('建议操作回执异常，请重试原提交核实。')
  if (pending.value?.path.endsWith('/adopt')) {
    const type = pending.value.body.content_type
    if (
      Number(row.revision) <= Number(pending.value.body.expected_revision) ||
      row.status !== 'adopted'
    )
      throw new Error('建议采用回执的状态或版本未确认，请核实原提交。')
    if (type === 'routine_hint' || type === 'one_off_reminder') {
      const guidance = validateCareGuidance(row.guidance, props.elderId)
      if (
        row.content_type !== type ||
        guidance.content_type !== type ||
        row.task ||
        (row.created_tasks !== undefined &&
          (!Array.isArray(row.created_tasks) || row.created_tasks.length))
      )
        throw new Error('提示或本次提醒不应关联任务，请核实服务端处理结果。')
    } else if (
      !task(row) ||
      task(row)!.elder_id !== props.elderId ||
      (task(row)!.content_type !== undefined &&
        task(row)!.content_type !== 'followup_task')
    )
      throw new Error('任务采用回执缺少正确的关联任务，请核实原提交。')
  }
  return row
}
async function done(row: Row | null) {
  if (row && scope.valid()) {
    open.value = ''
    emit('changed')
    notice.value =
      '服务器已确认本次操作。反馈仅记录执行与感受，不代表建议造成效果。'
    await load()
  }
}
async function retry() {
  await done(await action.retry(validate))
}
async function act(row: Row, intent: string) {
  if (!scope.valid() || pending.value || busy.value) return
  error.value = ''
  try {
    let body: Row = { expected_revision: row.revision }
    if (intent === 'adopt') {
      if (row.status !== 'proposed' || row.can_adopt !== true)
        throw new Error('这条建议当前不可采用，请重新读取。')
      if (!adoptType.value || !title.value.trim() || !reason.value.trim())
        throw new Error('请先选择采用方式、填写安排内容和采用说明。')
      if (!supportsCareType(capabilities.value, adoptType.value))
        throw new Error('当前服务尚未开放这种采用方式，请先与后端完成接入。')
      if (adoptType.value === 'followup_task') {
        if (directoryError.value) throw new Error(directoryError.value)
        if (
          !selectedShift.value ||
          !people.value.some((person) => person.id === assignee.value) ||
          !criteria.value.trim()
        )
          throw new Error('跟进任务请明确班次、负责人和执行要求。')
        body = {
          ...body,
          content_type: adoptType.value,
          task: {
            elder_id: props.elderId,
            title: title.value.trim(),
            shift_id: shift.value,
            assigned_to: assignee.value,
            due_at: date(due.value),
            completion_criteria: criteria.value.trim(),
            condition: row.condition || null,
            source_type: 'manual',
          },
          reason: reason.value.trim(),
        }
      } else {
        const lineErrors = validateCareLine(
          {
            title: title.value,
            scene: hintScene.value,
            instruction: hintInstruction.value,
            occasion: occasion.value,
            record_what: recordWhat.value,
          },
          adoptType.value,
        )
        if (lineErrors.length) throw new Error(lineErrors[0])
        if (
          adoptType.value === 'one_off_reminder' &&
          !validCareDay(serviceDate.value)
        )
          throw new Error('请核对本次服务日期。')
        body = {
          ...body,
          content_type: adoptType.value,
          scene:
            adoptType.value === 'routine_hint' ? hintScene.value : undefined,
          instruction:
            adoptType.value === 'routine_hint'
              ? hintInstruction.value.trim()
              : undefined,
          occasion:
            adoptType.value === 'one_off_reminder' ? occasion.value : undefined,
          record_what:
            adoptType.value === 'one_off_reminder'
              ? recordWhat.value.trim()
              : undefined,
          service_date:
            adoptType.value === 'one_off_reminder'
              ? serviceDate.value
              : undefined,
          title: title.value.trim(),
          condition: row.condition || null,
          reason: reason.value.trim(),
        }
      }
    } else if (intent === 'feedback') {
      const assigned = task(row)
      if (
        !assigned ||
        !['completed', 'not_done'].includes(String(assigned.status))
      )
        throw new Error('请先在任务页登记实际执行结果，再反馈本人回应。')
      if (!observation.value.trim())
        throw new Error('请填写实际观察，不能推断效果。')
      body = {
        ...body,
        expected_task_revision: assigned.revision,
        response: response.value,
        observation: observation.value.trim(),
        happened_at: date(happened.value),
        shift_id: assigned.shift_id,
        followup: 'none',
      }
    } else if (intent === 'review') {
      if (!management || !reason.value.trim())
        throw new Error('请填写复核依据和处理说明。')
      body = {
        ...body,
        expected_feedback_fingerprint: row.feedback_fingerprint,
        decision: decision.value,
        note: reason.value.trim(),
      }
    } else {
      if (!reason.value.trim()) throw new Error('请填写不采用原因。')
      body = { ...body, reason: reason.value.trim() }
    }
    await done(
      await action.submit(
        '/elders/' +
          encodeURIComponent(props.elderId) +
          '/care-advice/' +
          encodeURIComponent(String(row.id)) +
          '/' +
          intent,
        body,
        validate,
      ),
    )
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
function chooseType(value: CareContentType) {
  adoptType.value = value
  if (!recordWhat.value.trim() && value === 'one_off_reminder')
    recordWhat.value = defaultRecordWhat(value, title.value)
}
watch(
  () => props.elderId,
  () => {
    advice.value = []
    shifts.value = []
    staff.value = []
    open.value = ''
    notice.value = ''
    void load()
  },
  { immediate: true },
)
watch(shift, () => {
  if (!people.value.some((person) => person.id === assignee.value))
    assignee.value = ''
})
watch(active, (value) => {
  if (!value) {
    epoch++
    advice.value = []
    shifts.value = []
    staff.value = []
    open.value = ''
  }
})
onBeforeUnmount(() => {
  epoch++
})
</script>
<template>
  <section
    v-if="active"
    class="workspace-panel"
    aria-label="个性化生活照护安排"
  >
    <header>
      <h3>个性化生活照护安排</h3>
      <button type="button" :disabled="loading || busy" @click="load">
        刷新
      </button>
    </header>
    <p>
      建议依据正式记录整理；采用前核对本人当次意愿、条件与有效照护计划。执行反馈不能证明因果效果。
    </p>
    <div class="workspace-actions">
      <label
        >生活场景<select
          v-model="scene"
          :disabled="generating || busy || !!pending"
        >
          <option v-for="(label, key) in careScenes" :key="key" :value="key">
            {{ label }}
          </option>
        </select></label
      ><button
        type="button"
        :disabled="generating || loading || busy || !!pending"
        @click="generate"
      >
        {{ generating ? '正在整理…' : '整理可核对的照护建议' }}
      </button>
    </div>
    <p v-if="error || saveError" role="alert" class="workspace-error">
      {{ error || saveError }}
    </p>
    <p v-if="notice" role="status">
      {{ notice }}
    </p>
    <button v-if="pending" type="button" :disabled="busy" @click="retry">
      核实并重试原操作
    </button>
    <p v-if="!loading && !error && !advice.length" class="muted">
      暂无建议，可先记录实际观察。
    </p>
    <article
      v-for="row in advice"
      :key="String(row.id)"
      class="understanding-card"
    >
      <header>
        <strong>{{ row.title }}</strong
        ><span class="workspace-badge">{{
          row.status === 'adopted'
            ? row.content_type === 'routine_hint'
              ? '已采用为日常提示'
              : row.content_type === 'one_off_reminder'
                ? '已采用为本次提醒'
                : '已采用为跟进任务'
            : row.status === 'rejected'
              ? '未采用'
              : row.status === 'enabled'
                ? '已启用'
                : row.status === 'needs_adjustment'
                  ? '需调整'
                  : row.status === 'disabled'
                    ? '已停用'
                    : '待人工核对'
        }}</span>
      </header>
      <p>{{ row.action }}</p>
      <p v-if="contentTypeRecommendation(row)" class="muted">
        AI 建议采用方式：{{
          careContentTypeLabels[contentTypeRecommendation(row)!]
        }}，须由工作人员选择确认。
      </p>
      <p>依据：{{ row.rationale }}</p>
      <p class="workspace-warning">不确定性：{{ row.uncertainty }}</p>
      <p v-if="row.condition">执行前提：{{ row.condition }}</p>
      <p
        v-if="row.can_adopt !== true && row.status === 'proposed'"
        class="workspace-warning"
      >
        依据变化或建议已过期，请重新整理。
      </p>
      <details>
        <summary>查看原文依据</summary>
        <blockquote v-for="(source, i) in citations(row)" :key="i">
          {{ source.quote }}
          <footer>{{ source.source_id }}</footer>
        </blockquote>
      </details>
      <p v-if="task(row)">
        已关联任务：{{ task(row)!.title }} ·
        <RouterLink
          :to="
            mobile
              ? '/tasks/' + encodeURIComponent(String(task(row)!.id))
              : {
                  path: '/tasks',
                  query: { task: String(task(row)!.id), elder: elderId },
                }
          "
        >
          办理执行结果
        </RouterLink>
      </p>
      <details v-if="feedback(row).length">
        <summary>执行与本人回应（{{ feedback(row).length }} 条）</summary>
        <blockquote v-for="item in feedback(row)" :key="String(item.id)">
          {{ item.observation }}
          <footer>
            {{ workspaceDate(item.happened_at) }} ·
            {{ item.source_current ? '依据当前有效' : '依据需重新核对' }}
          </footer>
        </blockquote>
      </details>
      <div class="workspace-actions">
        <button
          v-if="row.status === 'proposed' && row.can_adopt === true"
          type="button"
          :disabled="busy || !!pending"
          @click="begin(row, 'adopt')"
        >
          采用并选择处理方式</button
        ><button
          v-if="row.status === 'proposed'"
          type="button"
          :disabled="busy || !!pending"
          @click="begin(row, 'reject')"
        >
          不采用</button
        ><button
          v-if="
            row.status === 'adopted' &&
            task(row) &&
            ['completed', 'not_done'].includes(String(task(row)!.status))
          "
          type="button"
          :disabled="busy || !!pending"
          @click="begin(row, 'feedback')"
        >
          记录本人回应</button
        ><button
          v-if="management && row.needs_review"
          type="button"
          :disabled="busy || !!pending"
          @click="begin(row, 'review')"
        >
          复核继续或调整
        </button>
      </div>
      <form v-if="open === row.id" @submit.prevent="act(row, mode)">
        <fieldset :disabled="busy || !!pending">
          <legend>
            {{
              mode === 'adopt'
                ? '确认实际安排'
                : mode === 'feedback'
                  ? '本人实际回应'
                  : mode === 'review'
                    ? '主管复核'
                    : '不采用原因'
            }}
          </legend>
          <template v-if="mode === 'adopt'">
            <p>先选择采用方式；日常提示和本次提醒不会自动生成任务。</p>
            <div class="workspace-form-grid">
              <button
                v-for="option in contentTypeOptions"
                :key="option.value"
                type="button"
                :class="{ selected: adoptType === option.value }"
                :aria-pressed="adoptType === option.value"
                @click="chooseType(option.value)"
              >
                {{ option.label }}<small> · {{ option.description }}</small>
              </button>
            </div>
            <p
              v-if="adoptType && !supportsCareType(capabilities, adoptType)"
              role="status"
              class="workspace-warning"
            >
              当前后端尚未开放这种采用方式，不能确认保存。
            </p>
            <p
              v-if="adoptType === 'followup_task' && directoryError"
              role="alert"
            >
              {{ directoryError }}
            </p>
            <template v-if="adoptType">
              <label
                >安排内容<textarea v-model="title" maxlength="300" required />
              </label>
              <div
                v-if="adoptType === 'followup_task'"
                class="workspace-form-grid"
              >
                <label
                  >实际班次<select v-model="shift" required>
                    <option value="">请选择开放班次</option>
                    <option
                      v-for="item in shifts"
                      :key="String(item.id)"
                      :value="item.id"
                    >
                      {{ item.name || item.id }} ·
                      {{ workspaceDate(item.start_at) }}
                    </option>
                  </select></label
                ><label
                  >实际责任人<select v-model="assignee" required>
                    <option value="">请选择班次成员</option>
                    <option
                      v-for="person in people"
                      :key="String(person.id)"
                      :value="person.id"
                    >
                      {{ person.display_name }}
                    </option>
                  </select></label
                ><label
                  >截止时间（北京时间）<input
                    v-model="due"
                    type="datetime-local"
                    required
                /></label>
              </div>
              <label v-if="adoptType === 'followup_task'"
                >执行要求<textarea
                  v-model="criteria"
                  maxlength="2000"
                  required
                />
              </label>
              <template v-else-if="adoptType === 'routine_hint'">
                <label
                  >适用场景<select v-model="hintScene">
                    <option
                      v-for="(label, key) in careHintScenes"
                      :key="key"
                      :value="key"
                    >
                      {{ label }}
                    </option>
                  </select></label
                >
                <label
                  >照护提示<textarea
                    v-model="hintInstruction"
                    maxlength="2000"
                    required
                    placeholder="例如：放慢语速，一次只说一件事。"
                  />
                </label>
              </template>
              <template v-else-if="adoptType === 'one_off_reminder'">
                <label
                  >本次发生在<select v-model="occasion">
                    <option
                      v-for="(label, key) in careReminderOccasions"
                      :key="key"
                      :value="key"
                    >
                      {{ label }}
                    </option>
                  </select></label
                >
                <label
                  >需要记录什么<textarea
                    v-model="recordWhat"
                    maxlength="2000"
                    required
                    placeholder="记录老人是否愿意参加、选择其他活动、想休息，或暂未得到明确回应。"
                  />
                </label>
                <label
                  >本次服务日期（北京时间）<input
                    v-model="serviceDate"
                    type="date"
                    required
                /></label>
                <p>一次性意愿不会自动成为长期习惯。</p>
              </template>
            </template>
          </template>
          <template v-if="mode === 'feedback'">
            <label
              >本人回应<select v-model="response">
                <option value="accepted">愿意／接受</option>
                <option value="declined">不愿意／拒绝</option>
                <option value="unclear">表达不清</option>
                <option value="not_obtained">未取得回应</option>
              </select></label
            ><label
              >实际观察<textarea
                v-model="observation"
                maxlength="2000"
                required
                placeholder="写清发生了什么、本人如何表达，不推断效果"
              /></label
            ><label
              >发生时间（北京时间）<input
                v-model="happened"
                type="datetime-local"
                step="0.001"
                required
            /></label>
          </template>
          <label v-if="mode === 'review'"
            >复核结论<select v-model="decision">
              <option value="insufficient_evidence">证据不足，继续观察</option>
              <option value="continue_trial">继续尝试</option>
              <option value="adjust">需调整安排</option>
              <option value="stop">停止此尝试</option>
            </select></label
          ><label
            v-if="mode !== 'feedback' && (mode !== 'adopt' || !!adoptType)"
            >{{ mode === 'adopt' ? '采用说明' : '核对说明'
            }}<textarea v-model="reason" maxlength="2000" required />
          </label>
          <div class="workspace-actions">
            <button
              type="submit"
              :disabled="
                mode === 'adopt' &&
                (!adoptType || !supportsCareType(capabilities, adoptType))
              "
            >
              {{ mode === 'adopt' ? '确认采用' : '保存本次处理' }}</button
            ><button type="button" @click="open = ''">收起</button>
          </div>
        </fieldset>
      </form>
    </article>
  </section>
</template>
