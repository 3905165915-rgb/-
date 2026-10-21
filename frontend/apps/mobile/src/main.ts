import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import {
  Button,
  Cell,
  CellGroup,
  NavBar,
  Empty,
  Form,
  Field,
  Tabbar,
  TabbarItem,
  Tag,
  NoticeBar,
  Divider,
  Steps,
  Step,
  Loading,
  Tabs,
  Tab,
  Checkbox,
  CheckboxGroup,
  Popup,
  Search,
  Switch,
} from 'vant'
import 'vant/lib/index.css'
import '@hulao/shared/theme.css'
import { applyUiPreferences } from '@hulao/shared'
import App from './App.vue'
import router from './router'
import { queryClient } from './services/data'
import './styles/main.css'
applyUiPreferences()
const app = createApp(App)
  .use(createPinia())
  .use(VueQueryPlugin, { queryClient })
  .use(router)
for (const component of [
  Button,
  Cell,
  CellGroup,
  NavBar,
  Empty,
  Form,
  Field,
  Tabbar,
  TabbarItem,
  Tag,
  NoticeBar,
  Divider,
  Steps,
  Step,
  Loading,
  Tabs,
  Tab,
  Checkbox,
  CheckboxGroup,
  Popup,
  Search,
  Switch,
])
  app.use(component)
app.mount('#app')
