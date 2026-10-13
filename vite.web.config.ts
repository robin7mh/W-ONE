import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The renderer as a web app (no Electron): built into out/web and served by
// the W-ONE core (`npm run web`). In dev (`npm run web:dev`) Vite proxies the
// API to a core running on :7420 (`npm run server:build && npm run server`).
export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: [
      // monaco-vim's deep imports into Monaco (see electron.vite.config.ts).
      { find: /^monaco-editor\/esm\/vs\/(.*?)(\.js)?$/, replacement: `${resolve(__dirname, 'node_modules/monaco-editor/esm/vs')}/$1.js` },
      { find: /^monaco-vim$/, replacement: resolve(__dirname, 'node_modules/monaco-vim/dist/index.mjs') },
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') }
    ]
  },
  optimizeDeps: { exclude: ['monaco-vim'] },
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:7420', ws: true }
    }
  },
  build: {
    outDir: 'out/web'
  }
})
