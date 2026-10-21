<script setup lang="ts">
import { computed, ref } from 'vue'
import { Save, Send, SlidersHorizontal, X } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import type { Task } from '@hulao/shared'
import { mode, useElders } from '../services/data'
import { useHandoverEditor } from '../composables/useHandoverEditor'
import FeedbackState from './FeedbackState.vue'
const props = withDefaults(
  defineProps<{ shiftId: string; tasks: Task[]; sourceWritable?: boolean }>(),
  { sourceWritable: true },
)
const route = useRoute()
const router = useRouter()
const elders = useElders()
const keyword = ref('')
const elderFilter = ref('')
const shiftFilter = ref('')
const assigneeFilter = ref('')
const selectedOnly = ref(false)
const filterOpen = ref(false)
const sourcesReady = computed(
  () => props.sourceWritable && !elders.isPending.value && !elders.error.value,
)
const filterCount = computed(
  () =>
    [
      elderFilter.value,
      shiftFilter.value,
      assigneeFilter.value,
      selectedOnly.value,
    ].filter(Boolean).length,
)
const ongoing = computed(() => [
  ...new Map(
    props.tasks
      .filter(
        (task) =>
          task.itemId &&
          !['completed', 'not_done', 'cancelled'].includes(task.status),
      )
      .map((task) => [task.itemId, task]),
  ).values(),
])
const {
  editor,
  busy,
  dirty,
  deleted,
  error,
  message,
  branches,
  versions,
  saveStatus,
  changed,
  save,
  persist,
  restore,
  copyAsNew,
  loadBranch,
  loadSaved,
} = useHandoverEditor(
  () => props.shiftId,
  () => (typeof route.query.draft === 'string' ? route.query.draft : undefined),
  () => ongoing.value.map((task) => task.itemId!),
)
const elderLabel = (id: string) => {
  const elder = elders.data.value?.find((row) => row.id === id)
  return elder ? elder.name + ' · ' + elder.bedLabel : id
}
const sourceShifts = computed(() => [
  ...new Set(ongoing.value.map((task) => task.shift).filter(Boolean)),
])
const assignees = computed(() => [
  ...new Set(ongoing.value.map((task) => task.assignee).filter(Boolean)),
])
const visible = computed(() =>
  ongoing.value.filter(
    (task) =>
      (!elderFilter.value || task.elderId === elderFilter.value) &&
      (!shiftFilter.value || task.shift === shiftFilter.value) &&
      (!assigneeFilter.value || task.assignee === assigneeFilter.value) &&
      (!selectedOnly.value || editor.value?.itemIds.includes(task.itemId!)) &&
      (!keyword.value.trim() ||
        [task.title, task.id, elderLabel(task.elderId), task.assignee]
          .join(' ')
          .toLowerCase()
          .includes(keyword.value.trim().toLowerCase())),
  ),
)
function resetFilters() {
  keyword.value = ''
  elderFilter.value = ''
  shiftFilter.value = ''
  assigneeFilter.value = ''
  selectedOnly.value = false
}
async function saveAsNew() {
  await copyAsNew()
  if (editor.value && !dirty.value && typeof route.query.draft === 'string')
    await router.replace({
      query: { ...route.query, draft: editor.value.localId },
    })
}
defineExpose({ save, persist, dirty, busy })
</script>
<template>
  <section class="handover-editor">
    <h2>交班编辑</h2>
    <p
      v-if="error"
      class="error-text"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
    >
      {{ message }}
    </p>
    <template v-if="editor">
      <p
        class="save-status"
        role="status"
      >
        {{ saveStatus
        }}<span v-if="editor.persistedVersion !== undefined">
          · {{ editor.updatedAt }}</span>
      </p>
      <div
        v-if="error || deleted"
        class="action-row"
      >
        <van-button
          size="small"
          icon="replay"
          :disabled="busy"
          @click="loadSaved"
        >
          载入已保存版本
        </van-button>
        <van-button
          size="small"
          icon="add-o"
          aria-label="另存当前内容"
          :disabled="busy"
          @click="saveAsNew"
        >
          另存当前内容
        </van-button>
      </div>
      <fieldset
        class="plain-fieldset form-band"
        :disabled="busy || deleted"
      >
        <van-field
          v-model="editor.note"
          type="textarea"
          rows="3"
          label="交班备注"
          :disabled="busy"
          @update:model-value="changed"
        />
        <div class="page-title-row">
          <h3>延续事项</h3>
          <button
            type="button"
            class="icon-button"
            title="筛选延续事项"
            aria-label="筛选延续事项"
            :disabled="busy || deleted"
            @click="filterOpen = true"
          >
            <SlidersHorizontal
              :size="20"
              aria-hidden="true"
            /><span
              v-if="filterCount"
              class="filter-count"
            >{{ filterCount }}</span>
          </button>
        </div>
        <van-search
          v-model="keyword"
          aria-label="搜索已载入事项"
          placeholder="搜索已载入事项"
        />
        <van-popup
          v-model:show="filterOpen"
          teleport="body"
          position="bottom"
          class="mobile-sheet hl-glass"
          aria-label="筛选延续事项"
          close-on-popstate
        >
          <header class="sheet-heading">
            <h2>筛选延续事项</h2>
            <button
              type="button"
              class="icon-button"
              title="关闭事项筛选"
              aria-label="关闭事项筛选"
              @click="filterOpen = false"
            >
              <X
                :size="20"
                aria-hidden="true"
              />
            </button>
          </header>
          <div class="sheet-body">
            <div class="filter-grid">
              <label class="select-field">老人<select
                v-model="elderFilter"
                aria-label="老人"
              >
                <option value="">全部</option>
                <option
                  v-for="elder in elders.data.value"
                  :key="elder.id"
                  :value="elder.id"
                >
                  {{ elder.name }} · {{ elder.bedLabel }}
                </option>
              </select></label>
              <label class="select-field">来源班次<select
                v-model="shiftFilter"
                aria-label="来源班次"
              >
                <option value="">全部</option>
                <option
                  v-for="name in sourceShifts"
                  :key="name"
                >
                  {{ name }}
                </option>
              </select></label>
              <label class="select-field">责任人<select
                v-model="assigneeFilter"
                aria-label="责任人"
              >
                <option value="">全部</option>
                <option
                  v-for="name in assignees"
                  :key="name"
                >
                  {{ name }}
                </option>
              </select></label>
            </div>
            <div class="action-row">
              <label class="selection-toggle">仅看已选 <van-switch
                v-model="selectedOnly"
                size="20"
              /></label><van-button
                size="small"
                icon="replay"
                aria-label="重置筛选"
                @click="resetFilters"
              >
                重置筛选
              </van-button>
            </div>
          </div>
          <footer class="sheet-footer">
            <van-button
              type="primary"
              @click="filterOpen = false"
            >
              显示事项
            </van-button>
          </footer>
        </van-popup>
        <FeedbackState
          :loading="elders.isPending.value"
          :error="elders.error.value"
          @retry="elders.refetch()"
        />
        <p class="muted">
          已载入事项 · 当前 {{ sourcesReady ? visible.length : '待载入' }} 项 ·
          已选 {{ editor.itemIds.length }} 项
        </p>
        <van-empty
          v-if="sourcesReady && !visible.length"
          :description="
            ongoing.length ? '没有匹配事项，请调整筛选' : '暂无有事项编号的待办'
          "
        /><van-checkbox-group
          v-show="sourcesReady"
          v-model="editor.itemIds"
          @change="changed"
        >
          <div
            v-for="task in visible"
            :key="task.id"
            class="handover-source"
          >
            <van-checkbox
              :name="task.itemId"
              :disabled="busy || deleted || !sourcesReady"
            >
              {{ elderLabel(task.elderId) }} · {{ task.title }}
            </van-checkbox>
            <p class="muted">
              {{ task.shift || '班次未提供' }} ·
              {{ task.assignee || '责任人未提供' }}
            </p>
            <van-field
              v-if="editor.itemIds.includes(task.itemId!)"
              v-model="editor.clarification[task.itemId!]"
              label="待澄清"
              type="textarea"
              :disabled="busy"
              @update:model-value="changed"
            /><van-button
              size="mini"
              icon="clock-o"
              :to="'/timeline/' + encodeURIComponent(task.itemId!)"
            >
              来源回放
            </van-button>
          </div>
        </van-checkbox-group>
        <p
          v-for="id in editor.itemIds.filter(
            (id) => !ongoing.some((task) => task.itemId === id),
          )"
          :key="id"
          class="warning-text"
        >
          事项 {{ id }} 当前不在待办列表中，请核实。
        </p>
      </fieldset>
      <p
        v-if="mode === 'api'"
        class="muted"
      >
        交班提交暂未接入，可保存本机版本。
      </p>
      <footer class="editor-footer hl-glass">
        <p
          class="save-status"
          role="status"
        >
          {{ saveStatus
          }}<span v-if="editor.persistedVersion !== undefined">
            · {{ editor.updatedAt }}</span>
        </p>
        <div class="footer-actions">
          <van-button
            :loading="busy"
            :disabled="busy || deleted"
            @click="save()"
          >
            <Save
              :size="17"
              aria-hidden="true"
            />保存本机版本
          </van-button><van-button
            type="primary"
            :loading="busy"
            :disabled="
              mode !== 'demo' ||
                busy ||
                !editor.itemIds.length ||
                deleted ||
                !sourcesReady
            "
            @click="save(true)"
          >
            <Send
              :size="17"
              aria-hidden="true"
            />{{
              mode === 'demo' ? '提交演示交班' : '提交暂不可用'
            }}
          </van-button>
        </div>
      </footer>
    </template>
    <h2>本机版本</h2>
    <div
      v-for="branch in branches.filter(
        (row) => row.localId !== editor?.localId,
      )"
      :key="branch.localId"
      class="version-row"
    >
      <p>独立恢复草稿 · {{ branch.updatedAt }}</p>
      <p>{{ branch.note || '无备注' }}</p>
      <van-button
        size="small"
        :disabled="busy"
        @click="loadBranch(branch)"
      >
        打开恢复草稿
      </van-button>
    </div>
    <FeedbackState
      :loading="versions.isPending.value"
      :error="versions.error.value"
      :empty="
        !versions.isPending.value &&
          !versions.error.value &&
          !versions.data.value?.length
      "
      empty-text="暂无保存版本"
      @retry="versions.refetch()"
    />
    <div
      v-for="version in versions.data.value"
      :key="version.localId"
      class="version-row"
    >
      <b>版本 {{ version.version }} ·
        {{ version.phase === 'submitted_demo' ? '演示已提交' : '仅本机' }}</b>
      <p>{{ version.updatedAt }}</p>
      <p>{{ version.note || '无备注' }}</p>
      <p>事项：{{ version.itemIds.join('、') || '无' }}</p>
      <van-button
        size="small"
        :disabled="busy"
        @click="restore(version)"
      >
        恢复为新草稿
      </van-button>
    </div>
  </section>
</template>
