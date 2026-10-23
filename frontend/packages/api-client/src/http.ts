import axios from 'axios'
import { clearSession, readSession } from '@hulao/shared'

export function createApiClient(baseURL = '/api/v1') {
  const client = axios.create({ baseURL, timeout: 15000 })

  client.interceptors.request.use((config) => {
    const session = readSession()
    if (session?.mode === 'demo') throw new Error('演示身份不能访问真实接口')
    if (session?.accessToken)
      config.headers.Authorization = `Bearer ${session.accessToken}`
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        clearSession()
        if (typeof window !== 'undefined')
          window.dispatchEvent(new Event('hulao:unauthorized'))
      }
      return Promise.reject(error)
    },
  )

  return client
}
