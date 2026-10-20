<script setup lang="ts">
import { ref } from 'vue'
import { Files } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import type { LocalDraftRow } from '@hulao/shared'
import { useLocalDraftManager } from '../composables/useLocalDraftManager'
const router = useRouter()
const preview = ref<LocalDraftRow>()
const {
  open,
  rows,
  selected,
  keyword,
  type,
  state,
  loading,
  busy,
  error,
  estimate,
  filtered,
  selectedRows,
  bytes,
  phases,
  rowKey,
  formatBytes,
  refresh,
  toggleAll,
  remove,
} = useLocalDraftManager()
async function confirmDelete(targets: LocalDraftRow[]) {
  try {
    await showConfirmDialog({
      title: '删除本机草稿',
      message: `删除 ${targets.length} 项，约 ${formatBytes(targets.reduce((sum, row) => sum + row.bytes, 0))}？云端内容不受影响。`,
    })
  } catch {
    return
  }
  await remove(targets)
}
async function openDraft(row: LocalDraftRow) {
  if (row.store === 'handoverEditors') {
    preview.value = row
    return
  }
  open.value = false
  await router.push(row.url)
}
</script>
<template>
  <div class="local-draft-tools">
    <button
      type="button"
      class="icon-button"
      title="本机草稿"
      aria-label="本机草稿"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="open = true"
    >
      <Files
        :size="20"
        aria-hidden="true"
      />
    </button>
  </div>
  <van-popup
    v-model:show="open"
    teleport="body"
    position="bottom"
    round
    class="draft-popup hl-glass"
    aria-label="本机草稿"
    :close-on-click-overlay="!busy"
  >
    <header class="page-title-row">
      <h2>本机草稿</h2>
      <van-button
        size="small"
        icon="cross"
        aria-label="关闭草稿管理"
        title="关闭草稿管理"
        :disabled="busy"
        @click="open = false"
      />
    </header>
    <p class="muted">
      {{ rows.length }} 项 · 草稿估算 {{ formatBytes(bytes)
      }}<span v-if="estimate !== undefined">
        · 站点总用量约 {{ formatBytes(estimate) }}</span>
    </p>
    <van-search
      v-model="keyword"
      placeholder="搜索草稿内容或编号"
    />
    <div class="filter-grid">
      <label class="select-field">类型<select v-model="type">
        <option value="">全部</option>
        <option
          v-for="name in ['记录', '任务', '交班草稿', '交班版本']"
          :key="name"
        >
          {{ name }}
        </option>
      </select></label>
      <label class="select-field">状态<select v-model="state">
        <option value="">全部</option>
        <option
          v-for="(label, key) in phases"
          :key="key"
          :value="key"
        >
          {{ label }}
        </option>
      </select></label>
    </div>
    <p
      v-if="error"
      class="error-text"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="action-row">
      <van-button
        size="small"
        icon="replay"
        :loading="loading"
        @click="refresh"
      >
        刷新
      </van-button><van-button
        size="small"
        @click="toggleAll(selected.length === 0)"
      >
        {{ selected.length ? '取消选择' : '选择可删除项' }}
      </van-button>
    </div>
    <van-loading v-if="loading" />
    <van-empty
      v-else-if="!error && !filtered.length"
      :description="rows.length ? '没有匹配草稿，请调整筛选' : '暂无本机草稿'"
    />
    <van-checkbox-group
      v-show="!loading && !error"
      v-model="selected"
      class="draft-list"
    >
      <article
        v-for="row in filtered"
        :key="rowKey(row)"
        class="draft-row"
      >
        <van-checkbox
          :name="rowKey(row)"
          :disabled="row.protected || busy"
        >
          {{ row.type }} · {{ phases[row.status] || '未知状态' }}
        </van-checkbox>
        <p class="draft-title">
          {{ row.title }}
        </p>
        <p class="muted">
          {{ row.updatedAt || '时间未提供' }} · {{ row.attachments }} 个附件 ·
          {{ formatBytes(row.bytes) }}
        </p>
        <p
          v-if="row.protected"
          class="warning-text"
        >
          提交保护中，暂不可删除
        </p>
        <div class="action-row">
          <van-button
            size="small"
            :icon="row.store === 'handoverEditors' ? 'eye-o' : 'edit'"
            :disabled="busy"
            @click="openDraft(row)"
          >
            {{
              row.store === 'handoverEditors' ? '查看版本' : '打开'
            }}
          </van-button><van-button
            size="small"
            icon="delete-o"
            aria-label="删除草稿"
            title="删除草稿"
            :disabled="row.protected || busy"
            @click="confirmDelete([row])"
          />
        </div>
      </article>
    </van-checkbox-group>
    <footer class="draft-footer hl-glass">
      <span>已选 {{ selectedRows.length }} 项</span><van-button
        type="danger"
        size="small"
        icon="delete-o"
        :disabled="!selectedRows.length || busy"
        :loading="busy"
        @click="confirmDelete(selectedRows)"
      >
        删除所选
      </van-button>
    </footer>
  </van-popup>
  <van-popup
    teleport="body"
    :show="!!preview"
    position="bottom"
    class="draft-popup hl-glass"
    aria-label="历史版本"
    @update:show="preview = undefined"
  >
    <header class="page-title-row">
      <h2>历史版本</h2>
      <van-button
        size="small"
        icon="cross"
        aria-label="关闭历史版本"
        title="关闭历史版本"
        @click="preview = undefined"
      />
    </header>
    <p>{{ preview?.type }} · {{ preview?.updatedAt }}</p>
    <pre class="draft-preview">{{ preview?.preview }}</pre>
  </van-popup>
</template>
