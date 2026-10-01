/// <reference types="vite/client" />

import type { WoneApi } from '../electron/preload'

declare global {
  interface Window {
    /**
     * The Electron bridge. Optional because the renderer also runs in a plain
     * browser (for headless visual verification) where it is undefined — always
     * access via optional chaining: `window.wone?.minimize()`.
     */
    wone?: WoneApi
  }
}

export {}
