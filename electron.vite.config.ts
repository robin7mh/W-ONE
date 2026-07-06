import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      // object entry => deterministic `index` output name (matches package.json "main")
      lib: { entry: { index: resolve(__dirname, 'electron/main.ts') } }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: { index: resolve(__dirname, 'electron/preload.ts') } }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
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
