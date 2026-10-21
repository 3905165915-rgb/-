import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
// Keep global overrides after the few component styles they override.
import 'element-plus/es/components/button/style/css.mjs'
import 'element-plus/es/components/main/style/css.mjs'
import 'element-plus/es/components/radio-group/style/css.mjs'
import 'element-plus/es/components/result/style/css.mjs'
import '@hulao/shared/theme.css'
import { applyUiPreferences } from '@hulao/shared'
import App from './App.vue'
import router from './router'
import { queryClient } from './services/data'
import './styles/main.css'
applyUiPreferences()
createApp(App)
  .use(createPinia())
  .use(VueQueryPlugin, { queryClient })
  .use(router)
  .mount('#app')
