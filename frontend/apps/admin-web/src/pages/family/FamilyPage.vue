<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { useFamilyCases } from '../../services/data'
import QueryFeedback from '../../components/QueryFeedback.vue'
import StatusLabel from '../../components/StatusLabel.vue'
const cases = useFamilyCases()
</script>
<template>
  <section>
    <div class="page-title-row">
      <h1>家属沟通</h1>
      <el-button
        class="icon-button"
        title="刷新家属沟通"
        aria-label="刷新家属沟通"
        :loading="cases.isFetching.value"
        @click="cases.refetch()"
      >
        <RefreshCw
          :size="18"
          aria-hidden="true"
        />
      </el-button>
    </div>
    <div class="data-section">
      <QueryFeedback
        :loading="cases.isPending.value"
        :error="cases.error.value"
        @retry="cases.refetch()"
      /><el-table
        v-if="!cases.isPending.value && !cases.error.value"
        :data="cases.data.value ?? []"
        empty-text="暂无公开内容"
      >
        <el-table-column
          prop="subject"
          label="诉求"
          min-width="200"
        /><el-table-column
          label="状态"
          min-width="100"
        >
          <template #default="{ row }">
            <StatusLabel
              :status="row.status"
              kind="family"
            />
          </template>
        </el-table-column><el-table-column
          prop="reply"
          label="公开回复"
          min-width="280"
        />
      </el-table>
    </div>
    <p class="muted">
      动态摘要与提交问题暂未接入。
    </p>
  </section>
</template>
