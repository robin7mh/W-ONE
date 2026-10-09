import type { UpdateStatus } from '@shared/types/server'

/** The part of electron-updater's autoUpdater this service uses (tests pass a fake). */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each event has its own payload (as in EventEmitter)
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 4 * 3_600_000

/**
 * Keeps the packaged desktop app current (GitHub Releases, see
 * electron-builder.yml → publish). Downloads in the background; the user
 * restarts when it suits them, or the update applies on the next quit.
 * Without an updater (dev runs) it reports `disabled` and does nothing.
 */
export class UpdateService {
  private current: UpdateStatus
  private firstCheck?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>

  constructor(
    private readonly opts: {
      updater: Updater | null
      currentVersion: string
      onStatus: (status: UpdateStatus) => void
    }
  ) {
    this.current = { state: opts.updater ? 'idle' : 'disabled', currentVersion: opts.currentVersion }
  }

  start(): void {
    const u = this.opts.updater
    if (!u) return
    u.autoDownload = true
    u.autoInstallOnAppQuit = true
    u.on('checking-for-update', () => this.set({ state: 'checking' }))
    u.on('update-not-available', () => this.set({ state: 'idle' }))
    u.on('update-available', (info: { version: string }) => this.set({ state: 'downloading', version: info.version, progress: 0 }))
    u.on('download-progress', (p: { percent: number }) => this.set({ ...this.current, state: 'downloading', progress: Math.round(p.percent) }))
    u.on('update-downloaded', (info: { version: string }) => this.set({ state: 'ready', version: info.version }))
    u.on('error', (err: Error) => this.set({ state: 'error', error: err.message }))
    this.firstCheck = setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.interval = setInterval(() => void this.check(), CHECK_EVERY_MS)
    this.firstCheck.unref()
    this.interval.unref()
  }

  status(): UpdateStatus {
    return this.current
  }

  async check(): Promise<UpdateStatus> {
    const u = this.opts.updater
    // Never interrupt a download, never re-check what is already waiting.
    if (!u || this.current.state === 'downloading' || this.current.state === 'ready') return this.current
    try {
      await u.checkForUpdates()
    } catch (err) {
      this.set({ state: 'error', error: (err as Error).message })
    }
    return this.current
  }

  /** Restart into the downloaded version. */
  install(): void {
    if (this.current.state !== 'ready') {
      throw Object.assign(new Error('No update is ready to install'), { code: 'no-update' })
    }
    this.opts.updater!.quitAndInstall(false, true)
  }

  dispose(): void {
    clearTimeout(this.firstCheck)
    clearInterval(this.interval)
  }

  private set(next: Omit<UpdateStatus, 'currentVersion'>): void {
    this.current = { ...next, currentVersion: this.opts.currentVersion }
    this.opts.onStatus(this.current)
  }
}
