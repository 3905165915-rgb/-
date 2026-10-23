<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import { RefreshCw } from 'lucide-vue-next'
import { familyCaseStatusMeta, resolveStatus } from '@hulao/shared'
import { useFamilyCases } from '../../services/data'
import FeedbackState from '../../components/FeedbackState.vue'
const cases = useFamilyCases()
function statusMeta(status: unknown) {
  return resolveStatus(familyCaseStatusMeta, status)
}
</script>
<template>
  <section class="family-page">
    <div class="page-title-row">
      <h1>家属动态</h1>
      <button
        type="button"
        class="icon-button"
        title="刷新家属动态"
        aria-label="刷新家属动态"
        :disabled="cases.isFetching.value"
        @click="cases.refetch()"
      >
        <RefreshCw
          :size="20"
          :class="{ 'is-spinning': cases.isFetching.value }"
          aria-hidden="true"
        />
      </button>
    </div>
    <FeedbackState
      :loading="cases.isPending.value"
      :error="cases.error.value"
      :empty="
        !cases.isPending.value &&
        !cases.error.value &&
        !cases.data.value?.length
      "
      empty-text="暂无已授权内容"
      @retry="cases.refetch()"
    />
    <div
      v-if="
        !cases.isPending.value && !cases.error.value && cases.data.value?.length
      "
      class="family-feed"
    >
      <article
        v-for="item in cases.data.value"
        :key="item.id"
        class="family-item"
      >
        <h2>{{ item.subject }}</h2>
        <span
          class="status-label"
          :data-tone="statusMeta(item.status).tone"
          :title="
            statusMeta(item.status).known ? undefined : String(item.status)
          "
          >{{ statusMeta(item.status).label }}</span
        >
        <p class="family-reply">
          {{ item.reply || '暂无回复' }}
        </p>
      </article>
    </div>
    <p class="muted">
      仅显示授权范围内的已审核简报与反馈，可在下方提交问题和查看回复。
    </p>
    <WorkflowPanel
      group="family"
      title="我的授权、服务简报与问题沟通"
      @changed="cases.refetch()"
    />
  </section>
</template>
