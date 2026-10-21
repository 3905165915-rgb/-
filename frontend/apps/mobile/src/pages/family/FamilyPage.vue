<script setup lang="ts">
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
      empty-text="暂无公开内容"
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
        >{{ statusMeta(item.status).label }}</span>
        <p class="family-reply">
          {{ item.reply || '暂无公开回复' }}
        </p>
      </article>
    </div>
    <p class="muted">
      动态摘要与提交问题暂未接入。
    </p>
    <van-button
      block
      disabled
    >
      提交问题暂不可用
    </van-button>
  </section>
</template>
