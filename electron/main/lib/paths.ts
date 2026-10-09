import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Every local data location, derived in exactly one place (architecture §11.1). */
export interface WonePaths {
  /** ~/W-ONE — the one user-visible home of everything W-ONE keeps. */
  homeDir: string
  /** ~/W-ONE/data — project registry, settings, caches (the database runs in Docker). */
  dataDir: string
  /** Typed app settings (JSON, atomic writes). */
  settingsFile: string
  /** Default markdown vault root — user-visible so it stays Obsidian-openable. */
  defaultVaultRoot: string
  /** Paired remote devices (token hashes, never tokens) and pending pairing codes. */
  devicesFile: string
  /** Secrets such as the LLM API key — encrypted on desktop, 0600 on a server. */
  secretsFile: string
  /** Persisted "Always allow" permission grants for agent tools. */
  grantsFile: string
  /** Agent cockpit sessions (Claude Code & co.): list + one transcript file each. */
  agentsDir: string
  /** Isolated git worktrees for agents working in parallel — visible, so nothing hides. */
  worktreesDir: string
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
    settingsFile: join(dataDir, 'settings.json'),
    defaultVaultRoot: join(homeDir, 'vault'),
    devicesFile: join(dataDir, 'devices.json'),
    secretsFile: join(dataDir, 'secrets.json'),
    grantsFile: join(dataDir, 'grants.json'),
    agentsDir: join(dataDir, 'agents'),
    worktreesDir: join(homeDir, 'worktrees')
  }
}

/**
 * One-time copy of the old hidden data folder (Electron's userData, before
 * 2026-10-02 — only the desktop app ever had one) into ~/W-ONE/data. Copy, not
 * move: the original stays untouched as a backup (with a note pointing to the
 * new place). Runs before the DB is opened, so the SQLite files are at rest.
 */
export function migrateLegacyData(paths: WonePaths, legacyDataDir: string): boolean {
  if (existsSync(paths.dataDir) || !existsSync(legacyDataDir)) return false
  mkdirSync(paths.homeDir, { recursive: true })
  cpSync(legacyDataDir, paths.dataDir, { recursive: true, errorOnExist: true })
  writeFileSync(
    join(legacyDataDir, 'MOVED-TO-W-ONE-DATA.txt'),
    `W-ONE now keeps its data in ${paths.dataDir}.\nThis folder is an untouched backup from before the move.\n`
  )
  return true
}
