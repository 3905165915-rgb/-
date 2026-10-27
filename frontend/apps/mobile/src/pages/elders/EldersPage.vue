<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, RefreshCw } from 'lucide-vue-next'
import { useElders } from '../../services/data'
import FeedbackState from '../../components/FeedbackState.vue'

const elders = useElders()
const keyword = ref('')
const limit = ref(30)
const ready = computed(() => !elders.isPending.value && !elders.error.value)
const filtered = computed(() => {
  const term = keyword.value.trim().toLocaleLowerCase()
  return (elders.data.value ?? []).filter((elder) =>
    [elder.name, elder.bedLabel, elder.id].some((value) =>
      value.toLocaleLowerCase().includes(term),
    ),
  )
})
const visible = computed(() => filtered.value.slice(0, limit.value))
watch(keyword, () => {
  limit.value = 30
})
</script>

<template>
  <section class="elders-page">
    <header class="page-title-row">
      <h1>老人</h1>
      <button
        type="button"
        class="icon-button"
        title="刷新老人列表"
        aria-label="刷新老人列表"
        :disabled="elders.isFetching.value"
        @click="elders.refetch()"
      >
        <RefreshCw
          :size="20"
          aria-hidden="true"
        />
      </button>
    </header>
    <van-search
      v-model="keyword"
      placeholder="搜索姓名、床位或编号"
      aria-label="搜索老人"
    />
    <FeedbackState
      :loading="elders.isPending.value"
      :error="elders.error.value"
      :empty="ready && !filtered.length"
      :empty-text="keyword.trim() ? '没有匹配的老人' : '暂无可查看的老人'"
      @retry="elders.refetch()"
    />
    <template v-if="ready && filtered.length">
      <p class="muted">
        共 {{ filtered.length }} 位
      </p>
      <ul
        class="elder-list"
        aria-label="老人列表"
      >
        <li
          v-for="elder in visible"
          :key="elder.id"
        >
          <RouterLink
            :to="'/elders/' + encodeURIComponent(elder.id)"
            class="elder-link"
          >
            <div class="elder-identity">
              <strong>{{ elder.name || '姓名未提供' }}</strong>
              <span>{{ elder.bedLabel || '床位未提供' }}</span>

            </div>
            <span class="elder-status">{{ elder.status }}</span>
            <ChevronRight
              :size="18"
              aria-hidden="true"
            />
          </RouterLink>
        </li>
      </ul>
      <van-button
        v-if="visible.length < filtered.length"
        block
        plain
        icon="arrow-down"
        class="mobile-action"
        @click="limit += 30"
      >
        显示更多
      </van-button>
    </template>
  </section>
</template>

<style scoped>
.elder-list {
  padding: 0;
  margin: 0;
  list-style: none;
  border-top: 1px solid var(--hl-border);
}
.elder-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 88px;
  padding: 16px 0;
  color: var(--hl-ink);
  border-bottom: 1px solid var(--hl-border);
}
.elder-link:hover {
  background: var(--hl-primary-soft);
}
.elder-identity {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 4px;
}
.elder-identity strong {
  font-size: 18px;
}
.elder-status {
  max-width: 5em;
  color: var(--hl-muted);
  font-size: 14px;
}
</style>
