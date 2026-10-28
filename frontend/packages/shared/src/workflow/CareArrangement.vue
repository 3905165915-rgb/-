<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { request, type Row } from './model'
import {
  object,
  rows,
  useWorkspaceAction,
  workspaceDate,
  workspaceStorageKey,
} from './workspace-action'
import { useWorkspaceScope } from './workspace-scope'
import { localTime } from './workspace-time'
import './elder-workspace.css'
import { careScenes } from './task-care-context'
import {
  careContentTypeDescriptions,
  careContentTypeLabels,
  careContentTypes,
  careHintScenes,
  careReminderOccasions,
  contentTypeRecommendation,
  defaultRecordWhat,
  isCareContentType,
  validateCareLine,
  careArrangementBody,
  supportsCareType,
  validateCarePreview,
  validateCareArrangementReceipt,
  type CareContentType,
} from './care-arrangement'
const props = defineProps<{ elderId: string; mobile?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
interface ServiceLine extends Row {
  key: string
  title: string
  instruction: string
  times: string[]
  scene?: string
  occasion?: string
  record_what?: string
}
const scope = useWorkspaceScope()
const { active } = scope
const ctx = ref<Row | null>(null),
  step = ref(2),
  error = ref(''),
  loading = ref(false)
const contentType = ref<CareContentType | ''>('')
const title = ref('日常照护安排'),
  goal = ref('先询问本人当次意愿，尊重生活习惯并记录实际结果。')
const today = localTime(new Date()).slice(0, 10)
const serviceDate = ref(today)
const starts = ref(today),
  ends = ref(localTime(new Date(Date.now() + 6 * 86400000)).slice(0, 10))
const shiftId = ref(''),
  assignedTo = ref(''),
  preview = ref<Row | null>(null),
  saved = ref<Row | null>(null)
const lines = ref<ServiceLine[]>([])
const contentTypeOptions = careContentTypes.map((value) => ({
  value,
  label: careContentTypeLabels[value],
  description: careContentTypeDescriptions[value],
}))
const recommendedType = computed(() => contentTypeRecommendation(ctx.value))
const shifts = computed(() => (ctx.value ? rows(ctx.value.shifts) : []))
const confirmedMemories = computed(() =>
  ctx.value
    ? rows(ctx.value.memories)
        .filter(
          (memory) =>
            memory.status === 'confirmed' && memory.effective === true,
        )
        .slice(0, 5)
    : [],
)
const staff = computed(() =>
  ctx.value
    ? rows(ctx.value.staff).filter((u) => {
        const shift = shifts.value.find((s) => s.id === shiftId.value)
        return (
          shift &&
          Array.isArray(shift.caregiver_ids) &&
          shift.caregiver_ids.includes(String(u.id))
        )
      })
    : [],
)
const action = useWorkspaceAction(() => props.elderId, 'arrangement')
const { busy, pending, error: saveError } = action
const draftError = ref('')
const draftKey = computed(() =>
  workspaceStorageKey(scope.owner, props.elderId, 'arrangement-form'),
)
let restoring = false
let epoch = 0
function preserveDraft() {
  if (restoring || !scope.valid()) return true
  try {
    sessionStorage.setItem(draftKey.value, JSON.stringify(draftBody()))
    draftError.value = ''
    return true
  } catch {
    draftError.value = '本机安排草稿保存失败，请保持页面打开并检查网站存储。'
    return false
  }
}
function restoreDraft() {
  restoring = true
  try {
    const raw = sessionStorage.getItem(draftKey.value)
    if (raw) {
      const draft = object(JSON.parse(raw))
      if (
        typeof draft.title !== 'string' ||
        typeof draft.goal !== 'string' ||
        !Array.isArray(draft.items)
      )
        throw new Error('invalid')
      title.value = draft.title
      goal.value = draft.goal
      starts.value =
        typeof draft.starts_on === 'string' ? draft.starts_on : today
      ends.value = typeof draft.ends_on === 'string' ? draft.ends_on : today
      serviceDate.value =
        typeof draft.service_date === 'string' ? draft.service_date : today
      lines.value = rows(draft.items) as ServiceLine[]
      contentType.value = isCareContentType(draft.content_type)
        ? draft.content_type
        : ''
      shiftId.value = typeof draft.shift_id === 'string' ? draft.shift_id : ''
      assignedTo.value =
        typeof draft.assigned_to === 'string' ? draft.assigned_to : ''
    }
  } catch {
    draftError.value = '安排草稿无法完整恢复，请核对内容后重新预览。'
  } finally {
    restoring = false
  }
}
watch(
  [
    title,
    goal,
    starts,
    ends,
    serviceDate,
    lines,
    shiftId,
    assignedTo,
    contentType,
  ],
  () => preserveDraft(),
  { deep: true, flush: 'sync' },
)
function add() {
  lines.value.push({
    key: 'service-' + crypto.randomUUID().slice(0, 8),
    title: '',
    scene: 'other',
    instruction: '',
    occasion: 'before_activity',
    record_what: defaultRecordWhat(contentType.value || 'followup_task'),
    times: [localTime(new Date(Date.now() + 30 * 60000)).slice(11, 16)],
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    every_n_days: 1,
    window_minutes: 60,
    condition: null,
  })
}
async function load() {
  const ticket = ++epoch
  if (!scope.valid()) return
  loading.value = true
  error.value = ''
  try {
    const value = object(
      await request(
        '/elders/' + encodeURIComponent(props.elderId) + '/arrangement',
      ),
    )
    if (ticket !== epoch || !scope.valid()) return
    if (object(value.elder).id !== props.elderId)
      throw new Error('安排资料与当前老人不一致，请重新读取。')
    ctx.value = value
    if (!lines.value.length) {
      const previous = value.previous_plan ? object(value.previous_plan) : null
      if (previous) {
        title.value = String(previous.title)
        goal.value = String(previous.goal)
        lines.value = structuredClone(rows(previous.items)) as ServiceLine[]
        contentType.value = isCareContentType(previous.content_type)
          ? previous.content_type
          : ''
      } else add()
    }
    const clock = String((lines.value[0]?.times as string[])?.[0] || '10:00')
    const at = Date.parse(today + 'T' + clock + ':00+08:00')
    if (!shiftId.value)
      shiftId.value = String(
        shifts.value.find(
          (s) =>
            Date.parse(String(s.start_at)) <= at &&
            at < Date.parse(String(s.end_at)),
        )?.id || '',
      )
  } catch (failure) {
    if (ticket === epoch) error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function draftBody(): Row {
  return {
    title: title.value.trim(),
    goal: goal.value.trim(),
    starts_on: starts.value,
    ends_on: ends.value,
    service_date:
      contentType.value === 'one_off_reminder'
        ? serviceDate.value
        : localTime(new Date()).slice(0, 10),
    shift_id: shiftId.value,
    assigned_to: assignedTo.value,
    content_type: contentType.value || undefined,
    items: lines.value.map((line) => ({
      ...line,
      content_type: contentType.value || undefined,
    })),
  }
}
function body(): Row {
  if (!contentType.value) throw new Error('请先确认采用方式。')
  return careArrangementBody(draftBody(), contentType.value)
}
async function inspect() {
  if (busy.value || loading.value || pending.value) return
  if (!preserveDraft()) return
  if (!contentType.value) {
    error.value = '请先确认这条内容的采用方式。'
    step.value = 2
    return
  }
  if (!supportsCareType(ctx.value, contentType.value)) {
    error.value =
      '当前服务尚未声明支持这种采用方式，请与后端完成接入后再保存；草稿仍保留在本机。'
    return
  }
  if (
    contentType.value === 'followup_task' &&
    ctx.value?.needs_assessment === true
  ) {
    error.value = '跟进任务需要先补充有效评估；日常提示和本次提醒可独立核对。'
    return
  }
  const lineErrors = lines.value.flatMap((line, index) =>
    validateCareLine(line, contentType.value as CareContentType).map(
      (message) => `第 ${index + 1} 项：${message}`,
    ),
  )
  if (lineErrors.length) {
    error.value = lineErrors[0]
    return
  }
  loading.value = true
  error.value = ''
  const ticket = epoch
  try {
    const value = validateCarePreview(
      await request(
        '/elders/' + encodeURIComponent(props.elderId) + '/arrangement/preview',
        'post',
        body(),
      ),
      props.elderId,
      contentType.value,
    )
    if (ticket !== epoch || !scope.valid()) return
    preview.value = value
    step.value = 3
  } catch (failure) {
    if (ticket === epoch) error.value = (failure as Error).message
  } finally {
    if (ticket === epoch) loading.value = false
  }
}
function validate(value: unknown) {
  const type =
    pending.value?.body.content_type || contentType.value || 'followup_task'
  if (!isCareContentType(type)) throw new Error('原提交采用方式异常，请核实。')
  return validateCareArrangementReceipt(value, props.elderId, type)
}
function chooseContentType(value: string) {
  if (!isCareContentType(value)) return
  contentType.value = value
  lines.value.forEach((line) => {
    if (value === 'one_off_reminder' && !line.record_what?.trim())
      line.record_what = defaultRecordWhat(value, line.title)
    if (value === 'routine_hint' && !line.scene) line.scene = 'before_activity'
    if (value === 'one_off_reminder' && !line.occasion)
      line.occasion = 'before_activity'
    if (value === 'followup_task') {
      if (!Object.hasOwn(careScenes, String(line.scene))) line.scene = 'other'
      if (!Array.isArray(line.times) || !line.times.length)
        line.times = ['10:00']
    }
  })
}
async function confirm() {
  if (!scope.valid() || busy.value || loading.value || !preserveDraft()) return
  error.value = ''
  try {
    const result = pending.value
      ? await action.retry(validate)
      : preview.value &&
        (await action.submit(
          '/elders/' +
            encodeURIComponent(props.elderId) +
            '/arrangement/confirm',
          { ...body(), context_token: preview.value.context_token },
          validate,
        ))
    if (result && scope.valid()) {
      saved.value = result
      emit('changed')
      const type = object(result.plan).content_type
      if (isCareContentType(type)) contentType.value = type
      preview.value = null
      try {
        sessionStorage.removeItem(draftKey.value)
      } catch {
        draftError.value =
          '服务器已确认保存，但旧本机草稿未清除，请核对后再安排。'
      }
    }
  } catch (failure) {
    error.value =
      failure instanceof Error
        ? failure.message
        : '确认未完成，请保留页面并核实。'
  }
}
watch(shiftId, () => {
  if (restoring || !ctx.value) return
  if (!staff.value.some((s) => s.id === assignedTo.value)) assignedTo.value = ''
})
watch(
  () => props.elderId,
  () => {
    restoring = true
    ctx.value = null
    lines.value = []
    contentType.value = ''
    shiftId.value = ''
    assignedTo.value = ''
    step.value = 2
    preview.value = null
    saved.value = null
    restoreDraft()
    void load()
  },
  { immediate: true },
)
function arrangeAgain() {
  saved.value = null
  step.value = 2
  void load()
}
function revisePreview() {
  step.value = 2
  preview.value = null
}
onBeforeUnmount(() => epoch++)
</script>
<template>
  <section
    v-if="active && scope.management"
    class="workspace-panel"
    aria-label="照护安排"
  >
    <header>
      <h3>照护安排</h3>
      <span>安排内容 · 影响预览 · 确认</span>
    </header>
    <p
      v-if="error || saveError || draftError"
      role="alert"
      class="workspace-error"
    >
      {{ error || saveError || draftError }}
    </p>
    <p v-if="loading" role="status">正在核对资料与排班…</p>
    <template v-if="saved"
      ><h4>安排已保存</h4>
      <p>{{ saved.notice }}</p>
      <p v-if="contentType === 'followup_task'">
        已建立 {{ (saved.created_tasks as Row[]).length }} 项服务任务。
      </p>
      <p
        v-if="
          contentType === 'followup_task' &&
          !(saved.created_tasks as Row[]).length
        "
        class="workspace-warning"
      >
        尚未落实可执行任务，请核对排班、负责人及预览中的未分配事项。
      </p>
      <p v-else>
        这条内容已按“{{
          careContentTypeLabels[contentType as CareContentType]
        }}”处理，不计入任务完成率。
      </p>
      <RouterLink
        :to="{ path: '/elders/' + elderId, query: { section: 'today' } }"
        >查看今日安排</RouterLink
      >
      <button type="button" @click="arrangeAgain">调整其他安排</button>
    </template>
    <template v-else>
      <p v-if="pending" class="workspace-warning">
        上次确认结果待核实，请重试原提交。
      </p>
      <button v-if="pending" type="button" :disabled="busy" @click="confirm">
        核实上次安排
      </button>
      <fieldset :disabled="busy || loading || !!pending">
        <template v-if="step === 2">
          <h4>安排内容</h4>
          <p v-if="ctx?.assessment">已带入当前有效评估。</p>
          <p v-if="confirmedMemories.length">
            已带入已确认的个性化信息；本人当次意愿优先。
          </p>
          <ul v-if="confirmedMemories.length">
            <li v-for="memory in confirmedMemories" :key="String(memory.id)">
              {{ memory.content }}
            </li>
          </ul>
          <p v-if="!ctx?.assessment" class="workspace-warning">
            尚无有效评估。日常提示和本次提醒可继续；需要任务排期时请先补齐有效评估。
          </p>
          <p>AI 推荐只作为参考，请由工作人员确认；未确认前不会进入任务表单。</p>
          <div class="content-type-grid" aria-label="采用方式">
            <button
              v-for="option in contentTypeOptions"
              :key="option.value"
              type="button"
              class="content-type-option"
              :class="{ selected: contentType === option.value }"
              :aria-pressed="contentType === option.value"
              @click="chooseContentType(option.value)"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.description }}</span>
              <small v-if="recommendedType === option.value">AI 建议</small>
            </button>
          </div>
          <p v-if="!contentType" class="workspace-warning">
            请选择一种采用方式后，再填写对应内容。
          </p>
          <template v-if="contentType">
            <p
              v-if="!supportsCareType(ctx, contentType)"
              class="workspace-warning"
              role="status"
            >
              当前后端尚未开放这种采用方式，可先编辑本机草稿，接入后才能确认保存。
            </p>
            <h4>
              {{
                contentType === 'routine_hint'
                  ? '日常提示：按生活场景提醒'
                  : contentType === 'one_off_reminder'
                    ? '本次照护提醒：记录这一次发生了什么'
                    : '跟进任务：明确需要交付的事项'
              }}
            </h4>
            <label>安排名称<input v-model="title" maxlength="200" /></label>
            <label>照护目标<textarea v-model="goal" rows="2" /></label>
            <div
              v-if="contentType === 'followup_task'"
              class="arrangement-grid"
            >
              <label>开始日期<input v-model="starts" type="date" /></label>
              <label>结束日期<input v-model="ends" type="date" /></label>
            </div>
            <label v-if="contentType === 'one_off_reminder'"
              >本次服务日期（北京时间）<input
                v-model="serviceDate"
                type="date"
                required
              />只用于所选日期的这一次照护。</label
            >
            <article
              v-for="(line, index) in lines"
              :key="String(line.key)"
              class="workspace-panel"
            >
              <label
                >服务内容<input v-model="line.title" maxlength="200"
              /></label>
              <label v-if="contentType === 'routine_hint'"
                  >适用场景<select v-model="line.scene" aria-label="适用场景">
                  <option
                    v-for="(name, key) in careHintScenes"
                    :key="key"
                    :value="key"
                  >
                    {{ name }}
                  </option>
                </select></label
              >
              <label v-else-if="contentType === 'one_off_reminder'"
                  >本次发生在<select v-model="line.occasion" aria-label="本次发生在">
                  <option
                    v-for="(name, key) in careReminderOccasions"
                    :key="key"
                    :value="key"
                  >
                    {{ name }}
                  </option>
                </select></label
              >
              <label v-else
                >服务场景<select v-model="line.scene">
                  <option
                    v-for="(name, key) in careScenes"
                    :key="key"
                    :value="key"
                  >
                    {{ name }}
                  </option>
                </select></label
              >
              <template v-if="contentType === 'followup_task'">
                <label v-for="(time, timeIndex) in line.times" :key="timeIndex"
                  >服务时间<input v-model="line.times[timeIndex]" type="time"
                /></label>
                <button
                  v-if="line.times.length > 1"
                  type="button"
                  @click="line.times.splice(1, 1)"
                >
                  移除附加时间
                </button>
                <button
                  v-if="line.times.length < 6"
                  type="button"
                  @click="line.times.push('15:00')"
                >
                  增加服务时间
                </button>
                <label
                  >执行要求<textarea v-model="line.instruction" rows="2" />
                </label>
              </template>
              <label v-else-if="contentType === 'routine_hint'"
                >照护提示<textarea
                  v-model="line.instruction"
                  rows="3"
                  placeholder="例如：放慢语速，一次只说一件事。"
                />
              </label>
              <label v-else
                >需要记录什么<textarea
                  v-model="line.record_what"
                  rows="3"
                  placeholder="记录老人是否愿意参加、选择其他活动、想休息，或暂未得到明确回应。"
                />
              </label>
              <p v-if="line.condition" class="workspace-warning">
                执行前提：{{
                  line.condition
                }}。已有前提将保留，核实满足后才可执行。
              </p>
              <button
                v-if="lines.length > 1"
                type="button"
                @click="lines.splice(index, 1)"
              >
                移除此项
              </button>
            </article>
            <button type="button" @click="add">增加一项服务</button>
            <div
              v-if="contentType === 'followup_task'"
              class="arrangement-grid"
            >
              <label
                >今日班次<select v-model="shiftId" aria-label="今日班次">
                  <option value="">待排班</option>
                  <option
                    v-for="shift in shifts"
                    :key="String(shift.id)"
                    :value="shift.id"
                  >
                    {{ shift.name }} · {{ workspaceDate(shift.start_at) }}
                  </option>
                </select></label
              >
              <label
                >负责人<select v-model="assignedTo" aria-label="负责人">
                  <option value="">待分配</option>
                  <option
                    v-for="person in staff"
                    :key="String(person.id)"
                    :value="person.id"
                  >
                    {{ person.display_name }}
                  </option>
                </select></label
              >
            </div>
            <p v-if="contentType === 'routine_hint'" class="muted">
              日常提示会按场景展示，不要求护理员每次沟通单独打卡，也不计入任务完成率。
            </p>
            <p v-else-if="contentType === 'one_off_reminder'" class="muted">
              本次提醒只记录这一次照护中的实际询问和回应，不会自动变成长期习惯。
            </p>
          </template>
          <div class="workspace-actions">
            <button type="button" :disabled="!contentType" @click="inspect">
              预览安排
            </button>
          </div>
        </template>
        <template v-if="step === 3 && preview">
          <h4>确认本次安排的影响</h4>
          <p v-if="contentType === 'followup_task'">
            本次仅生成今日所选班次的任务。后续日期需继续安排，或由主管另行授权自动排期。
          </p>
          <article
            v-for="(item, index) in preview.items as Row[]"
            :key="index"
            class="workspace-panel"
          >
            <strong>{{ item.title }}</strong>
            <p v-if="contentType === 'followup_task'">
              服务 {{ workspaceDate(item.scheduled_at) }} · 截止
              {{ workspaceDate(item.due_at) }} ·
              {{ item.assigned_to_name || item.assigned_to || '待分配' }}
            </p>
            <p v-else-if="contentType === 'routine_hint'">
              场景：{{
                careHintScenes[item.scene as keyof typeof careHintScenes] ||
                '待核实'
              }}
            </p>
            <p v-else>
              时机：{{
                careReminderOccasions[
                  item.occasion as keyof typeof careReminderOccasions
                ] || '待核实'
              }}
            </p>
            <p>
              {{
                item.record_what || item.instruction || '需要记录的内容待核实'
              }}
            </p>
          </article>
          <p
            v-for="(item, index) in (preview.unassigned_items as Row[]) || []"
            :key="'unassigned-' + index"
            class="workspace-warning"
          >
            尚未安排：{{ item.title }} ·
            {{ workspaceDate(item.scheduled_at) }}。{{ item.reason }}
          </p>
          <p v-if="preview.existing_task_count">
            已有 {{ preview.existing_task_count }} 项任务保留，不重复生成。
          </p>
          <p
            v-if="((preview.affected_task_ids as string[]) || []).length"
            class="workspace-warning"
          >
            原计划有
            {{ (preview.affected_task_ids as string[]).length }}
            项任务需重新核对。原任务和执行记录保留，不自动覆盖。
          </p>
          <div class="workspace-actions">
            <button type="button" @click="revisePreview">返回修改</button
            ><button type="button" @click="confirm">确认安排</button>
          </div>
        </template>
      </fieldset>
    </template>
  </section>
</template>
<style scoped>
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.arrangement-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.content-type-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 1rem 0 1.25rem;
}
.content-type-option {
  min-height: 8rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  text-align: left;
}
.content-type-option.selected {
  border-color: #1767cf;
  box-shadow: 0 0 0 2px rgb(23 103 207 / 12%);
}
.content-type-option span,
.content-type-option small {
  color: #5f6b73;
}
@media (max-width: 600px) {
  .arrangement-grid {
    grid-template-columns: 1fr;
  }
  .content-type-grid {
    grid-template-columns: 1fr;
  }
}
</style>
