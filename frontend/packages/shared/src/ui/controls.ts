import type { App } from 'vue'
import CareSelect from './CareSelect.vue'
import CareDateTime from './CareDateTime.vue'
import './controls.css'
export function installCareControls(app: App) {
  app.component('CareSelect', CareSelect)
  app.component('CareDateTime', CareDateTime)
}
declare module 'vue' {
  export interface GlobalComponents {
    CareSelect: typeof CareSelect
    CareDateTime: typeof CareDateTime
  }
}
