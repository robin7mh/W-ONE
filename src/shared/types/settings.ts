// App settings — persisted as JSON in the user data dir (architecture §11.1).
// Pure module (no DOM/Node/Electron) so it compiles under both tsconfigs.

export interface AppSettings {
  /**
   * Absolute path to the markdown vault root. Unset = default location
   * (~/W-ONE/vault — user-visible so the vault stays Obsidian-openable).
   */
  vaultRoot?: string
}
