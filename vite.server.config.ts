import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'
import pkg from './package.json'

// The standalone W-ONE core (server/main.ts) as one CommonJS file:
// out/server/index.cjs. npm dependencies stay external (node_modules at
// runtime — native modules like node-pty cannot be bundled).
// ESM-only packages are bundled instead: a CommonJS file can't require() them.
const BUNDLED = ['@agentclientprotocol/sdk']
const external = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  ...Object.keys(pkg.dependencies).filter((d) => !BUNDLED.includes(d))
]

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  define: {
    __WONE_VERSION__: JSON.stringify(pkg.version),
    // Where W-ONE Cloud lives (see electron/main/services/cloud/config.ts).
    __WONE_CLOUD_URL__: JSON.stringify(process.env.WONE_CLOUD_URL ?? ''),
    __WONE_CLOUD_KEY__: JSON.stringify(process.env.WONE_CLOUD_KEY ?? '')
  },
  build: {
    outDir: 'out/server',
    emptyOutDir: true,
    target: 'node22',
    ssr: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, 'server/main.ts'),
      external: (id) => external.some((e) => id === e || id.startsWith(`${e}/`)),
      output: { format: 'cjs', entryFileNames: 'index.cjs' }
    }
  }
})
