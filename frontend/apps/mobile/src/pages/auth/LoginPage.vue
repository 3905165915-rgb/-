<script setup lang="ts">
import { ref } from 'vue'
import {
  Activity,
  ArrowRight,
  HeartHandshake,
  HandHeart,
  ShieldCheck,
  UsersRound,
} from 'lucide-vue-next'
import type { Role } from '@hulao/shared'
import careFieldImage from '../../assets/care-field.jpg'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { homeForRole } from '../../router/access'
import { mode, errorMessage } from '../../services/data'

const router = useRouter()
const auth = useAuthStore()
const error = ref('')
const submitting = ref(false)
const passwordOpen = ref(false)
const form = ref({ username: '', password: '' })
const image = careFieldImage
const roleCards: {
  role: Role
  title: string
  caption: string
  icon: typeof HandHeart
}[] = [
  {
    role: 'caregiver',
    title: '护理员',
    caption: '查看当班工作与老人照护',
    icon: HandHeart,
  },
  {
    role: 'supervisor',
    title: '护士 / 主管',
    caption: '审核照护事项并跟进交接',
    icon: HeartHandshake,
  },
  {
    role: 'admin',
    title: '管理员',
    caption: '查看机构运营与服务质量',
    icon: ShieldCheck,
  },
  {
    role: 'family',
    title: '家属',
    caption: '查看已授权的照护动态',
    icon: UsersRound,
  },
]

async function openRole(role: Role) {
  if (submitting.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.demoRoleLogin(role)
    if (role === 'admin') {
      window.location.replace('/')
      return
    }
    await router.replace(homeForRole(auth.role))
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    submitting.value = false
  }
}

async function submit() {
  if (submitting.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.login(form.value.username, form.value.password)
    await router.replace(homeForRole(auth.role))
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="role-login mobile-role-login">
    <header class="login-topbar">
      <a class="login-wordmark" href="/" aria-label="护老智交首页">
        <span class="login-mark"
          ><Activity :size="20" aria-hidden="true"
        /></span>
        <span>护老智交<small>个性化照护协同</small></span>
      </a>
      <a class="login-mobile-link" href="/login?view=admin"
        >管理端<ArrowRight :size="15" aria-hidden="true"
      /></a>
    </header>
    <section class="login-content" aria-labelledby="login-title">
      <div class="login-intro">
        <span class="login-eyebrow">护老智交 · 移动护理</span>
        <h1 id="login-title">让每一次照护，都接得上。</h1>
        <p>从老人的日常习惯到每班照护安排。</p>
        <figure class="login-photo">
          <img
            :src="image"
            alt="两位长者在林间相依而坐，微笑望向前方"
            width="1920"
            height="1272"
            fetchpriority="high"
          />
        </figure>
      </div>
      <section class="role-panel hl-glass" aria-label="选择工作入口">
        <header class="role-panel-heading">
          <div>
            <span class="panel-kicker">工作入口</span>
            <h2>请选择你的身份</h2>
          </div>
          <span class="demo-pill">演示体验</span>
        </header>
        <p v-if="mode === 'demo'" class="muted">
          虚构王爷爷样本，仅保存在本机；北京时间每日更新时归档旧演示草稿，不修改服务器数据。
        </p>
        <div class="role-list">
          <button
            v-for="item in roleCards"
            :key="item.role"
            class="role-choice"
            type="button"
            :disabled="submitting"
            @click="openRole(item.role)"
          >
            <span class="role-icon"
              ><component :is="item.icon" :size="21" aria-hidden="true"
            /></span>
            <span class="role-copy"
              ><strong>{{ item.title }}</strong
              ><small>{{ item.caption }}</small></span
            >
            <ArrowRight class="role-arrow" :size="18" aria-hidden="true" />
          </button>
        </div>
        <p v-if="error" class="error-text" role="alert">
          {{ error }}
        </p>
        <details class="credential-login" :open="passwordOpen">
          <summary>使用账号密码登录</summary>
          <van-form @submit="submit">
            <van-cell-group inset>
              <van-field
                v-model="form.username"
                label="账号"
                autocomplete="username"
                placeholder="请输入账号"
                required
                :disabled="submitting"
              />
              <van-field
                v-model="form.password"
                label="密码"
                type="password"
                autocomplete="current-password"
                placeholder="请输入密码"
                required
                :disabled="submitting"
              />
            </van-cell-group>
            <van-button
              block
              type="primary"
              native-type="submit"
              :loading="submitting"
              :disabled="!form.username.trim() || !form.password"
            >
              登录
            </van-button>
          </van-form>
        </details>
      </section>
    </section>
    <footer class="login-footer">
      <span>照护有依据 · 交接有回应</span><span>以人为本 · 协同照护</span>
    </footer>
  </main>
</template>
