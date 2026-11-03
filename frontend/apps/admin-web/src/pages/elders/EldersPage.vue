<script setup lang="ts">
import { formatBusinessTime } from '@hulao/shared'
import WorkflowPanel from '@hulao/shared/workflow'
import CareAssignments from './CareAssignments.vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RefreshCw, RotateCcw, Search } from 'lucide-vue-next'
import { mode, useElders } from '../../services/data'
import QueryFeedback from '../../components/QueryFeedback.vue'
const elders = useElders()
const route = useRoute(), router = useRouter()
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '')
const creating = ref(false)
const assignmentsOpen = ref(false)
const status = ref(typeof route.query.status === 'string' ? route.query.status : '')
watch(() => route.query, query => {
  keyword.value = typeof query.q === 'string' ? query.q : ''
  status.value = typeof query.status === 'string' ? query.status : ''
})
watch([keyword, status], () => {
  void router.replace({ query: { ...route.query, q: keyword.value || undefined, status: status.value || undefined } })
})
function openElder(id: string) {
  void router.push({ path: '/elders/' + encodeURIComponent(id), query: { list_q: keyword.value || undefined, list_status: status.value || undefined } })
}
function resetFilters() {
  keyword.value = ''
  status.value = ''
}
const rows = computed(() =>
  (elders.data.value ?? []).filter(
    (item) =>
      (!keyword.value ||
        (item.name + item.id + item.bedLabel).includes(keyword.value)) &&
      (!status.value || status.value === item.status),
  ),
)
</script>
<template>
  <section class="elders-page">
    <div class="page-title-row">
      <h1>老人档案</h1>
      <el-button type="primary" @click="creating = !creating">{{
        creating ? '收起办理' : '新建老人'
      }}</el-button>
      <el-button
        class="icon-button"
        title="刷新老人档案"
        aria-label="刷新老人档案"
        :loading="elders.isFetching.value"
        @click="elders.refetch()"
      >
        <RefreshCw :size="18" aria-hidden="true" />
      </el-button>
    </div>
    <WorkflowPanel
      v-if="creating"
      group="elders"
      initial-action="/elders"
      title="新建与维护老人档案"
      @changed="elders.refetch()"
    />
    <el-button
      v-if="mode === 'api'"
      class="assignment-toggle"
      @click="assignmentsOpen = !assignmentsOpen"
      >{{ assignmentsOpen ? '收起照护分配' : '管理照护分配' }}</el-button
    >
    <CareAssignments
      v-if="mode === 'api' && assignmentsOpen"
      @changed="elders.refetch()"
    />
    <div class="data-section">
      <el-form inline class="filter-bar">
        <el-form-item label="搜索">
          <el-input v-model="keyword" placeholder="姓名或床位" clearable>
            <template #prefix>
              <Search :size="16" aria-hidden="true" />
            </template>
          </el-input> </el-form-item
        ><el-form-item label="状态">
          <el-select v-model="status" clearable placeholder="全部状态">
            <el-option
              v-for="value in ['入住', '外出', '离院']"
              :key="value"
              :label="value"
              :value="value"
            />
          </el-select> </el-form-item
        ><el-form-item>
          <el-button
            class="icon-button"
            title="重置筛选"
            aria-label="重置筛选"
            @click="resetFilters"
          >
            <RotateCcw :size="17" aria-hidden="true" />
          </el-button>
        </el-form-item> </el-form
      ><QueryFeedback
        :loading="elders.isPending.value"
        :error="elders.error.value"
        @retry="elders.refetch()"
      /><el-table
        v-if="!elders.isPending.value && !elders.error.value"
        :data="rows"
        :empty-text="
          elders.data.value?.length
            ? '暂无匹配老人，请调整筛选条件'
            : '暂无老人档案'
        "
      >
        <el-table-column label="姓名" min-width="180">
          <template #default="{ row }">
            <div class="table-primary">
              <button
                type="button"
                class="elder-name-link"
                @click="openElder(row.id)"
              >
                {{ row.name || '姓名未提供' }}
              </button>
            </div>
          </template> </el-table-column
        ><el-table-column
          prop="bedLabel"
          label="床位"
          min-width="100"
        /><el-table-column
          prop="status"
          label="状态"
          min-width="90"
        /><el-table-column label="风险" min-width="80">
          <template #default="{ row }">
            <span
              v-if="row.risk"
              class="status-label"
              :class="
                row.risk === '高'
                  ? 'status-danger'
                  : row.risk === '中'
                    ? 'status-warning'
                    : 'status-neutral'
              "
              >{{ row.risk }}</span
            ><span v-else class="muted">未提供</span>
          </template> </el-table-column
        ><el-table-column label="最近更新" min-width="140"
          ><template #default="{ row }">{{
            row.lastUpdate ? formatBusinessTime(row.lastUpdate) : '未提供'
          }}</template></el-table-column
        ><el-table-column label="操作" fixed="right" width="100">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              title="查看老人档案"
              aria-label="查看老人档案"
              @click="openElder(row.id)"
            >
              查看档案
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div
        v-if="!elders.isPending.value && !elders.error.value"
        class="table-footer"
        role="status"
      >
        当前 {{ rows.length }} 位 · 已载入
        {{ elders.data.value?.length ?? 0 }} 位
      </div>
    </div>
  </section>
</template>
