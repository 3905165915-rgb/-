<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Flower2, Heart, Leaf, MessageCircle, RefreshCw, Send, Sparkles, Sun, X } from 'lucide-vue-next'
import { readSession } from '@hulao/shared'
import { request, requestBlob } from '../../../../../packages/shared/src/workflow/model'
import { sameCareSession } from '../../../../../packages/shared/src/workflow/task-care-context'
import { dailySaying, familyDate, familyDay, familyFeed, familyInsight, familyMembers, familyMessages, type FamilyFeed, type FamilyInsight, type FamilyMember, type FamilyMessage, type FamilyPhoto } from '../../../../../packages/shared/src/workflow/family-life'
import { demoFamilyFeed, demoFamilyInsight, demoFamilyMembers, demoFamilyMessages, demoFamilySend } from '../../../../../packages/shared/src/workflow/family-life-demo'
import demoPhoto from '../../assets/care-field.jpg'

const session = ref(readSession()), demo = computed(() => session.value?.mode === 'demo')
const members = ref<FamilyMember[]>([]), selected = ref<FamilyMember | null>(null), choice = ref('')
const demoAllElders = computed(() => members.value.some(member => member.demo_access === true))
const feed = ref<FamilyFeed | null>(null), insight = ref<FamilyInsight | null>(null), messages = ref<FamilyMessage[]>([])
const loading = ref(false), choosing = ref(true), insightBusy = ref(false), sending = ref(false)
const error = ref(''), insightError = ref(''), messageError = ref(''), messageNotice = ref(''), text = ref('')
const lightbox = ref<{ url: string; caption: string } | null>(null)
const photoUrls = ref<Record<string, string>>({}), photoErrors = ref<Record<string, boolean>>({})
const today = ref(new Date()), highlighted = ref('')
let epoch = 0, messageEpoch = 0, insightEpoch = 0, mounted = true
let highlightTimer: ReturnType<typeof setTimeout> | undefined
const journal = new Map<string, { text: string; key?: string }>()
const insightCache = new Map<string, { value: FamilyInsight; until: number }>()
const draftVersion = ref(0)
const sayings = computed(() => dailySaying(today.value))
const dateLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(today.value))
const groups = computed(() => {
  const result: { day: string; label: string; items: FamilyFeed['items'] }[] = []
  for (const item of feed.value?.items || []) {
    const day = familyDay(new Date(item.happened_at))
    let group = result.find(row => row.day === day)
    if (!group) { group = { day, label: day === familyDay(today.value) ? '今天' : familyDate(item.happened_at), items: [] }; result.push(group) }
    group.items.push(item)
  }
  return result
})
const canMessage = computed(() => selected.value?.scopes.includes('feedback'))
const pendingAttempt = computed(() => { void draftVersion.value; return !!(selected.value && journal.get(selected.value.id)?.key) })
function valid(ticket: number, member?: FamilyMember) {
  return mounted && ticket === epoch && sameCareSession(readSession(), session.value) && (!member || selected.value?.id === member.id)
}
function friendly(failure: unknown) {
  const status = (failure as { status?: number })?.status
  if (status === 401) return '登录状态已变化，请重新进入家属端。'
  if (status === 403) return '这位家人的动态暂时无法查看，请联系工作人员核对。'
  if (status === 409) return '近况刚刚更新，请刷新后再看看。'
  return failure instanceof Error && /[\u3400-\u9fff]/.test(failure.message) ? failure.message : '暂时没有连接上，请稍后再试。'
}
function releasePhotos() {
  for (const url of Object.values(photoUrls.value)) if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  photoUrls.value = {}; photoErrors.value = {}; lightbox.value = null
}
function clearContent() {
  feed.value = null; insight.value = null; messages.value = []; insightError.value = ''; messageError.value = ''; messageNotice.value = ''
  highlighted.value = ''; releasePhotos(); insightEpoch++; messageEpoch++; insightBusy.value = false; sending.value = false
}
function draftKey() { return 'hulao:family-message:v1:' + JSON.stringify([session.value?.mode, session.value?.accountKey, session.value?.userId]) }
function persistJournal() {
  draftVersion.value++
  try { sessionStorage.setItem(draftKey(), JSON.stringify(Object.fromEntries(journal))); return true }
  catch { messageError.value = '本机暂时无法保存留言请求，请先复制内容，恢复存储后再发送。'; return false }
}
function saveDraft() {
  if (!selected.value) return
  const old = journal.get(selected.value.id)
  journal.set(selected.value.id, { text: text.value, ...(old?.key ? { key: old.key } : {}) }); return persistJournal()
}
function restoreDrafts() {
  journal.clear(); draftVersion.value++
  try {
    const raw = sessionStorage.getItem(draftKey()); if (!raw) return
    const rows = JSON.parse(raw) as Record<string, { text?: unknown; key?: unknown }>
    for (const [id, value] of Object.entries(rows)) if (value && typeof value.text === 'string' && (!value.key || typeof value.key === 'string')) journal.set(id, { text: value.text, ...(value.key ? { key: value.key as string } : {}) })
  } catch { messageError.value = '上次留言草稿无法恢复，请核对已发送留言后再操作。' }
}
function revoke(failure: unknown) {
  const status = (failure as { status?: number })?.status
  if (![401, 403].includes(status || 0)) return false
  epoch++; clearContent(); selected.value = null; choice.value = ''; choosing.value = true; members.value = []; text.value = ''; loading.value = false
  error.value = friendly(failure); return true
}
async function initialize() {
  insightCache.clear()
  saveDraft(); epoch++; clearContent(); selected.value = null; members.value = []; text.value = ''; choosing.value = true; choice.value = ''; error.value = ''
  session.value = readSession(); restoreDrafts()
  const ticket = epoch
  if (session.value?.role !== 'family') { error.value = '请从家属入口进入。'; return }
  loading.value = true
  try {
    const rows = familyMembers(demo.value ? await demoFamilyMembers() : await request('/family/me/bindings'))
    if (!valid(ticket)) return
    members.value = rows.filter(row => row.scopes.includes('summary') && Date.parse(row.expires_at) > Date.now())
    choice.value = members.value[0]?.id || ''
  } catch (failure) { if (valid(ticket)) error.value = friendly(failure) }
  finally { if (ticket === epoch) loading.value = false }
}
function switchFamily() {
  saveDraft(); epoch++; clearContent(); choosing.value = true; text.value = ''; error.value = ''; loading.value = false
  choice.value = selected.value?.id || members.value[0]?.id || ''; selected.value = null
}
async function confirmFamily() {
  const member = members.value.find(row => row.id === choice.value)
  if (!member || loading.value) return
  selected.value = member; choosing.value = false; text.value = journal.get(member.id)?.text || ''; draftVersion.value++
  await refresh()
}
async function loadMessages(ticket: number, member: FamilyMember) {
  if (!member.scopes.includes('feedback')) return
  const run = messageEpoch
  try {
    const rows = familyMessages(demo.value ? demoFamilyMessages(member) : await request(`/family/me/bindings/${encodeURIComponent(member.id)}/feedback?limit=100`), member)
    if (valid(ticket, member) && run === messageEpoch) messages.value = rows
  } catch (failure) { if (valid(ticket, member) && !revoke(failure)) messageError.value = friendly(failure) }
}
async function loadPhotos(ticket: number, member: FamilyMember, value: FamilyFeed) {
  const rows = [...new Map(value.items.flatMap(item => item.photos).map(photo => [photo.id, photo])).values()]
  async function worker() {
    while (rows.length && valid(ticket, member)) {
      const photo = rows.shift()!
      try {
        const url = demo.value ? demoPhoto : URL.createObjectURL(await requestBlob(photo.content_path))
        if (!valid(ticket, member)) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return }
        photoUrls.value = { ...photoUrls.value, [photo.id]: url }
      } catch (failure) {
        if (!valid(ticket, member)) return
        if (revoke(failure)) return
        photoErrors.value = { ...photoErrors.value, [photo.id]: true }
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
}
async function summarize(ticket = epoch, member = selected.value) {
  if (!member || !feed.value?.items.length || insightBusy.value) return
  const run = ++insightEpoch, snapshot = feed.value
  const fingerprint = JSON.stringify([member.id, snapshot.items.slice(0, 30).map(item => [item.id, item.text])])
  const cached = insightCache.get(fingerprint)
  if (cached && cached.until > Date.now()) { insight.value = cached.value; return }
  insightBusy.value = true; insightError.value = ''
  try {
    const value = familyInsight(demo.value ? demoFamilyInsight(snapshot) : await request(`/family/me/bindings/${encodeURIComponent(member.id)}/insights`, 'post'), snapshot)
    if (valid(ticket, member) && run === insightEpoch) {
      insight.value = value
      if (insightCache.size >= 6) insightCache.delete(insightCache.keys().next().value!)
      insightCache.set(fingerprint, { value, until: Date.now() + 120000 })
    }
  } catch (failure) {
    if (valid(ticket, member) && run === insightEpoch && !revoke(failure)) insightError.value = friendly(failure)
  } finally { if (valid(ticket, member) && run === insightEpoch) insightBusy.value = false }
}
async function refresh() {
  if (!selected.value || loading.value || sending.value) return
  const member = selected.value, ticket = ++epoch
  clearContent(); loading.value = true; error.value = ''; today.value = new Date()
  try {
    const value = familyFeed(demo.value ? demoFamilyFeed(member) : await request(`/family/me/bindings/${encodeURIComponent(member.id)}/timeline?limit=200`), member)
    if (!valid(ticket, member)) return
    feed.value = value
    void loadMessages(ticket, member); void loadPhotos(ticket, member, value); void summarize(ticket, member)
  } catch (failure) { if (valid(ticket, member) && !revoke(failure)) error.value = friendly(failure) }
  finally { if (ticket === epoch) loading.value = false }
}
async function sendMessage() {
  const member = selected.value
  if (!member || sending.value || !canMessage.value || !text.value.trim() || !valid(epoch, member)) return
  const ticket = epoch, run = ++messageEpoch
  sending.value = true; messageError.value = ''; messageNotice.value = ''
  const old = journal.get(member.id), attempt = old?.key ? old : { text: text.value.trim(), key: crypto.randomUUID() }
  journal.set(member.id, attempt); text.value = attempt.text
  if (!saveDraft()) { sending.value = false; return }
  try {
    const value = demo.value ? demoFamilySend(member, attempt.text, attempt.key!) : await request('/family/me/feedback', 'post', { binding_id: member.id, text: attempt.text }, attempt.key)
    const row = familyMessages([value], member)[0]!
    if (!valid(ticket, member) || run !== messageEpoch) return
    messages.value = [row, ...messages.value.filter(item => item.id !== row.id)]; text.value = ''; journal.delete(member.id); persistJournal()
    messageNotice.value = demo.value ? '演示留言已记录，仅保留在本次浏览中。' : '心意已经送达，工作人员回复后会显示在这里。'
  } catch (failure) {
    if (!valid(ticket, member) || run !== messageEpoch || revoke(failure)) return
    if ([400, 422].includes((failure as { status?: number })?.status || 0)) {
      journal.set(member.id, { text: attempt.text }); persistJournal(); messageError.value = friendly(failure)
    } else messageError.value = '发送结果还未确认，请点击“核对并重试”，系统会使用原请求核对。'
  } finally { if (valid(ticket, member) && run === messageEpoch) sending.value = false }
}
async function showSource(id: string) {
  highlighted.value = id; await nextTick()
  const target = document.getElementById(`family-moment-${id}`)
  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); target?.focus({ preventScroll: true })
  clearTimeout(highlightTimer); highlightTimer = setTimeout(() => { highlighted.value = '' }, 3500)
}
function openPhoto(photo: FamilyPhoto) { const url = photoUrls.value[photo.id]; if (url) lightbox.value = { url, caption: photo.caption || '家人的生活瞬间' } }
function onFocus() {
  today.value = new Date()
  if (!sameCareSession(readSession(), session.value)) { void initialize(); return }
  if (selected.value && !sending.value) void refresh()
}
function unauthorized() { epoch++; insightCache.clear(); clearContent(); selected.value = null; members.value = []; choosing.value = true; text.value = '' }
function onVisibility() { if (document.visibilityState === 'visible') onFocus() }
function onKey(event: KeyboardEvent) { if (event.key === 'Escape') lightbox.value = null }
onMounted(() => {
  void initialize()
  window.addEventListener('focus', onFocus); window.addEventListener('storage', onFocus); window.addEventListener('hulao:unauthorized', unauthorized); window.addEventListener('keydown', onKey); document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  saveDraft(); mounted = false; epoch++; clearTimeout(highlightTimer); releasePhotos()
  window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onFocus); window.removeEventListener('hulao:unauthorized', unauthorized); window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <section
    class="family-living"
    aria-label="家人的生活相册"
  >
    <header class="family-welcome">
      <div class="family-date">
        <Sun
          :size="16"
          aria-hidden="true"
        />{{ dateLabel }}
      </div>
      <h1>{{ selected && !choosing ? `${selected.elder_name}的日常` : '惦记的人，近在眼前。' }}</h1>
      <p>{{ selected && !choosing ? '把日常的小事，慢慢说给你听。' : '来看看家人的小日子，把牵挂放在这里。' }}</p>
      <span
        class="welcome-orbit orbit-one"
        aria-hidden="true"
      /><span
        class="welcome-orbit orbit-two"
        aria-hidden="true"
      />
    </header>
    <aside class="family-saying">
      <span class="saying-icon"><Flower2
        :size="22"
        aria-hidden="true"
      /></span><div><span>今日暖心话</span><p>{{ sayings }}</p></div>
    </aside>
    <p
      v-if="demo"
      class="demo-note"
    >
      这里的家人、故事和留言均为虚构演示，配图不是本人照片。
    </p>
    <p
      v-if="demoAllElders"
      class="demo-note"
    >
      演示账号可选择、切换全部老人，查看各自已发布的生活动态和近况小结。
    </p>
    <div
      v-if="error"
      class="family-notice"
      role="alert"
    >
      <p>{{ error }}</p><button
        type="button"
        @click="selected ? refresh() : initialize()"
      >
        再试一次
      </button>
    </div>
    <section
      v-if="choosing"
      class="family-selection glass-card"
      aria-labelledby="family-choice-title"
    >
      <span class="section-eyebrow">相伴，从一声问候开始</span><h2 id="family-choice-title">
        今天想看看谁？
      </h2><p class="soft-copy">
        选好家人，就能翻看他们的生活近况。
      </p>
      <p
        v-if="loading"
        role="status"
        class="soft-copy"
      >
        正在打开家人的相册…
      </p>
      <div
        class="family-member-list"
        role="radiogroup"
        aria-label="选择家人"
      >
        <label
          v-for="(member, index) in members"
          :key="member.id"
          class="family-member"
          :class="{ 'is-selected': choice === member.id }"
        >
          <input
            v-model="choice"
            type="radio"
            name="family-member"
            :value="member.id"
          ><span
            class="family-avatar"
            :class="{ amber: index % 2 }"
          >{{ member.elder_name.slice(0, 1) }}<Leaf
            :size="15"
            aria-hidden="true"
          /></span><span class="family-member-copy"><strong>{{ member.elder_name }}</strong><small>生活动态 · 近况小结 · 捎句话</small></span><span class="member-check"><Check
            v-if="choice === member.id"
            :size="16"
            aria-hidden="true"
          /></span>
        </label>
      </div>
      <p
        v-if="!loading && !members.length && !error"
        class="family-empty"
      >
        还没有可以打开的家人相册。请联系工作人员为测试账号准备家人资料。
      </p>
      <button
        class="family-primary"
        type="button"
        :disabled="!choice || loading"
        @click="confirmFamily"
      >
        看看家人的近况<ArrowRight
          :size="18"
          aria-hidden="true"
        />
      </button>
    </section>
    <template v-else-if="selected">
      <div class="family-person-bar">
        <div><span class="tiny-avatar">{{ selected.elder_name.slice(0, 1) }}</span><strong>{{ selected.elder_name }}的生活相册</strong></div><button
          type="button"
          class="family-text-button"
          @click="switchFamily"
        >
          <ArrowLeft
            :size="14"
            aria-hidden="true"
          />切换家人
        </button>
      </div>
      <section
        class="family-digest glass-card"
        aria-labelledby="family-digest-title"
        aria-live="polite"
      >
        <header>
          <span class="digest-icon"><Sparkles
            :size="20"
            aria-hidden="true"
          /></span><div>
            <h2 id="family-digest-title">
              最近，想和你分享
            </h2><p>从已经发布的近况里，为你捋一捋。</p>
          </div>
        </header>
        <div
          v-if="loading || insightBusy"
          class="digest-loading"
          role="status"
        >
          <span class="breathing-dot" />正在整理小日子，下面的动态可以先看。
        </div>
        <div
          v-else-if="insightError"
          class="digest-fallback"
        >
          <p>近况小结暂时没整理好，生活动态仍可正常阅读。</p><button
            type="button"
            class="family-text-button"
            @click="summarize()"
          >
            重新整理
          </button>
        </div>
        <ul
          v-else-if="insight?.points.length"
          class="digest-points"
        >
          <li
            v-for="(point, index) in insight.points"
            :key="index"
          >
            <span class="digest-leaf"><Leaf
              :size="14"
              aria-hidden="true"
            /></span><div>
              <p>{{ point.text }}</p><details>
                <summary>
                  看看这段话的依据<ChevronDown
                    :size="13"
                    aria-hidden="true"
                  />
                </summary><button
                  v-for="(citation, citationIndex) in point.citations"
                  :key="citationIndex"
                  type="button"
                  class="source-link"
                  @click="showSource(citation.source_id)"
                >
                  “{{ citation.quote }}”<ArrowRight
                    :size="14"
                    aria-hidden="true"
                  />
                </button>
              </details>
            </div>
          </li>
        </ul>
        <p
          v-else
          class="soft-copy"
        >
          {{ feed?.items.length ? '这次没有整理出明确的小结，可以先看下面的生活动态。' : '等工作人员分享新的生活动态，这里就会有一份近况小结。' }}
        </p>
        <p class="digest-footnote">
          {{ insight?.model_status === 'demo' ? '演示小结 · ' : '辅助整理 · ' }}内容以工作人员已发布的近况为依据，不作医疗判断。
        </p>
      </section>
      <section
        class="family-stories"
        aria-labelledby="family-stories-title"
      >
        <header class="stories-heading">
          <div>
            <span class="section-eyebrow">把平常的日子，记成小故事</span><h2 id="family-stories-title">
              生活的点滴
            </h2>
          </div><button
            type="button"
            class="refresh-stories"
            :disabled="loading || sending"
            aria-label="刷新生活动态"
            @click="refresh"
          >
            <RefreshCw
              :size="17"
              :class="{ spinning: loading }"
              aria-hidden="true"
            />
          </button>
        </header>
        <p
          v-if="loading"
          class="family-empty"
          role="status"
        >
          正在翻开相册…
        </p>
        <div
          v-else-if="!feed?.items.length && !error"
          class="family-empty glass-card"
        >
          <Leaf
            :size="28"
            aria-hidden="true"
          /><h3>相册还在慢慢写</h3><p>新的生活近况发布后，会出现在这里。</p>
        </div>
        <ol
          v-else
          class="life-tree"
        >
          <li
            v-for="group in groups"
            :key="group.day"
            class="tree-day"
          >
            <span class="tree-day-label"><span class="tree-bud" />{{ group.label }}</span><ol>
              <li
                v-for="item in group.items"
                :key="item.id"
                class="tree-branch"
              >
                <span
                  class="branch-leaf"
                  aria-hidden="true"
                ><Leaf :size="13" /></span><article
                  :id="`family-moment-${item.id}`"
                  class="story-card glass-card"
                  :class="{ highlighted: highlighted === item.id }"
                  tabindex="-1"
                >
                  <header><span class="story-kicker"><span />本时段近况</span><time :datetime="item.published_at">{{ familyDate(item.published_at, true) }}发布</time></header><h3>{{ item.title }}</h3><p class="story-text">
                    {{ item.text }}
                  </p>
                  <div
                    v-if="item.photos.length"
                    class="story-photos"
                    :class="{ multiple: item.photos.length > 1 }"
                  >
                    <figure
                      v-for="photo in item.photos"
                      :key="photo.id"
                    >
                      <button
                        v-if="photoUrls[photo.id]"
                        type="button"
                        class="story-photo"
                        :aria-label="`放大照片：${photo.caption || '生活瞬间'}`"
                        @click="openPhoto(photo)"
                      >
                        <img
                          :src="photoUrls[photo.id]"
                          :alt="photo.caption || '家人的生活瞬间'"
                          loading="lazy"
                        ><span>轻点看看</span>
                      </button><div
                        v-else
                        class="photo-placeholder"
                      >
                        {{ photoErrors[photo.id] ? '照片暂时没加载出来，请刷新试试' : '生活照片正在加载…' }}
                      </div><figcaption v-if="photo.caption">
                        {{ photo.caption }}
                      </figcaption>
                    </figure>
                  </div>
                  <footer>近况覆盖 {{ familyDate(item.period_start, true) }} — {{ familyDate(item.period_end, true) }}</footer>
                </article>
              </li>
            </ol>
          </li>
        </ol>
        <p
          v-if="feed && feed.total > feed.items.length"
          class="feed-range-note"
        >
          当前展示最近 {{ feed.items.length }}条，共 {{ feed.total }}条近况。
        </p>
        <div
          v-if="feed?.items.length"
          class="tree-ending"
        >
          <Heart
            :size="15"
            aria-hidden="true"
          /><span>有人惦念的日子，总是温柔的。</span>
        </div>
      </section>
      <section
        v-if="canMessage"
        class="family-letter glass-card"
        aria-labelledby="family-letter-title"
      >
        <header>
          <span class="letter-icon"><MessageCircle
            :size="21"
            aria-hidden="true"
          /></span><div>
            <h2 id="family-letter-title">
              给照护团队捎句话
            </h2><p>家人的小习惯，或你想问的事，都可以慢慢说。</p>
          </div>
        </header>
        <form @submit.prevent="sendMessage">
          <label
            class="sr-only"
            for="family-letter-text"
          >给照护团队的留言</label><textarea
            id="family-letter-text"
            v-model="text"
            :disabled="sending || pendingAttempt"
            maxlength="3000"
            rows="3"
            placeholder="例如：妈妈最近喜欢听哪出戏？下次探望想带些她喜欢的小东西。"
            @input="saveDraft"
          /><div class="letter-actions">
            <span>{{ pendingAttempt ? '上次发送结果待核对' : '这里不是紧急联系通道' }}</span><button
              class="family-primary"
              type="submit"
              :disabled="!text.trim() || sending"
            >
              <Send
                :size="15"
                aria-hidden="true"
              />{{ sending ? '正在送达…' : pendingAttempt ? '核对并重试' : '把心意送达' }}
            </button>
          </div>
        </form>
        <p
          v-if="messageError"
          class="family-error"
          role="alert"
        >
          {{ messageError }}
        </p><p
          v-if="messageNotice"
          class="family-success"
          role="status"
        >
          {{ messageNotice }}
        </p>
        <details
          v-if="messages.length"
          class="letter-history"
        >
          <summary>
            往来的话<span>{{ messages.length }}</span><ChevronDown
              :size="15"
              aria-hidden="true"
            />
          </summary><article
            v-for="message in messages"
            :key="message.id"
            class="letter-item"
          >
            <div><span>我捎的话</span><time :datetime="message.created_at">{{ familyDate(message.created_at, true) }}</time></div><p>{{ message.text }}</p><div
              v-if="message.reply"
              class="letter-reply"
            >
              <strong>照护团队回复</strong><p>{{ message.reply }}</p><small v-if="message.replied_at">{{ familyDate(message.replied_at, true) }}</small>
            </div><span
              v-else
              class="reply-pending"
            >{{ message.status === 'closed' ? '已处理' : '等待照护团队回应' }}</span>
          </article>
        </details>
      </section>
      <footer class="family-signoff">
        <Flower2
          :size="22"
          aria-hidden="true"
        /><p>让关心有回应，让陪伴有温度。</p><span>护老智交 · 家人相伴</span>
      </footer>
    </template>
    <van-popup
      :show="!!lightbox"
      position="center"
      class="family-photo-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="生活照片"
      close-on-popstate
      @update:show="!$event && (lightbox = null)"
    >
      <div
        v-if="lightbox"
        class="photo-lightbox"
      >
        <button
          type="button"
          aria-label="关闭照片"
          @click="lightbox = null"
        >
          <X
            :size="22"
            aria-hidden="true"
          />
        </button><img
          :src="lightbox.url"
          :alt="lightbox.caption"
        ><p>{{ lightbox.caption }}</p>
      </div>
    </van-popup>
  </section>
</template>

<style scoped>
.family-living { --family-ink:#263f3a; --family-muted:#687c73; --family-green:#316d5d; --family-border:rgba(116,150,129,.19); max-width:720px; min-width:0; margin:0 auto; color:var(--family-ink); padding:4px 0 24px; overflow-wrap:anywhere; }
.family-living h1,.family-living h2,.family-living h3,.family-living p { margin:0; }
.family-living button,.family-member { -webkit-tap-highlight-color:transparent; }
.family-living button { font:inherit; cursor:pointer; }.family-living button:disabled { opacity:.55; cursor:default; }
.family-living button:focus-visible,.family-member:focus-within,.story-card:focus-visible { outline:3px solid #3e8c75; outline-offset:4px; }
.family-welcome { position:relative; isolation:isolate; padding:30px 22px 27px; overflow:hidden; border-radius:26px; background:linear-gradient(125deg,#e9f3def2,#eff5e5e0 45%,#f8edd8e6); border:1px solid #ffffffb3; box-shadow:0 10px 30px #58745e0b; }
.family-date { display:flex; align-items:center; gap:7px; font-size:12px; color:#657b58; letter-spacing:.04em; }
.family-welcome h1 { position:relative; z-index:1; font-size:clamp(23px,4vw,30px); font-weight:650; letter-spacing:.025em; margin:18px 0 10px; line-height:1.45; }
.family-welcome>p { position:relative; z-index:1; font-size:13px; color:#627260; line-height:1.8; }
.welcome-orbit { position:absolute; z-index:-1; width:170px; height:170px; right:-55px; top:-57px; border-radius:50%; border:26px solid #ffffff60; }
.orbit-two { width:104px; height:160px; top:74px; right:-12px; border:0; background:linear-gradient(150deg,#e5bf754a,#f9efd731); border-radius:90% 0 90% 0; transform:rotate(-25deg); }
.family-saying { display:flex; align-items:center; gap:12px; padding:20px 8px 23px; }.saying-icon { display:grid; place-items:center; min-width:36px; height:40px; color:#b18a4c; }
.family-saying span:not(.saying-icon) { display:block; color:#9b8054; font-size:10px; letter-spacing:.12em; margin-bottom:5px; }.family-saying p { color:#66766b; font-size:12px; line-height:1.8; }
.glass-card { background:linear-gradient(125deg,#ffffffe0,#ffffffa6); border:1px solid #ffffffeb; border-radius:22px; box-shadow:0 7px 25px #3c6a5010,inset 0 1px 0 #fff; backdrop-filter:blur(18px); }
.family-selection { padding:25px 20px; }.section-eyebrow { display:block; font-size:10px; color:#8a967d; letter-spacing:.08em; margin-bottom:8px; }.family-living h2 { font-size:19px; line-height:1.5; font-weight:650; }.soft-copy { color:var(--family-muted); font-size:12px; line-height:1.9; margin-top:8px!important; }
.family-member-list { display:grid; gap:12px; margin:23px 0; }.family-member { display:flex; align-items:center; gap:13px; min-width:0; padding:17px 13px; border:1px solid var(--family-border); border-radius:17px; cursor:pointer; transition:background .2s,transform .2s,box-shadow .2s; }.family-member input { position:absolute; opacity:0; width:1px; height:1px; }.family-member.is-selected { background:#e9f2e4b8; border-color:#83a18b; box-shadow:0 4px 12px #6c8d6510; }
.family-avatar { width:49px; height:49px; border-radius:50%; display:grid; place-items:center; flex-shrink:0; color:#547856; background:#e3eedb; font-size:20px; position:relative; }.family-avatar.amber { color:#927449; background:#f0e6d3; }.family-avatar svg { position:absolute; right:-3px; bottom:0; background:#f7f9f2; border-radius:50%; padding:2px; box-sizing:content-box; }.family-member-copy { display:grid; gap:6px; flex:1; min-width:0; }.family-member-copy strong { font-size:16px; font-weight:600; }.family-member-copy small { font-size:10px; color:var(--family-muted); line-height:1.8; }.member-check { display:grid; place-items:center; width:21px; height:21px; border:1px solid #b4c3ac; border-radius:50%; color:#fff; flex-shrink:0; }.is-selected .member-check { border-color:#67846c; background:#67846c; }
.family-primary { display:inline-flex; align-items:center; justify-content:center; gap:9px; min-height:44px; padding:11px 18px; border:0; border-radius:14px; color:#fff; background:linear-gradient(110deg,#477765,#2f6156); box-shadow:0 5px 15px #436d5724; font-size:13px!important; transition:transform .2s,box-shadow .2s; }.family-selection>.family-primary { width:100%; }
.family-person-bar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 4px; margin:0 0 19px; }.family-person-bar>div { display:flex; gap:8px; align-items:center; min-width:0; }.family-person-bar strong { font-size:12px; font-weight:550; }.tiny-avatar { display:grid; place-items:center; width:28px; height:28px; background:#e5eddb; color:#638264; border-radius:50%; font-size:12px; flex-shrink:0; }
.family-text-button { display:inline-flex; align-items:center; gap:4px; padding:7px 0; min-height:36px; background:transparent; border:0; color:var(--family-green); font-size:11px!important; flex-shrink:0; }
.family-digest { padding:21px 19px 15px; background:linear-gradient(135deg,#f8fcf1e6,#ffffffe0); }.family-digest>header,.family-letter>header { display:flex; align-items:center; gap:11px; }.digest-icon,.letter-icon { display:grid; place-items:center; width:38px; height:38px; border-radius:13px; background:#e9f0d9; color:#75864e; flex-shrink:0; }.family-digest h2,.family-letter h2 { font-size:16px; }.family-digest header p,.family-letter header p { margin-top:5px; font-size:11px; color:var(--family-muted); line-height:1.8; }
.digest-points { list-style:none; padding:0; margin:18px 0 12px; display:grid; gap:16px; }.digest-points>li { display:flex; gap:8px; }.digest-leaf { flex-shrink:0; color:#83986a; padding-top:4px; }.digest-points p { font-size:13px; line-height:1.95; }.digest-points details { margin-top:5px; }.digest-points summary { display:inline-flex; align-items:center; gap:5px; list-style:none; font-size:10px; cursor:pointer; color:#67816c; min-height:28px; }.digest-points summary::-webkit-details-marker { display:none; }.source-link { display:flex; gap:5px; justify-content:space-between; text-align:left; width:100%; padding:10px; margin:6px 0 0; color:#5b7463; background:#eaf0e5; border:0; border-radius:10px; font-size:11px!important; line-height:1.8; }.source-link svg { flex-shrink:0; margin-top:4px; }
.digest-footnote { border-top:1px solid #66804c15; padding-top:12px; font-size:10px; color:#8b9582; line-height:1.8; }.digest-loading,.digest-fallback { font-size:12px; line-height:1.8; color:#6a8065; padding:20px 0; }.digest-loading { display:flex; gap:8px; align-items:center; }.breathing-dot { width:7px; height:7px; background:#8eac77; border-radius:50%; flex-shrink:0; animation:breathe 1.5s infinite; }
.family-stories { margin-top:30px; }.stories-heading { display:flex; justify-content:space-between; align-items:center; margin:0 5px 24px; }.stories-heading h2 { font-size:21px; }.stories-heading .section-eyebrow { margin-bottom:4px; }.refresh-stories { display:grid; place-items:center; min-width:38px; height:38px; border-radius:50%; border:1px solid var(--family-border); background:#ffffff75; color:#668469; }
.life-tree,.tree-day>ol { padding:0; margin:0; list-style:none; }.life-tree { padding-left:11px; }.tree-day { padding-bottom:21px; border-left:1px solid #adc2a58c; }.tree-day-label { display:flex; align-items:center; position:relative; gap:10px; color:#748166; font-size:11px; padding-left:17px; margin-bottom:13px; }.tree-bud { position:absolute; left:-5px; width:9px; height:9px; border-radius:50%; background:#8da37d; box-shadow:0 0 0 5px #edf3e8; }.tree-branch { padding-left:19px; position:relative; margin-bottom:14px; }.tree-branch:last-child { margin-bottom:0; }.tree-branch:before { content:''; position:absolute; left:0; top:27px; width:20px; height:1px; background:#b7c7ac; }.branch-leaf { position:absolute; left:-8px; top:20px; color:#8fa880; background:#f3f7ed; border-radius:50%; transform:rotate(-12deg); }
.story-card { padding:18px 16px 13px; transition:box-shadow .25s,background .25s; scroll-margin-top:90px; }.story-card.highlighted { background:#f2f8e6; box-shadow:0 0 0 2px #8ba777,0 8px 22px #66805617; }.story-card>header { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:13px; flex-wrap:wrap; }.story-kicker { display:flex; align-items:center; gap:5px; color:#8b9a7c; font-size:9px; }.story-kicker>span { width:4px; height:4px; background:#9eb08a; border-radius:50%; }.story-card time { color:#99a38f; font-size:9px; }.story-card h3 { font-size:16px; font-weight:600; margin-bottom:10px; }.story-text { line-height:2; font-size:13px; color:#4f6357; white-space:pre-wrap; }.story-card>footer { margin-top:14px; border-top:1px solid #8a9d7717; padding-top:9px; color:#98a08f; font-size:9px; line-height:1.8; }
.story-photos { display:grid; gap:10px; margin-top:15px; }.story-photos.multiple { grid-template-columns:repeat(2,minmax(0,1fr)); }.story-photos figure { min-width:0; margin:0; }.story-photo { display:block; position:relative; padding:0; border:0; border-radius:13px; overflow:hidden; width:100%; background:#e6eddd; }.story-photo img { width:100%; aspect-ratio:1.55; object-fit:cover; display:block; transition:transform .4s; }.story-photo>span { position:absolute; right:8px; bottom:8px; background:#ffffffcc; backdrop-filter:blur(10px); border-radius:12px; padding:4px 8px; font-size:9px; color:#53644e; }.story-photos figcaption { font-size:9px; color:#929c86; padding:7px 3px 0; line-height:1.8; }.photo-placeholder { padding:30px 10px; background:#eef2e7; border-radius:12px; color:#7d8b72; text-align:center; font-size:11px; }
.tree-ending { display:flex; gap:8px; align-items:center; justify-content:center; color:#9ba68c; font-size:10px; padding:1px 0 19px; }.feed-range-note { font-size:11px; color:#758469; padding:5px 20px 14px; }.family-empty { text-align:center; padding:30px 18px; font-size:12px; line-height:2; color:#849077; }.family-empty h3 { color:#65755b; font-size:16px; margin:8px 0; }
.family-letter { padding:22px 19px; margin-top:10px; }.letter-icon { color:#9c865a; background:#f3ead7; }.family-letter form { margin-top:18px; }.family-letter textarea { resize:vertical; display:block; width:100%; box-sizing:border-box; padding:14px; border:1px solid #d8dfcf; background:#fcfcf7b3; border-radius:14px; font:inherit; font-size:12px; color:#455d50; line-height:1.9; }.family-letter textarea::placeholder { color:#a1a892; }.family-letter textarea:focus { outline:2px solid #8faa7b; outline-offset:2px; }.letter-actions { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:12px; }.letter-actions>span { font-size:9px; color:#929b84; }.letter-actions>.family-primary { font-size:11px!important; padding:8px 13px; min-height:40px; flex-shrink:0; }
.letter-history { margin-top:20px; border-top:1px solid var(--family-border); padding-top:10px; }.letter-history>summary { display:flex; align-items:center; gap:8px; list-style:none; font-size:12px; color:#6a7d63; cursor:pointer; min-height:38px; }.letter-history>summary>span { font-size:10px; color:#92a083; flex:1; }.letter-history>summary::-webkit-details-marker { display:none; }.letter-item { border-top:1px solid var(--family-border); padding:16px 0; font-size:12px; line-height:1.9; }.letter-item>div:first-child { display:flex; align-items:center; justify-content:space-between; color:#89977e; font-size:10px; margin-bottom:8px; }.letter-item time { font-size:9px; }.letter-item p { white-space:pre-wrap; }.letter-reply { padding:13px; margin-top:12px; border-radius:12px; background:#edf2e6; color:#5c7153; }.letter-reply strong { display:block; font-size:10px; font-weight:500; margin-bottom:6px; }.letter-reply small { color:#89957e; font-size:9px; }.reply-pending { display:block; margin-top:8px; font-size:10px; color:#99a18d; }
.family-signoff { text-align:center; padding:35px 0 4px; color:#9caa90; }.family-signoff>svg { margin:0 auto; }.family-signoff p { font-size:11px; margin:10px 0; }.family-signoff>span { font-size:9px; letter-spacing:.1em; color:#a6af9a; }.demo-note { margin:-5px 6px 18px!important; color:#8c8a72; font-size:10px; line-height:1.8; }.family-notice { background:#fff6e7; color:#8a683f; padding:15px; border-radius:15px; font-size:12px; margin-bottom:15px; }.family-notice button { min-height:38px; border:0; color:#796139; background:none; text-decoration:underline; }.family-error { color:#a65641; font-size:11px; margin-top:10px!important; line-height:1.9; }.family-success { color:#467657; font-size:11px; margin-top:10px!important; }
.family-photo-dialog { background:transparent; width:min(94vw,800px); max-height:90dvh; border-radius:18px; }.photo-lightbox { position:relative; background:#fafbf6; padding:12px; }.photo-lightbox>button { position:absolute; z-index:1; top:20px; right:20px; display:grid; place-items:center; width:36px; height:36px; color:white; background:#283d38bb; border:0; border-radius:50%; }.photo-lightbox img { display:block; width:100%; max-height:75dvh; object-fit:contain; border-radius:10px; }.photo-lightbox p { color:#5e705b; font-size:12px; padding:14px 7px 7px; text-align:center; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }.spinning { animation:spin 1s linear infinite; }@keyframes breathe { 50% { opacity:.35; } } @keyframes spin { to { transform:rotate(360deg); } }
@media (hover:hover) { .family-member:hover { transform:translateY(-2px); box-shadow:0 8px 18px #5e81501a; }.family-primary:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 7px 20px #436d5738; }.story-photo:hover img { transform:scale(1.025); } }
@media (min-width:768px) { .family-living { padding:20px 25px 40px; }.family-welcome { padding:37px 30px; }.family-selection { padding:32px; }.family-digest,.family-letter { padding:25px; }.story-card { padding:22px; }.family-person-bar strong { font-size:14px; }.family-stories { margin-top:38px; } }
@media (max-width:360px) { .family-welcome { padding:25px 17px; }.family-selection,.family-digest,.family-letter { padding:20px 15px; }.family-member { padding:14px 10px; gap:10px; }.family-member-copy small { font-size:9px; }.family-person-bar strong { font-size:11px; }.family-text-button { font-size:10px!important; }.story-card { padding:15px 12px; }.letter-actions { align-items:flex-start; flex-direction:column-reverse; }.letter-actions>.family-primary { width:100%; }.life-tree { padding-left:8px; }.tree-branch { padding-left:14px; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
:global([data-reduce-transparency=true]) .family-living .glass-card { background:#fcfdf9; backdrop-filter:none; }
</style>

<style scoped>
.family-living .story-text,.family-living .digest-points p { font-size:14px; }
.family-living .family-digest header p,.family-living .family-letter header p { font-size:12px; }
.family-living .digest-footnote,.family-living .story-card>footer { font-size:11px; }
.family-living .family-letter textarea,.family-living .letter-item { font-size:14px; }
.family-living .family-saying p { font-size:13px; }
</style>
