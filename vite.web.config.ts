import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone renderer config: runs the UI in a plain browser (no Electron).
// Used for headless visual verification (Playwright screenshots). All
// `window.wone.*` bridge calls in the app are guarded, so controls just no-op here.
export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  build: {
    outDir: 'out/web'
  }
})
