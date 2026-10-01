import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'

/** Every local data location, derived in exactly one place (architecture §11.1). */
export interface WonePaths {
  /** ~/W-ONE — the one user-visible home of everything W-ONE keeps. */
  homeDir: string
  /** ~/W-ONE/data — registry, settings, DB, caches. */
  dataDir: string
  /** SQLite database (structured data + rebuildable indexes). */
  dbFile: string
  /** Pre-migration DB backups. */
  backupsDir: string
  /** Typed app settings (JSON, atomic writes). */
  settingsFile: string
  /** Default markdown vault root — user-visible so it stays Obsidian-openable. */
  defaultVaultRoot: string
  /** Where data lived before 2026-10-02 (hidden, named after the dev package). */
  legacyDataDir: string
}

/**
 * Everything lives under ~/W-ONE: findable in Finder, the same for `npm run
 * dev` and the packaged app, and backed up by copying one folder. WONE_HOME
 * overrides the root (tests, or a custom location).
 */
export function wonePaths(): WonePaths {
  const homeDir = process.env.WONE_HOME || join(homedir(), 'W-ONE')
  const dataDir = join(homeDir, 'data')
  return {
    homeDir,
    dataDir,
    dbFile: join(dataDir, 'wone.db'),
    backupsDir: join(dataDir, 'backups'),
    settingsFile: join(dataDir, 'settings.json'),
    defaultVaultRoot: join(homeDir, 'vault'),
    legacyDataDir: join(app.getPath('userData'), 'wone')
  }
}

/**
 * One-time copy of the old hidden data folder into ~/W-ONE/data. Copy, not
 * move: the original stays untouched as a backup (with a note pointing to the
 * new place). Runs before the DB is opened, so the SQLite files are at rest.
 */
export function migrateLegacyData(paths: WonePaths): boolean {
  if (existsSync(paths.dataDir) || !existsSync(paths.legacyDataDir)) return false
  mkdirSync(paths.homeDir, { recursive: true })
  cpSync(paths.legacyDataDir, paths.dataDir, { recursive: true, errorOnExist: true })
  writeFileSync(
    join(paths.legacyDataDir, 'MOVED-TO-W-ONE-DATA.txt'),
    `W-ONE now keeps its data in ${paths.dataDir}.\nThis folder is an untouched backup from before the move.\n`
  )
  return true
}
