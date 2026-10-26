import { createDemoApi, type AppMode } from '@hulao/shared'
import { createApi } from './index'
export function createGateway(
  mode: AppMode,
  baseURL?: string,
): Omit<ReturnType<typeof createApi>, 'client'> {
  if (mode === 'demo')
    return {
      ...createDemoApi(),
      demoLogin: async () => {
        throw new Error('当前演示数据未启用服务端角色登录')
      },
      manualRecord: async () => {
        throw new Error('演示模式请使用本地演示记录')
      },
    }
  const api = createApi(baseURL)
  return {
    login: api.login,
    demoLogin: api.demoLogin,
    elders: api.elders,
    extractRecord: api.extractRecord,
    confirmRecord: api.confirmRecord,
    manualRecord: api.manualRecord,
    tasks: api.tasks,
    completeTask: api.completeTask,
    handover: api.handover,
    receiveHandover: api.receiveHandover,
    timeline: api.timeline,
    familyCases: api.familyCases,
  }
}
