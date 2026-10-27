import { mergeConfig } from 'vite'
import demo from '../vite.demo.config'

// Isolated API-mode harness: Playwright intercepts every /api/v1 request.
export default mergeConfig(demo, {
  server: {
    proxy: { '/api/v1': { target: 'http://127.0.0.1:8769', changeOrigin: true } },
  },
  define: {
    'import.meta.env.VITE_APP_MODE': JSON.stringify('api'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1'),
  },
})
