import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @shared points at src/shared (types + IPC contract shared by main/preload/renderer).
const shared = { '@shared': resolve(__dirname, 'src/shared') }

// Release builds bake in where W-ONE Cloud lives (see electron/main/services/cloud/config.ts).
const cloud = {
  __WONE_CLOUD_URL__: JSON.stringify(process.env.WONE_CLOUD_URL ?? ''),
  __WONE_CLOUD_KEY__: JSON.stringify(process.env.WONE_CLOUD_KEY ?? '')
}

export default defineConfig({
  main: {
    // Keep npm dependencies (e.g. systeminformation) external — required from
    // node_modules at runtime instead of bundled (they use dynamic requires).
    // ESM-only packages are bundled: the CommonJS main bundle can't require() them.
    plugins: [externalizeDepsPlugin({ exclude: ['@agentclientprotocol/sdk'] })],
    resolve: { alias: shared },
    define: cloud,
    build: {
      outDir: 'out/main',
      // object entry => deterministic `index` output name (matches package.json "main")
      lib: { entry: { index: resolve(__dirname, 'electron/main.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
