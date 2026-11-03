import { defineConfig, mergeConfig } from 'vite'
import workflow from './vite.workflow.config'

// Both applications use the real loopback API and an isolated synthetic store.
export default mergeConfig(workflow, defineConfig({
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
  server: {
    host: '127.0.0.1', port: 5231, strictPort: true,
    proxy: { '/api/v1': { target: 'http://127.0.0.1:8769', changeOrigin: false } },
  },
}))
