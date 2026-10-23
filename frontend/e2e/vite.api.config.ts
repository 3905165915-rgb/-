import { mergeConfig } from 'vite'
import demo from '../vite.demo.config'

// Isolated API-mode harness: Playwright intercepts every /api/v1 request.
export default mergeConfig(demo, {
  define: {
    'import.meta.env.VITE_APP_MODE': JSON.stringify('api'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1'),
  },
})
