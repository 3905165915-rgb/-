import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { adminElementPlus } from './build/admin-element-plus'

function appHistory(): Plugin {
  const middleware = (
    request: { url?: string; headers: { accept?: string } },
    _response: unknown,
    next: () => void,
  ) => {
    if (request.headers.accept?.includes('text/html')) {
      const pathname = request.url?.split('?')[0] ?? ''
      if (/^\/(admin|mobile)(\/[^.]*)?$/.test(pathname)) {
        request.url = `/${pathname.split('/')[1]}/index.html`
      }
    }
    next()
  }
  return {
    name: 'two-app-history',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [appHistory(), vue(), adminElementPlus()],
  resolve: { dedupe: ['vue'] },
  define: {
    'import.meta.env.VITE_APP_MODE': JSON.stringify('demo'),
    'import.meta.env.VITE_SAME_ORIGIN_DEMO': JSON.stringify('true'),
  },
  build: {
    outDir: 'dist-demo',
    rollupOptions: {
      input: {
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
        mobile: fileURLToPath(new URL('./mobile/index.html', import.meta.url)),
      },
    },
  },
})
