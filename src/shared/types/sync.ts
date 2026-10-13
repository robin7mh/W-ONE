// Settings Sync through the Mindeck account: one copy in Mindeck Cloud that every
// signed-in Mindeck (and later the website's account page) reads and writes.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

import type { EditorSettings, Snippet } from './migrate'

/** What only the UI knows (it lives per device in the browser storage). */
export interface SyncUi {
  /** The appearance (mode, accent, surface) as the theme store keeps it. */
  appearance?: unknown
  locale?: 'de' | 'en'
}

/** The synced document: editor settings (languages, keybindings included), snippets, look and language. */
export interface SyncData extends SyncUi {
  schema: 1
  editor?: EditorSettings
  snippets?: Snippet[]
}

export interface SyncStatus {
  signedIn: boolean
  /** The account's copy (none synced yet: null). */
  remote: { version: number; updatedAt: string; device: string | null } | null
  /** What this core last saved or loaded. */
  local: { version: number; syncedAt: string } | null
}
