import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
}

/**
 * Injects the Content-Security-Policy meta tag.
 * Dev needs inline scripts (React Refresh preamble) and a websocket for HMR;
 * production is strict.
 */
function contentSecurityPolicy(): Plugin {
  let isDev = false
  return {
    name: 'hachi:csp',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml() {
      const policy = [
        "default-src 'self'",
        isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join('; ')
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preload scripts must be CommonJS and fully bundled.
      externalizeDeps: false,
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()]
  }
})
