<script setup lang="ts">
import WorkflowPanel from '@hulao/shared/workflow'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useElders, useTasks } from '../../services/data'
import {
  ArrowLeft,
  ArrowUpRight,
  ContactRound,
  History,
  ListChecks,
  ShieldCheck,
} from 'lucide-vue-next'
import StatusLabel from '../../components/StatusLabel.vue'
import QueryFeedback from '../../components/QueryFeedback.vue'
const route = useRoute()
const elders = useElders()
const tasks = useTasks()
const elder = computed(() =>
  elders.data.value?.find((item) => item.id === route.params.id),
)
const related = computed(
  () =>
    tasks.data.value?.filter((item) => item.elderId === elder.value?.id) ?? [],
)
</script>
<template>
  <section class="elder-detail-page">
    <el-button link class="back-link" @click="$router.push('/elders')">
      <ArrowLeft :size="16" aria-hidden="true" />返回档案列表 </el-button
    ><QueryFeedback
      :loading="elders.isPending.value"
      :error="elders.error.value"
      :empty="!elders.isPending.value && !elders.error.value && !elder"
      empty-text="未找到老人档案"
      @retry="elders.refetch()"
    /><template v-if="elder && !elders.error.value">
      <div class="page-title-row">
        <h1>{{ elder.name }}</h1>
        <el-button type="primary" @click="$router.push({ path: '/tasks', query: { create: '1', elder: elder.id } })">新建任务</el-button>
        <span
          class="status-label"
          :class="elder.status === '入住' ? 'status-success' : 'status-neutral'"
          ><span class="status-dot" aria-hidden="true" />{{
            elder.status
          }}</span
        >
      </div>
      <div class="elder-summary">
        <div class="elder-identification">
          <span class="person-avatar"
            ><ContactRound :size="28" aria-hidden="true"
          /></span>
          <div>
            <strong>{{ elder.bedLabel || '床位未提供' }}</strong
            ><span>{{ elder.id }}</span>
          </div>
        </div>
        <div class="elder-fact">
          <span>年龄</span
          ><strong>{{
            elder.age === undefined ? '未提供' : elder.age + '岁'
          }}</strong>
        </div>
        <div v-if="elder.risk" class="elder-fact">
          <span>风险</span
          ><strong
            :class="{
              'warning-text': elder.risk === '中',
              'danger-text': elder.risk === '高',
            }"
            >{{ elder.risk }}</strong
          >
        </div>
        <div v-if="elder.lastUpdate" class="elder-fact">
          <span>最近更新</span><strong>{{ elder.lastUpdate }}</strong>
        </div>
        <el-button
          @click="$router.push({ path: '/tasks', query: { elder: elder.id } })"
        >
          <ListChecks :size="17" aria-hidden="true" />查看全部任务
        </el-button>
      </div>
      <div class="data-section">
        <div class="profile-section">
          <div class="section-title">
            <h2>基本资料</h2>
            <span class="muted">{{ elder.id }}</span>
          </div>
          <dl class="details-grid">
            <div>
              <dt>姓名</dt>
              <dd>{{ elder.name }}</dd>
            </div>
            <div>
              <dt>床位</dt>
              <dd>{{ elder.bedLabel || '未提供' }}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{{ elder.status }}</dd>
            </div>
            <div v-if="elder.contact">
              <dt>联系人</dt>
              <dd>{{ elder.contact }}</dd>
            </div>
          </dl>
        </div>
        <div class="profile-section care-section">
          <div class="section-title">
            <h2>护理注意</h2>
            <ShieldCheck :size="18" aria-hidden="true" />
          </div>
          <p>{{ elder.notes || '未提供护理注意事项' }}</p>
        </div>
        <div class="section-title related-heading">
          <h2>关联任务</h2>
          <span
            v-if="!tasks.isPending.value && !tasks.error.value"
            class="muted"
            >{{ related.length }} 项</span
          >
        </div>
        <QueryFeedback
          :loading="tasks.isPending.value"
          :error="tasks.error.value"
          :empty="
            !tasks.isPending.value && !tasks.error.value && !related.length
          "
          @retry="tasks.refetch()"
        /><el-table
          v-if="!tasks.isPending.value && !tasks.error.value && related.length"
          :data="related"
        >
          <el-table-column
            prop="title"
            label="任务"
            min-width="200"
          /><el-table-column label="状态">
            <template #default="{ row }">
              <StatusLabel :status="row.status" />
            </template> </el-table-column
          ><el-table-column
            prop="dueAt"
            label="截止时间"
            min-width="160"
          /><el-table-column label="操作" width="128" fixed="right">
            <template #default="{ row }">
              <el-button
                link
                class="icon-button"
                title="处理此任务"
                aria-label="处理此任务"
                @click="
                  $router.push({
                    path: '/tasks',
                    query: { elder: elder.id, task: row.id },
                  })
                "
              >
                <ArrowUpRight :size="18" aria-hidden="true" /> </el-button
              ><el-button
                v-if="row.itemId"
                link
                class="icon-button"
                title="事项回放"
                aria-label="事项回放"
                @click="
                  $router.push('/timeline/' + encodeURIComponent(row.itemId))
                "
              >
                <History :size="18" aria-hidden="true" />
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
    <WorkflowPanel
      group="elders"
      title="老人资料修订"
      :context="{ elder_id: String(route.params.id) }"
    />
  </section>
</template>
