import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @shared points at src/shared (types + IPC contract shared by main/preload/renderer).
const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/main',
      // object entry => deterministic `index` output name (matches package.json "main")
      lib: { entry: { index: resolve(__dirname, 'electron/main.ts') } }
    }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/preload',
      lib: { entry: { index: resolve(__dirname, 'electron/preload.ts') } }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: { '@': resolve(__dirname, 'src'), ...shared }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    plugins: [react()]
  }
})
