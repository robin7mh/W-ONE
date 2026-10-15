import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @shared points at src/shared (types + IPC contract shared by main/preload/renderer).
const shared = { '@shared': resolve(__dirname, 'src/shared') }

// monaco-vim imports Monaco's files as `monaco-editor/esm/vs/…`; Monaco's exports map them to `./esm/vs/*.js`.
const monacoDeepImports = { find: /^monaco-editor\/esm\/vs\/(.*?)(\.js)?$/, replacement: `${resolve(__dirname, 'node_modules/monaco-editor/esm/vs')}/$1.js` }

// Release builds bake in where Mindeck Cloud lives (see electron/main/services/cloud/config.ts).
const cloud = {
  __MINDECK_CLOUD_URL__: JSON.stringify(process.env.MINDECK_CLOUD_URL ?? ''),
  __MINDECK_CLOUD_KEY__: JSON.stringify(process.env.MINDECK_CLOUD_KEY ?? '')
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
      // browserPage: the browser tabs' own preload (session.ts), apart from Mindeck's bridge.
      lib: { entry: { index: resolve(__dirname, 'electron/preload.ts'), browserPage: resolve(__dirname, 'electron/browserPage.ts') } }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      // Its "browser" build is a UMD bundle without named exports: the ESM one.
      alias: [monacoDeepImports, { find: /^monaco-vim$/, replacement: resolve(__dirname, 'node_modules/monaco-vim/dist/index.mjs') }, { find: '@', replacement: resolve(__dirname, 'src') }, { find: '@shared', replacement: shared['@shared'] }]
    },
    optimizeDeps: { exclude: ['monaco-vim'] },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    plugins: [react()]
  }
})
