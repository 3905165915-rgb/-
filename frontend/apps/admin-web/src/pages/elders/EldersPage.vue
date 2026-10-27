<script setup lang="ts">
import { formatBusinessTime } from '@hulao/shared'
import WorkflowPanel from '@hulao/shared/workflow'
import CareAssignments from './CareAssignments.vue'
import { computed, ref } from 'vue'
import { ArrowUpRight, RefreshCw, RotateCcw, Search } from 'lucide-vue-next'
import { mode, useElders } from '../../services/data'
import QueryFeedback from '../../components/QueryFeedback.vue'
const elders = useElders()
const keyword = ref('')
const creating = ref(false)
const status = ref('')
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
    <CareAssignments v-if="mode === 'api'" @changed="elders.refetch()" />
    <div class="data-section">
      <el-form inline class="filter-bar">
        <el-form-item label="搜索">
          <el-input v-model="keyword" placeholder="姓名、编号或床位" clearable>
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
        <el-table-column label="姓名 / 编号" min-width="180">
          <template #default="{ row }">
            <div class="table-primary">
              {{ row.name }}
            </div>
            <div class="table-secondary">
              {{ row.id }}
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
              class="icon-button"
              title="查看老人档案"
              aria-label="查看老人档案"
              @click="$router.push('/elders/' + encodeURIComponent(row.id))"
            >
              <ArrowUpRight :size="18" aria-hidden="true" />
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
