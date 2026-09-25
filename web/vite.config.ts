import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // SSE streams (sequential turns run one LLM call per character) are
        // slow; don't let the dev proxy drop them.
        timeout: 0,
        proxyTimeout: 0,
      },
      '/media': 'http://localhost:3000',
    },
  },
})