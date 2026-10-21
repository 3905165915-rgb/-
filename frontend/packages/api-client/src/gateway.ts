import { createDemoApi, type AppMode } from '@hulao/shared'
import { createApi } from './index'
export function createGateway(
  mode: AppMode,
  baseURL?: string,
): Omit<ReturnType<typeof createApi>, 'client'> {
  if (mode === 'demo') return createDemoApi()
  const api = createApi(baseURL)
  return {
    login: api.login,
    elders: api.elders,
    extractRecord: api.extractRecord,
    confirmRecord: api.confirmRecord,
    tasks: api.tasks,
    completeTask: api.completeTask,
    handover: api.handover,
    receiveHandover: api.receiveHandover,
    timeline: api.timeline,
    familyCases: api.familyCases,
  }
}
