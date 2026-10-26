<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { request, type Row } from './model'
import {
  assessmentStates,
  object,
  plainBody,
  rows,
  useWorkspaceAction,
  workspaceDate,
} from './workspace-action'
import {
  applyPrefill,
  blankAnswers,
  changeAnswer,
  checkedAnswers,
  type AssessmentItem,
} from './assessment-answers'
import { useWorkspaceScope } from './workspace-scope'
const props = defineProps<{ elderId: string }>()
const scope = useWorkspaceScope()
const { active, management } = scope
const items = ref<AssessmentItem[]>([])
const assessments = ref<Row[]>([])
const selected = ref<Row | null>(null)
const previous = computed(
  () =>
    assessments.value.find((row) =>
      ['confirmed', 'retired'].includes(String(row.status)),
    ) || null,
)
const answers = ref(blankAnswers([]))
const questions = ref<Record<string, string>>({})
const prefillEvidence = ref<Record<string, Row[]>>({})
const conflicts = ref<Record<string, boolean>>({})
const note = ref('')
const editing = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const due = ref('')
let epoch = 0
const action = useWorkspaceAction(() => props.elderId, 'assessment')
const { pending, busy, error: saveError } = action
const locked = computed(() => loading.value || busy.value || !!pending.value)
const complete = computed(
  () =>
    items.value.length > 0 &&
    items.value.every(
      (item) =>
        answers.value.scores[item.key] !== null &&
        answers.value.scores[item.key] !== undefined &&
        answers.value.checked[item.key],
    ),
)
const total = computed(() =>
  complete.value
    ? items.value.reduce(
        (sum, item) => sum + (answers.value.scores[item.key] ?? 0),
        0,
      )
    : null,
)
function editable(row: Row | null) {
  return row && ['draft', 'pending_observation'].includes(String(row.status))
}
function scoreLabel(key: string, score: unknown) {
  return (
    items.value
      .find((item) => item.key === key)
      ?.options.find((option) => option.score === score)?.label || '待观察'
  )
}
function priorScore(key: string) {
  return previous.value?.scores && object(previous.value.scores)[key]
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
    const [templates, response] = await Promise.all([
      request('/assessments/templates'),
      request('/assessments?elder_id=' + encodeURIComponent(props.elderId)),
    ])
    if (!alive(ticket)) return
    const first = rows(templates)[0]
    if (!first) throw new Error('评估量表暂不可用。')
    items.value = rows(first.items).map((item) => ({
      key: String(item.key),
      label: String(item.label),
      options: rows(item.options).map((option) => ({
        score: Number(option.score),
        label: String(option.label),
      })),
    }))
    assessments.value = rows(response)
    if (assessments.value.some((row) => row.elder_id !== props.elderId))
      throw new Error('评估资料与当前老人不匹配。')
    selected.value = assessments.value[0] || null
  } catch (failure) {
    if (alive(ticket)) error.value = (failure as Error).message
  } finally {
    if (alive(ticket)) loading.value = false
  }
}
async function start(row: Row | null = selected.value) {
  if (locked.value || !scope.valid()) return
  selected.value = row
  answers.value = blankAnswers(items.value)
  questions.value = {}
  prefillEvidence.value = {}
  conflicts.value = {}
  note.value = ''
  notice.value = ''
  due.value = ''
  if (editable(row)) {
    const saved = plainBody(row!)
    for (const item of items.value) {
      const score = object(saved.scores)[item.key]
      if (typeof score === 'number') answers.value.scores[item.key] = score
    }
    answers.value.sources = saved.item_sources
      ? (object(saved.item_sources) as Record<string, Row[]>)
      : {}
    answers.value.observations = saved.direct_observations
      ? (object(saved.direct_observations) as Record<string, string>)
      : {}
    note.value = String(saved.note || '')
    if (typeof saved.review_due_at === 'string')
      due.value = new Date(saved.review_due_at).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Shanghai',
      })
  }
  editing.value = true
  const ticket = epoch
  loading.value = true
  error.value = ''
  try {
    const value = await request(
      '/assessments/prefill',
      'post',
      { elder_id: props.elderId },
      undefined,
      120000,
    )
    if (!alive(ticket)) return
    questions.value = applyPrefill(
      answers.value,
      value,
      items.value,
      props.elderId,
    )
    for (const item of rows(object(value).items)) {
      prefillEvidence.value[String(item.item_key)] = rows(item.citations)
      conflicts.value[String(item.item_key)] = item.conflict === true
      if (item.conflict === true) {
        answers.value.sources[String(item.item_key)] = []
        answers.value.scores[String(item.item_key)] = null
      }
    }
    notice.value =
      object(value).model_status === 'demo'
        ? '当前为演示模式，请根据实际观察填写。'
        : '已定位近期记录。请核对答案、原文与变化，未观察项目保留待补充。'
  } catch (failure) {
    if (alive(ticket))
      error.value =
        '预填暂不可用，可直接根据实际观察填写。' + (failure as Error).message
  } finally {
    if (alive(ticket)) loading.value = false
  }
}
function changeScore(key: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  changeAnswer(answers.value, key, value === '' ? null : Number(value))
}
function validate(value: unknown) {
  const row = object(value)
  if (
    row.elder_id !== props.elderId ||
    typeof row.id !== 'string' ||
    !Object.hasOwn(assessmentStates, String(row.status)) ||
    !Number.isInteger(row.revision)
  )
    throw new Error('评估回执异常，请重试原提交核实。')
  if (row.status === 'pending_observation' && row.total_score !== null)
    throw new Error('未完成评估回执异常，请核实。')
  return row
}
function saved(result: Row | null) {
  if (!result || !scope.valid()) return
  editing.value = false
  selected.value = result
  assessments.value = [
    result,
    ...assessments.value.filter((row) => row.id !== result.id),
  ]
  notice.value =
    result.status === 'pending_observation'
      ? '已保存待补充；没有正式总分，不能作为照护计划依据。'
      : result.status === 'confirmed'
        ? '评估已确认。护理等级与收费依据须另按机构规则认定。'
        : '已保存，可由主管在本页核对确认。'
}
async function retry() {
  saved(await action.retry(validate))
}
async function save(intent: 'save' | 'submit' | 'confirm') {
  if (pending.value) {
    await retry()
    return
  }
  if (!scope.valid()) return
  error.value = ''
  notice.value = ''
  try {
    const saving = plainBody(
      answers.value as unknown as Row,
    ) as unknown as typeof answers.value
    // Saving a partial review must not delete previously saved, unchanged answers.
    if (intent === 'save' && editable(selected.value)) {
      const original = selected.value!
      const originalScores = object(original.scores)
      const originalSources = original.item_sources
        ? object(original.item_sources)
        : {}
      const originalObservations = original.direct_observations
        ? object(original.direct_observations)
        : {}
      for (const item of items.value) {
        const key = item.key
        if (
          saving.scores[key] === originalScores[key] &&
          JSON.stringify(saving.sources[key] || []) ===
            JSON.stringify(originalSources[key] || []) &&
          (saving.observations[key] || '') === (originalObservations[key] || '')
        )
          saving.checked[key] = true
      }
    }
    const chosen = checkedAnswers(saving, items.value)
    if (intent !== 'save' && !complete.value)
      throw new Error('请补齐并核对所有项目，或先保存待补充。')
    const review = new Date(due.value + 'T23:59:59+08:00')
    if (!Number.isFinite(review.valueOf()) || review.valueOf() <= Date.now())
      throw new Error('请选择未来的复评日期。')
    const body = {
      elder_id: props.elderId,
      ...chosen,
      assessed_at: new Date().toISOString(),
      review_due_at: review.toISOString(),
      note: note.value.trim() || '已核对本次观察，未观察项目保留待补充',
      action: intent,
      ...(editable(selected.value)
        ? {
            assessment_id: selected.value!.id,
            expected_revision: selected.value!.revision,
          }
        : {}),
    }
    saved(
      await action.submit(
        '/elders/' + encodeURIComponent(props.elderId) + '/assessment/save',
        body,
        validate,
      ),
    )
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
watch(
  () => props.elderId,
  () => {
    editing.value = false
    selected.value = null
    assessments.value = []
    items.value = []
    void load()
  },
  { immediate: true },
)
watch(active, (value) => {
  if (!value) {
    epoch++
    assessments.value = []
    selected.value = null
    editing.value = false
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
    aria-label="评估与照护需求"
  >
    <header>
      <h3>评估与照护需求</h3>
      <button
        type="button"
        :disabled="locked"
        @click="start()"
      >
        {{ selected ? '更新评估' : '首次评估' }}
      </button>
    </header>
    <p>
      听戏、阅读和活动意愿可直接询问；正式照护需求以有效评估与批准计划为准。
    </p>
    <p v-if="selected">
      {{ assessmentStates[String(selected.status)] || '状态待核实' }} ·
      {{
        selected.total_score === null
          ? '待观察项目未补齐，无正式总分'
          : selected.total_score + ' 分'
      }}
      · {{ workspaceDate(selected.assessed_at) }}
    </p>
    <div
      v-if="
        management &&
          assessments.some((row) =>
            ['draft', 'pending_observation'].includes(String(row.status)),
          )
      "
      class="workspace-actions"
    >
      <button
        v-for="row in assessments.filter((row) =>
          ['draft', 'pending_observation'].includes(String(row.status)),
        )"
        :key="String(row.id)"
        type="button"
        :disabled="locked"
        @click="start(row)"
      >
        核对{{ assessmentStates[String(row.status)] }} ·
        {{ workspaceDate(row.assessed_at) }}
      </button>
    </div>
    <p
      v-if="loading"
      role="status"
    >
      正在定位近期相关观察…
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
    <button
      v-if="pending"
      type="button"
      :disabled="busy"
      @click="retry"
    >
      核实并重试原提交
    </button>
    <form
      v-if="editing"
      @submit.prevent="save('save')"
    >
      <fieldset :disabled="locked">
        <legend>逐项核对本次情况；未观察项目留空</legend>
        <article
          v-for="item in items"
          :key="item.key"
          class="assessment-item"
        >
          <label :for="'assessment-' + elderId + '-' + item.key"><strong>{{ item.label }}</strong></label>
          <p
            v-if="priorScore(item.key) !== undefined"
            class="muted"
          >
            上次：{{ scoreLabel(item.key, priorScore(item.key)) }}（待本次核实）
          </p>
          <p v-if="questions[item.key]">
            {{ questions[item.key] }}
          </p>
          <p
            v-if="conflicts[item.key]"
            class="workspace-warning"
          >
            不同记录存在冲突。请保留待观察，或补充本次现场观察后选择答案；冲突引文不会作为新答案依据。
          </p>
          <details
            v-if="
              prefillEvidence[item.key]?.length &&
                (!answers.sources[item.key]?.length || conflicts[item.key])
            "
          >
            <summary>
              预填定位的记录{{
                conflicts[item.key] ? '（存在冲突）' : '（仅供核对）'
              }}
            </summary>
            <blockquote
              v-for="(source, i) in prefillEvidence[item.key]"
              :key="i"
            >
              {{ source.quote }}
              <footer>{{ source.record_id || source.object_id || source.source_id }}</footer>
            </blockquote>
          </details>
          <select
            :id="'assessment-' + elderId + '-' + item.key"
            :value="answers.scores[item.key] ?? ''"
            @change="changeScore(item.key, $event)"
          >
            <option value="">
              待观察
            </option>
            <option
              v-for="option in item.options"
              :key="option.score"
              :value="option.score"
            >
              {{ option.label }}
            </option>
          </select>
          <p
            v-if="
              previous &&
                answers.scores[item.key] !== null &&
                priorScore(item.key) !== answers.scores[item.key]
            "
            class="workspace-warning"
          >
            与上次不同，请核实变化。
          </p>
          <details v-if="answers.sources[item.key]?.length">
            <summary>查看原文依据</summary>
            <blockquote
              v-for="(source, i) in answers.sources[item.key]"
              :key="i"
            >
              {{ source.quote }}
              <footer>
                {{ source.record_id || source.object_id || source.source_id }} · 原始记录
              </footer>
            </blockquote>
          </details>
          <label>本次现场观察<textarea
            v-model="answers.observations[item.key]"
            rows="2"
            maxlength="2000"
            placeholder="只填写实际观察；系统自动保存观察人和时间"
            @input="answers.checked[item.key] = false"
          />
          </label>
          <label class="workspace-check"><input
            v-model="answers.checked[item.key]"
            type="checkbox"
            :disabled="
              answers.scores[item.key] === null ||
                answers.scores[item.key] === undefined
            "
          >已核对本次答案及依据</label>
        </article>
        <label>下次复评日期<input
          v-model="due"
          type="date"
          required
        ></label><label>本次说明（可选）<textarea
          v-model="note"
          rows="2"
          maxlength="2000"
        />
        </label>
        <p>
          {{
            total === null
              ? '未补齐或未核对，不计为正式总分。'
              : '本次已核对合计：' + total + ' 分。'
          }}
        </p>
        <div class="workspace-actions">
          <button type="submit">
            保存{{ complete ? '草稿' : '待补充' }}
          </button><button
            type="button"
            :disabled="!complete"
            @click="save(management ? 'confirm' : 'submit')"
          >
            {{ management ? '确认保存' : '提交主管确认' }}
          </button><button
            type="button"
            @click="editing = false"
          >
            收起
          </button>
        </div>
      </fieldset>
    </form>
  </section>
</template>
