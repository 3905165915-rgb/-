<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readSession } from '../session'
import {
  generateImpression,
  getImpression,
  impressionCategories,
  impressionKinds,
  listImpressions,
  reviewImpression,
  activateImpressionMemory,
  type ElderImpression,
  type ImpressionList,
  type ImpressionPoint,
} from '../impressions'

const props = defineProps<{ elderId: string; reportId?: string; pointId?: string }>()
const report = ref<ElderImpression | null>(null)
const history = ref<ImpressionList['history']>([])
const latestId = ref('')
const busy = ref(false)
const generating = ref(false)
const error = ref('')
const notice = ref('')
const reviewId = ref('')
const note = ref('')
const memoryPointId = ref('')
const memoryContent = ref('')
const memoryScenes = ref<string[]>([])
const memoryAttribution = ref<'elder' | 'family' | 'staff' | 'unknown'>('unknown')
const memoryCitation = ref(0)
const memoryReason = ref('')
const memoryReviewDate = ref('')
const activated = ref<Record<string, string>>({})
const sceneNames = { bathing: '洗浴', dining: '饮食', activity: '活动', communication: '沟通', rest: '休息', other: '其他生活场景' }
function mayActivate(point: ImpressionPoint) {
  return reviewAllowed.value && point.status === 'confirmed' && point.kind === 'trend' && point.category !== 'attention' && !point.care_memory && !activated.value[point.id]
}
function openMemory(point: ImpressionPoint) {
  memoryPointId.value = point.id
  memoryContent.value = point.text
  memoryScenes.value = []
  memoryAttribution.value = ['elder', 'family', 'staff'].includes(point.expressor) ? point.expressor as 'elder' | 'family' | 'staff' : 'unknown'
  memoryCitation.value = 0
  memoryReason.value = ''
  memoryReviewDate.value = ''
}
async function activate(point: ImpressionPoint) {
  const currentReport = report.value
  if (!currentReport || !mayActivate(point) || !memoryContent.value.trim() || !memoryReason.value.trim() || !memoryScenes.value.length) return
  const citation = point.citations[memoryCitation.value]
  const origin = source(citation.source_id)
  if (!origin) return
  const elder = props.elderId
  await run(async () => {
    const result = await activateImpressionMemory(elder, currentReport.id, point.id, {
      expected_revision: point.revision, content: memoryContent.value.trim(),
      category: point.category === 'communication' ? 'communication' : 'stable_preference',
      scenes: [...memoryScenes.value], attributed_to: memoryAttribution.value,
      source_record_id: origin.source_id, source_revision: origin.revision, source_field: 'observations',
      source_quote: citation.quote, reason: memoryReason.value.trim(),
      ...(memoryReviewDate.value ? { review_due_at: new Date(memoryReviewDate.value + 'T23:59:59+08:00').toISOString() } : {}),
    }, crypto.randomUUID())
    if (props.elderId !== elder) return
    activated.value = { ...activated.value, [point.id]: result.id }
    memoryPointId.value = ''
    notice.value = result.effective
      ? '已由主管确认加入照护记忆。护理员选择对应服务场景时可看到提示；未自动修改计划或派发任务。'
      : '已保存，请到照护记忆中核对有效状态。'
  })
}
let epoch = 0
const session = readSession()
const canReview = session?.role === 'admin' || session?.role === 'supervisor'
const apiMode = session?.mode === 'api'
const expressorLabels = {
  elder: '老人表达',
  family: '家属表达',
  staff: '工作人员记录',
  varied: '多人表达',
  unclear: '表达者不明',
}
const historical = computed(
  () => !!report.value && report.value.id !== latestId.value,
)
const reviewAllowed = computed(
  () =>
    canReview &&
    !historical.value &&
    report.value?.source_current &&
    !report.value.review_due,
)
const source = (id: string) =>
  report.value?.sources.find((s) => s.source_id === id)
const date = (text: string) =>
  new Date(text).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
const time = (text: string) =>
  new Date(text).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })
const groups = computed(() =>
  Object.entries(impressionCategories)
    .map(([key, title]) => ({
      key,
      title,
      points: report.value?.points.filter((p) => p.category === key) || [],
    }))
    .filter((g) => g.points.length),
)

function openReview(point: ImpressionPoint) {
  reviewId.value = point.id
  note.value = ''
}

async function run(action: () => Promise<void>) {
  const current = epoch
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (e) {
    if (current === epoch)
      error.value = e instanceof Error ? e.message : '操作未完成，请刷新核对'
  } finally {
    if (current === epoch) {
      busy.value = false
      generating.value = false
    }
  }
}
async function load() {
  const elder = props.elderId
  const reportId = props.reportId, ticket = epoch
  await run(async () => {
    const result = await listImpressions(elder)
    if (ticket !== epoch) return
    const requested = reportId && result.latest?.id !== reportId ? await getImpression(elder, reportId) : result.latest
    if (ticket !== epoch) return
    if (reportId && requested?.id !== reportId) throw new Error('关联印象版本不匹配，请刷新后核实。')
    report.value = requested
    history.value = result.history
    latestId.value = result.latest?.id || ''
  })
}
async function generate() {
  const elder = props.elderId
  generating.value = true
  await run(async () => {
    const result = await generateImpression(elder)
    if (props.elderId !== elder) return
    report.value = result
    latestId.value = result.id
    reviewId.value = ''
    notice.value =
      '已完成整理。每条内容均需核对，未自动修改照护计划或已确认记忆。'
    const refreshed = await listImpressions(elder)
    if (props.elderId === elder) history.value = refreshed.history
  })
}
async function chooseVersion(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  const elder = props.elderId
  reviewId.value = ''
  await run(async () => {
    const result = await getImpression(elder, id)
    if (props.elderId === elder) report.value = result
  })
}
async function review(
  point: ImpressionPoint,
  decision: 'confirmed' | 'rejected',
) {
  if (!note.value.trim() || !report.value) return
  const elder = props.elderId
  const id = report.value.id
  await run(async () => {
    const result = await reviewImpression(
      elder,
      id,
      point,
      decision,
      note.value.trim(),
    )
    if (props.elderId !== elder) return
    report.value = result
    reviewId.value = ''
    note.value = ''
    memoryPointId.value = ''
    activated.value = {}
    notice.value =
      decision === 'confirmed'
        ? '已登记人工核对；仍以本人当次意愿及正式照护要求为准。'
        : '已标记不采用，保留依据与核对记录。'
  })
}
watch(
  () => [props.elderId, props.reportId],
  () => {
    epoch++
    report.value = null
    history.value = []
    latestId.value = ''
    reviewId.value = ''
    note.value = ''
    generating.value = false
    if (apiMode) void load()
  },
  { immediate: true },
)
</script>

<template>
  <section class="elder-impression" aria-label="老人印象" :aria-busy="busy">
    <header class="impression-header">
      <div>
        <h2>老人印象</h2>
        <p>从日常记录了解习惯与意愿，让每位接班人员更了解这位老人。</p>
      </div>
      <div v-if="apiMode" class="impression-actions">
        <button type="button" :disabled="busy" @click="load">刷新</button>
        <button
          type="button"
          class="primary"
          :disabled="busy"
          @click="generate"
        >
          {{
            generating
              ? '正在阅读历史记录…'
              : report
                ? '重新整理印象'
                : '整理老人印象'
          }}
        </button>
      </div>
    </header>
    <p v-if="!apiMode" class="impression-tip">
      请使用服务器账号查看与整理真实保存的记录。
    </p>
    <p v-if="busy" role="status">
      {{
        generating
          ? '正在分批阅读历史并汇总，可能需要一至三分钟，请勿重复提交。'
          : '正在加载…'
      }}
    </p>
    <p v-if="error" role="alert" class="impression-error">
      {{ error }}。若请求超时，可先刷新查看是否已完成。
    </p>
    <p v-if="notice" role="status" class="impression-tip">{{ notice }}</p>
    <p v-if="apiMode && !busy && !report && !error">
      还没有老人印象。已有记录可直接整理，记录较少时会标记为待继续观察。
    </p>
    <template v-if="report">
      <div class="impression-meta">
        <p>
          参考 {{ report.coverage.record_count }} 条已确认记录 ·
          {{ date(report.coverage.from) }}—{{ date(report.coverage.to) }}
        </p>
        <p v-if="report.coverage.simulated_count" class="impression-demo">
          包含
          {{ report.coverage.simulated_count }}
          条虚构演示记录，不代表真实服务或验证结果。
        </p>
        <p v-if="report.model_status === 'demo'" class="impression-demo">
          当前为演示模式，未执行真实模型分析。
        </p>
        <p>
          整理于 {{ time(report.created_at) }} · 建议
          {{ date(report.review_due_at) }} 前复核
        </p>
        <label v-if="history.length > 1"
          >查看整理版本
          <select :value="report.id" :disabled="busy" @change="chooseVersion">
            <option
              v-for="version in history"
              :key="version.id"
              :value="version.id"
            >
              {{ time(version.created_at) }} ·
              {{ version.record_count }} 条记录{{
                version.id === latestId ? '（最新）' : '（历史）'
              }}
            </option>
          </select>
        </label>
      </div>
      <p class="impression-tip">
        这是记录中的生活照护线索。本人当次意愿优先。主管先核对，再明确适用场景并“加入照护记忆”，才会进入护理员的服务提示；不会自动派发任务。
      </p>
      <p v-if="historical" class="impression-warning">
        正在查看历史版本，不能作为当前已确认要求。
      </p>
      <p v-if="!report.source_current" class="impression-warning" role="status">
        有新增或更正记录（新增
        {{ report.new_record_count }} 条），本版需重新整理，暂不能确认。
      </p>
      <p v-if="report.review_due" class="impression-warning">
        已到建议复核时间，请重新整理并与本人核对，不代表所有既有偏好自动失效。
      </p>
      <p v-if="!report.points.length">
        当前资料未形成可展示的个性化线索，可继续记录后重新整理。
      </p>
      <div class="impression-groups">
        <section
          v-for="group in groups"
          :key="group.key"
          class="impression-group"
        >
          <h3>{{ group.title }}</h3>
          <article
            v-for="point in group.points"
            :key="point.id"
            class="impression-point"
            :class="{ rejected: point.status === 'rejected', 'linked-point': point.id === pointId }"
          >
            <p v-if="point.id === pointId" role="status">当前关联的印象事项</p>
            <div class="impression-tags">
              <span
                :class="{ 'impression-warning': point.kind === 'conflict' }"
                >{{ impressionKinds[point.kind] }}</span
              >
              <span>{{ expressorLabels[point.expressor] }}</span>
              <span>{{
                point.status === 'confirmed'
                  ? '已人工核对'
                  : point.status === 'rejected'
                    ? '不采用'
                    : '待人工核对'
              }}</span>
            </div>
            <p class="impression-text">{{ point.text }}</p>
            <p v-if="point.kind === 'temporary'" class="impression-warning">
              仅代表对应记录时段的意愿，不能沿用为长期偏好。
            </p>
            <p class="impression-count">
              引用 {{ point.supporting_records }} 条、{{
                point.supporting_days
              }}
              个日期的记录；引用数量不等于发生频率。
            </p>
            <details>
              <summary>查看原文依据（{{ point.citations.length }}）</summary>
              <blockquote
                v-for="(citation, index) in point.citations"
                :key="index"
              >
                <p>{{ citation.quote }}</p>
                <small v-if="source(citation.source_id)"
                  >记录所述发生时间：{{
                    time(source(citation.source_id)!.happened_at)
                  }}<br />实际录入：{{
                    time(source(citation.source_id)!.recorded_at)
                  }}{{
                    source(citation.source_id)!.simulated ? ' · 模拟记录' : ''
                  }}</small
                >
              </blockquote>
            </details>
            <p v-if="point.reviewed_at" class="impression-count">
              {{ point.reviewed_by_name || '主管' }} ·
              {{ time(point.reviewed_at) }}<br />{{ point.review_note }}
            </p>
            <button
              v-if="reviewAllowed && reviewId !== point.id"
              type="button"
              :disabled="busy"
              @click="openReview(point)"
            >
              {{ point.status === 'candidate' ? '核对这条印象' : '重新核对' }}
            </button>
            <form
              v-if="reviewAllowed && reviewId === point.id"
              class="impression-review"
              @submit.prevent="review(point, 'confirmed')"
            >
              <label :for="'impression-note-' + point.id"
                >核对说明（例如已与本人核实、仅适用的时段）</label
              >
              <textarea
                :id="'impression-note-' + point.id"
                v-model="note"
                required
                maxlength="1000"
                :disabled="busy"
                rows="3"
              />
              <div class="impression-actions">
                <button type="submit" :disabled="busy || !note.trim()">
                  确认已核对
                </button>
                <button
                  type="button"
                  :disabled="busy || !note.trim()"
                  @click="review(point, 'rejected')"
                >
                  不采用
                </button>
                <button type="button" :disabled="busy" @click="reviewId = ''">
                  取消
                </button>
              </div>
            </form>
            <p v-if="activated[point.id] || point.care_memory" class="impression-tip">已加入照护记忆。{{ point.care_memory && !point.care_memory.effective ? '当前不作为有效提示，请到照护记忆中核对状态和来源。' : '可在对应场景查看。' }}</p>
            <button v-else-if="mayActivate(point) && memoryPointId !== point.id" type="button" :disabled="busy" @click="openMemory(point)">加入照护记忆</button>
            <form v-if="mayActivate(point) && memoryPointId === point.id" class="impression-review" @submit.prevent="activate(point)">
              <p>这将保存主管确认的生活照护提示。请核实当前仍适用，并保留老人当次选择权。</p>
              <label>实际照护提示<textarea v-model="memoryContent" rows="3" maxlength="1000" required :disabled="busy" /></label>
              <fieldset :disabled="busy"><legend>在哪些服务中提示 *</legend>
                <label v-for="(title, scene) in sceneNames" :key="scene" class="impression-scene"><input v-model="memoryScenes" type="checkbox" :value="scene" />{{ title }}</label>
              </fieldset>
              <label>已核实的信息表达者<select v-model="memoryAttribution" :disabled="busy"><option value="elder">老人本人</option><option value="family">家属</option><option value="staff">工作人员观察</option><option value="unknown">表达者未明确</option></select></label>
              <label>选用的原文依据<select v-model.number="memoryCitation" :disabled="busy"><option v-for="(citation, i) in point.citations" :key="i" :value="i">{{ date(source(citation.source_id)!.happened_at) }} · {{ citation.quote }}</option></select></label>
              <p>记录版本已自动关联；所有引用依据仍保留，来源更正后会提示复核。</p>
              <label>建议复核日期（可选）<input v-model="memoryReviewDate" type="date" :min="new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })" :disabled="busy" /></label>
              <label>确认依据及适用限制<textarea v-model="memoryReason" maxlength="1000" rows="2" required placeholder="例如：已与本人核实；活动前仍需询问当次意愿" :disabled="busy" /></label>
              <div class="impression-actions"><button type="submit" :disabled="busy || !memoryScenes.length || !memoryReason.trim() || !memoryContent.trim()">确认加入并用于场景提示</button><button type="button" :disabled="busy" @click="memoryPointId = ''">取消</button></div>
            </form>
          </article>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.elder-impression {
  margin: 22px 0;
  padding: clamp(14px, 2vw, 24px);
  border: 1px solid var(--hl-border, #dbe5e0);
  border-radius: 18px;
  background: linear-gradient(130deg, #ffffffb8, #eef9f3a6);
  backdrop-filter: blur(18px);
  color: var(--hl-ink, #233b32);
}
.impression-header,
.impression-actions,
.impression-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.impression-header {
  justify-content: space-between;
  align-items: flex-start;
}
h2 {
  font-size: 21px;
  margin: 0;
}
h3 {
  margin: 0 0 12px;
  font-size: 17px;
}
p {
  margin: 8px 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.impression-header p,
.impression-meta,
.impression-count,
small {
  color: var(--hl-muted, #53685e);
  font-size: 13px;
}
.impression-meta {
  margin: 16px 0;
}
.impression-meta label {
  display: grid;
  gap: 6px;
  max-width: 100%;
}
button,
select,
textarea {
  font: inherit;
  border: 1px solid var(--hl-border, #c7d9cf);
  border-radius: 9px;
  background: #ffffffb5;
  color: inherit;
  max-width: 100%;
}
button {
  min-height: 44px;
  padding: 8px 14px;
  cursor: pointer;
}
button.primary {
  color: #fff;
  background: #23644f;
  border-color: #23644f;
}
button:disabled {
  opacity: 0.55;
  cursor: wait;
}
select {
  min-height: 44px;
  padding: 8px;
}
textarea {
  width: 100%;
  padding: 10px;
  box-sizing: border-box;
  resize: vertical;
}
button:focus-visible,
summary:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 3px solid #388765;
  outline-offset: 3px;
}
.impression-tip {
  padding: 10px 12px;
  background: #e5f3ecb0;
  border-radius: 10px;
  font-size: 13px;
}
.impression-error {
  color: #a02f27;
}
.impression-warning,
.impression-demo {
  color: #80520b;
}
.impression-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  align-items: start;
  gap: 16px;
  margin-top: 20px;
}
.impression-group {
  min-width: 0;
}
.impression-point {
  background: #ffffffe0;
  padding: 15px;
  border: 1px solid #dce8e2;
  border-radius: 14px;
  margin-bottom: 12px;
}
.impression-point.rejected {
  background: #f4f5f3;
}
.impression-text {
  font-size: 15px;
}
.impression-tags span {
  font-size: 12px;
  padding: 3px 8px;
  background: #eff5f0;
  border-radius: 7px;
}
details {
  margin: 12px 0;
}
summary {
  cursor: pointer;
  min-height: 32px;
  color: #23644f;
}
blockquote {
  margin: 10px 0;
  padding: 0 0 0 12px;
  border-left: 3px solid #9fc5ad;
}
.impression-review {
  display: grid;
  gap: 9px;
  margin-top: 12px;
}
.linked-point { outline: 2px solid var(--hl-primary, #1767cf); outline-offset: 2px; }
.impression-review label { display: grid; gap: 6px; min-width: 0; }
.impression-review fieldset { min-width: 0; border: 1px solid #c7d9cf; border-radius: 9px; }
.impression-review .impression-scene { display: inline-flex; align-items: center; gap: 5px; margin: 5px 10px 5px 0; }
.impression-review input[type='checkbox'] { min-width: 18px; min-height: 18px; }
.impression-review input[type='date'] { min-height: 44px; max-width: 100%; font: inherit; }
@media (max-width: 600px) {
  .impression-header {
    display: block;
  }
  .impression-actions {
    margin-top: 12px;
  }
  .elder-impression {
    border-radius: 14px;
  }
}
</style>
