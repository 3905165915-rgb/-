import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Button, Cell, CellGroup, NavBar, Empty, Form, Field, Tabbar, TabbarItem, Tag, NoticeBar, Divider, Steps, Step, showToast } from 'vant'
import 'vant/lib/index.css'
import App from './App.vue'
import router from './router'
import './styles/main.css'

createApp(App)
  .use(createPinia())
  .use(router)
  .use(Button)
  .use(Cell)
  .use(CellGroup)
  .use(NavBar)
  .use(Empty)
  .use(Form)
  .use(Field)
  .use(Tabbar)
  .use(TabbarItem)
  .use(Tag)
  .use(NoticeBar)
  .use(Divider)
  .use(Steps)
  .use(Step)
  .provide('showToast', showToast)
  .mount('#app')
