import { readFile } from 'node:fs/promises'
import type { AppSettings } from '@shared/types/settings'
import type { Snippet } from '@shared/types/migrate'
import type { SyncData, SyncStatus, SyncUi } from '@shared/types/sync'
import { writeAtomic } from '../../lib/writeAtomic'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** The cloud's copy, as GET / PUT /v1/me/sync answer. */
interface Remote {
  version: number
  data: Partial<SyncData>
  updatedAt: string
  device: { id: string; name: string | null } | null
}

export interface SyncOptions {
  cloud: { isSignedIn(): boolean; api<T>(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: object): Promise<T> }
  settings: { get(): AppSettings; update(patch: Partial<AppSettings>): Promise<AppSettings> }
  /** The editor's snippets (imported from VS Code / Cursor). */
  snippetsFile: string
  now?: () => Date
}

/**
 * Settings Sync through the Mindeck account: the editor's settings (languages
 * and keybindings included), the snippets, the look and the UI language go
 * up as one versioned copy; another Mindeck loads it. Saving over a copy that
 * changed elsewhere is a conflict (`sync_conflict`) unless forced.
 */
export class SyncService {
  constructor(private readonly opts: SyncOptions) {}

  async status(): Promise<SyncStatus> {
    const local = this.opts.settings.get().sync ?? null
    if (!this.opts.cloud.isSignedIn()) return { signedIn: false, remote: null, local }
    const remote = await this.remote()
    return { signedIn: true, remote: remote && { version: remote.version, updatedAt: remote.updatedAt, device: remote.device?.name ?? null }, local }
  }

  /** Save this Mindeck's settings (plus what the UI knows) to the account. */
  async push(ui: SyncUi, force = false): Promise<SyncStatus> {
    this.signedIn()
    const settings = this.opts.settings.get()
    const data: SyncData = { schema: 1, editor: settings.editor, snippets: await this.snippets(), appearance: ui.appearance, locale: ui.locale }
    const baseVersion = force ? ((await this.remote())?.version ?? 0) : (settings.sync?.version ?? 0)
    const { sync } = await this.opts.cloud.api<{ sync: Remote }>('PUT', '/v1/me/sync', { data, baseVersion })
    await this.remember(sync.version)
    return this.status()
  }

  /** Take the account's settings over; returns what the UI applies itself. */
  async pull(): Promise<SyncUi> {
    this.signedIn()
    const remote = await this.remote()
    if (!remote) throw coded('sync-empty', 'Nothing is saved in your account yet')
    const { editor, snippets, appearance, locale } = remote.data
    if (editor) await this.opts.settings.update({ editor })
    if (snippets) await writeAtomic(this.opts.snippetsFile, JSON.stringify(snippets))
    await this.remember(remote.version)
    return { appearance, locale }
  }

  // --- helpers ---

  private signedIn(): void {
    if (!this.opts.cloud.isSignedIn()) throw coded('session_expired', 'Sign in to your Mindeck account first')
  }

  private async remote(): Promise<Remote | null> {
    return (await this.opts.cloud.api<{ sync: Remote | null }>('GET', '/v1/me/sync')).sync
  }

  private async snippets(): Promise<Snippet[]> {
    try {
      const list = JSON.parse(await readFile(this.opts.snippetsFile, 'utf8')) as unknown
      return Array.isArray(list) ? (list as Snippet[]) : []
    } catch {
      return []
    }
  }

  private async remember(version: number): Promise<void> {
    await this.opts.settings.update({ sync: { version, syncedAt: (this.opts.now?.() ?? new Date()).toISOString() } })
  }
}
