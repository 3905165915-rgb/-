<script setup lang="ts">
import { ref } from 'vue'
import WorkspaceDrafts from '../../../../packages/shared/src/workflow/WorkspaceDrafts.vue'
import WorkflowJournals from '../../../../packages/shared/src/workflow/WorkflowJournals.vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { Files } from 'lucide-vue-next'
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
defineExpose({
  show: () => {
    open.value = true
  },
})
async function confirmDelete(targets: LocalDraftRow[]) {
  try {
    await ElMessageBox.confirm(
      `删除 ${targets.length} 项，约 ${formatBytes(targets.reduce((sum, row) => sum + row.bytes, 0))}？云端内容不受影响。`,
      '删除本机草稿',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await remove(targets)
}
async function openDraft(row: LocalDraftRow) {
  if (row.store === 'taskEditors') {
    const path = new URL(row.url, window.location.origin)
    open.value = false
    await router.push({
      path: '/tasks',
      query: {
        task: decodeURIComponent(path.pathname.split('/').pop()!),
        draft: row.id,
      },
    })
  } else preview.value = row
}
</script>
<template>
  <el-button
    text
    class="drafts-trigger"
    title="本机草稿"
    aria-label="本机草稿"
    @click="open = true"
  >
    <Files
      :size="18"
      aria-hidden="true"
    /><span>本机草稿</span>
  </el-button>
  <el-dialog
    v-model="open"
    title="本机草稿"
    width="min(900px, 94vw)"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
  >
    <WorkspaceDrafts v-if="open" @navigate="open=false" />
    <details><summary>业务表单与多窗口恢复日志</summary><WorkflowJournals v-if="open" /></details>
    <p class="muted">
      {{ rows.length }} 项 · 草稿估算 {{ formatBytes(bytes)
      }}<span v-if="estimate !== undefined">
        · 站点总用量约 {{ formatBytes(estimate) }}</span>
    </p>
    <div class="draft-filters">
      <el-input
        v-model="keyword"
        aria-label="搜索草稿"
        placeholder="搜索草稿内容或编号"
        clearable
      />
      <el-select
        v-model="type"
        aria-label="草稿类型"
        clearable
        placeholder="全部类型"
      >
        <el-option
          v-for="name in ['记录', '任务', '交班草稿', '交班版本']"
          :key="name"
          :value="name"
          :label="name"
        />
      </el-select>
      <el-select
        v-model="state"
        aria-label="草稿状态"
        clearable
        placeholder="全部状态"
      >
        <el-option
          v-for="(label, key) in phases"
          :key="key"
          :value="key"
          :label="label"
        />
      </el-select>
      <el-button
        :loading="loading"
        @click="refresh"
      >
        刷新
      </el-button>
    </div>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    />
    <div class="action-row">
      <el-checkbox
        :model-value="!!selected.length"
        :disabled="busy"
        @change="
          (value: string | number | boolean) => toggleAll(Boolean(value))
        "
      >
        选择可删除项
      </el-checkbox>
    </div>
    <div
      v-if="loading"
      role="status"
    >
      正在读取本机草稿
    </div>
    <el-empty
      v-else-if="!filtered.length"
      description="暂无匹配草稿"
    />
    <el-checkbox-group
      v-model="selected"
      class="draft-list"
    >
      <article
        v-for="row in filtered"
        :key="rowKey(row)"
        class="draft-row"
      >
        <el-checkbox
          :value="rowKey(row)"
          :disabled="row.protected || busy"
        >
          {{ row.type }} · {{ phases[row.status] || '未知状态' }}
        </el-checkbox>
        <p class="draft-title">
          {{ row.title }}
        </p>
        <p class="muted">
          {{ row.updatedAt || '时间未提供' }} · {{ row.attachments }} 个附件 ·
          {{ formatBytes(row.bytes) }}
        </p>
        <div class="action-row">
          <el-button
            link
            type="primary"
            :disabled="busy"
            @click="openDraft(row)"
          >
            {{
              row.store === 'taskEditors' ? '继续编辑' : '查看内容'
            }}
          </el-button><el-button
            link
            type="danger"
            :disabled="row.protected || busy"
            @click="confirmDelete([row])"
          >
            删除
          </el-button><span
            v-if="row.protected"
            class="warning-text"
          >提交保护中</span>
        </div>
      </article>
    </el-checkbox-group>
    <template #footer>
      <span>已选 {{ selectedRows.length }} 项 </span><el-button
        type="danger"
        :loading="busy"
        :disabled="!selectedRows.length || busy"
        @click="confirmDelete(selectedRows)"
      >
        删除所选
      </el-button>
    </template>
  </el-dialog>
  <el-dialog
    :model-value="!!preview"
    title="草稿内容"
    width="min(650px, 94vw)"
    @close="preview = undefined"
  >
    <p>{{ preview?.type }} · {{ preview?.updatedAt }}</p>
    <pre class="draft-preview">{{ preview?.preview }}</pre>
  </el-dialog>
</template>
