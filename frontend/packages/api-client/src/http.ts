import axios from 'axios'

export function createApiClient(baseURL = '/api') {
  const client = axios.create({ baseURL, timeout: 15000 })

  client.interceptors.request.use((config) => {
    const rawSession = localStorage.getItem('hulao:session')
    if (rawSession) {
      const session = JSON.parse(rawSession) as { access_token?: string }
      if (session.access_token) config.headers.Authorization = `Bearer ${session.access_token}`
    }
    return config
  })

  return client
}
