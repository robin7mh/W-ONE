import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'

/** Every local data location, derived in exactly one place (architecture §11.1). */
export interface WonePaths {
  /** <userData>/wone — registry, settings, DB, caches. */
  dataDir: string
  /** SQLite database (structured data + rebuildable indexes). */
  dbFile: string
  /** Pre-migration DB backups. */
  backupsDir: string
  /** Typed app settings (JSON, atomic writes). */
  settingsFile: string
  /** Default markdown vault root — user-visible so it stays Obsidian-openable. */
  defaultVaultRoot: string
}

export function wonePaths(): WonePaths {
  const dataDir = join(app.getPath('userData'), 'wone')
  return {
    dataDir,
    dbFile: join(dataDir, 'wone.db'),
    backupsDir: join(dataDir, 'backups'),
    settingsFile: join(dataDir, 'settings.json'),
    defaultVaultRoot: join(homedir(), 'W-ONE', 'vault')
  }
}
