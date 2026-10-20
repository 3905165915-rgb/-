<script setup lang="ts">
import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { resetDemo } from '@hulao/shared'
import { mode, queryClient, errorMessage } from '../../services/data'
const busy = ref(false)
const error = ref('')
const done = ref(false)
const sameOrigin = import.meta.env.VITE_SAME_ORIGIN_DEMO === 'true'
async function reset() {
  if (mode !== 'demo' || busy.value) return
  try {
    await ElMessageBox.confirm(
      '将清除本浏览器中的演示操作与本机演示草稿，恢复虚构案例。',
      '重置演示',
      { type: 'warning' },
    )
  } catch {
    return
  }
  busy.value = true
  done.value = false
  error.value = ''
  try {
    await resetDemo()
    await queryClient.invalidateQueries({ queryKey: ['demo'] })
    done.value = true
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section>
    <h1>演示数据管理</h1>
    <div class="demo-content">
      <el-empty
        v-if="mode !== 'demo'"
        description="当前不是演示模式"
      /><template v-else>
        <p>全部案例均为虚构数据。</p>
        <p v-if="sameOrigin">
          <a
            href="/mobile/login"
            target="_blank"
            rel="noopener noreferrer"
          >打开移动端</a>
          ·
          <a
            href="/admin/login"
            target="_blank"
            rel="noopener noreferrer"
          >打开独立管理端</a>
        </p>
        <el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
        /><el-alert
          v-if="done"
          title="演示数据已重置并重新载入"
          type="success"
          :closable="false"
        /><el-button
          type="danger"
          :loading="busy"
          @click="reset"
        >
          重置虚构案例
        </el-button>
      </template>
    </div>
  </section>
</template>
