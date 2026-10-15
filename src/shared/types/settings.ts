// App settings — persisted as JSON in the user data dir (architecture §11.1).
// Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

import type { GraphStyle } from './memory'
import type { ServerConfig } from './server'
import type { AiSettings } from './ai'
import type { EditorSettings } from './migrate'
import type { BrowserSettings } from './browser'
import type { CloseBehavior } from './desktop'

export interface AppSettings {
  /**
   * Absolute path to the markdown vault root. Unset = default location
   * (~/Mindeck/vault — user-visible so the vault stays Obsidian-openable).
   */
  vaultRoot?: string
  /** Memory graph coloring (colorful by folder, or one accent). */
  graphStyle?: GraphStyle
  /** Desktop: the embedded network API (web UI / mobile app access). */
  server?: ServerConfig
  /** Assistant model + effort (the API key lives in the secret store). */
  ai?: AiSettings
  /** Editor preferences and keybindings (taken over from VS Code / Cursor, or set here). */
  editor?: EditorSettings
  /** The Mindeck browser: search engine, where links from Mindeck open. */
  browser?: Partial<BrowserSettings>
  /** Desktop (Windows/Linux): closing the window while agents or terminals run. Unset = ask. */
  closeBehavior?: CloseBehavior
  /** Settings Sync: the account copy's version this core last saved or loaded. */
  sync?: { version: number; syncedAt: string }
}
