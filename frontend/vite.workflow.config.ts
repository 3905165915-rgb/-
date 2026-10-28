import { defineConfig, mergeConfig } from 'vite'
import twoAppConfig from './vite.demo.config'

// Isolated browser-contract tests intercept every API call with synthetic data.
export default mergeConfig(
  twoAppConfig,
  defineConfig({
    define: { 'import.meta.env.VITE_APP_MODE': JSON.stringify('api') },
    server: { host: '127.0.0.1', port: 5217, strictPort: true },
  }),
)
