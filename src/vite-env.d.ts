/// <reference types="vite/client" />

import type { MindeckApi } from '../electron/preload'

declare global {
  interface Window {
    /**
     * The Electron bridge. Optional because the renderer also runs in a plain
     * browser (for headless visual verification) where it is undefined — always
     * access via optional chaining: `window.mindeck?.minimize()`.
     */
    mindeck?: MindeckApi
  }
}

export {}
