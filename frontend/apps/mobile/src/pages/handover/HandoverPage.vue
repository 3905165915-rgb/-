<script setup lang="ts">
const serverWorkflow = ['api'].includes(import.meta.env.VITE_APP_MODE || 'api')
import WorkflowPanel from '@hulao/shared/workflow'
import { compactReference } from '@hulao/shared'
import { ref, watch } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useTasks, useHandover, mode, session } from '../../services/data'
import HandoverEditor from '../../components/HandoverEditor.vue'
import HandoverReceiveList from '../../components/HandoverReceiveList.vue'
import FeedbackState from '../../components/FeedbackState.vue'
import HandoverQuick from '../../components/HandoverQuick.vue'
import { isFollowupTask, readSession } from '@hulao/shared'
const route = useRoute()
const router = useRouter()
const shift = ref(
  typeof route.query.shift === 'string'
    ? route.query.shift
    : mode === 'demo'
      ? '晚班'
      : '',
)
const inputShift = ref(shift.value)
const tab = ref('send')
const tasks = useTasks()
const handover = useHandover(() => shift.value)
const editorRef = ref<InstanceType<typeof HandoverEditor>>()
async function flush() {
  if (editorRef.value?.busy) return false
  if (!editorRef.value?.dirty) return true
  return await editorRef.value.persist()
}
async function selectShift() {
  if (!inputShift.value.trim()) return
  await router.push({
    query: { ...route.query, shift: inputShift.value.trim(), draft: undefined },
  })
}
function chooseShift(name: string) {
  inputShift.value = name
  void selectShift()
}
watch(
  () => route.query.shift,
  (value) => {
    shift.value =
      typeof value === 'string' ? value : mode === 'demo' ? '晚班' : ''
    inputShift.value = shift.value
  },
)
async function leave() {
  if (!session.value) return true
  if (editorRef.value?.busy) return false
  if (await flush()) return true
  try {
    await showConfirmDialog({
      title: '本机交班未保存',
      message: '保存未完成，仍然离开？',
    })
    return true
  } catch {
    return false
  }
}
onBeforeRouteLeave(() => (mode === 'api' ? true : leave()))
onBeforeRouteUpdate(() => (mode === 'api' ? true : leave()))
</script>
<template>
  <HandoverQuick v-if="serverWorkflow && readSession()?.role === 'caregiver'" />
  <WorkflowPanel
    v-else-if="serverWorkflow"
    group="handovers"
    title="交接班"
    :context="route.query"
    :initial-action="
      typeof route.query.handover_id === 'string'
        ? '/handovers/{handover_id}'
        : '/handovers'
    "
    :auto-read="typeof route.query.handover_id === 'string'"
  />
  <section v-else class="handover-page editor-page">
    <h1>交接班</h1>
    <van-field
      v-model="inputShift"
      label="交接班次"
      placeholder="请选择或输入班次"
    >
      <template #button>
        <van-button
          size="small"
          :disabled="!inputShift.trim()"
          @click="selectShift"
        >
          载入
        </van-button>
      </template>
    </van-field>
    <div v-if="mode === 'demo'" class="action-row">
      <van-button
        v-for="name in [
          ...new Set(
            tasks.data.value
              ?.filter(isFollowupTask)
              .map((task) => task.shift)
              .filter(Boolean),
          ),
        ]"
        :key="name"
        size="small"
        @click="chooseShift(name)"
      >
        {{ name }}
      </van-button>
    </div>
    <FeedbackState
      :loading="tasks.isPending.value"
      :error="tasks.error.value"
      @retry="tasks.refetch()"
    /><van-empty v-if="!shift" description="请选择或输入交接班次" />
    <template v-else>
      <p class="muted">
        交接班次：{{ mode === 'demo' ? shift : compactReference(shift) }}
      </p>
      <van-tabs v-model:active="tab" :lazy-render="false">
        <van-tab title="交班" name="send">
          <HandoverEditor
            ref="editorRef"
            :shift-id="shift"
            :tasks="
              tasks.error.value
                ? []
                : (tasks.data.value ?? []).filter(isFollowupTask)
            "
            :source-writable="!tasks.isPending.value && !tasks.error.value"
          /> </van-tab
        ><van-tab title="接班" name="receive">
          <div class="action-row">
            <van-button size="small" icon="replay" @click="handover.refetch()">
              刷新接班事项
            </van-button>
          </div>
          <FeedbackState
            :loading="handover.isPending.value"
            :error="handover.error.value"
            @retry="handover.refetch()"
          /><HandoverReceiveList
            v-if="!handover.isPending.value && !handover.error.value"
            :items="handover.data.value ?? []"
            :writable="!handover.error.value"
            @reload="handover.refetch()"
          />
        </van-tab>
      </van-tabs>
    </template>
  </section>
</template>
