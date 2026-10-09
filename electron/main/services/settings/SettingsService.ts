import { readFile } from 'node:fs/promises'
import { writeAtomic } from '../../lib/writeAtomic'
import type { AppSettings } from '@shared/types/settings'

/**
 * Typed app settings backed by a single JSON file. Electron-agnostic: the file
 * path is injected, so it is fully testable against a temp dir. Writes are
 * atomic (temp file + rename), same pattern as ProjectRegistry.
 */
export class SettingsService {
  private settings: AppSettings = {}
  private loaded = false

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      this.settings = parsed && typeof parsed.settings === 'object' ? parsed.settings : {}
    } catch {
      this.settings = {} // missing/corrupt file → defaults
    }
    this.loaded = true
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch }
    await this.persist()
    return this.get()
  }

  private persist(): Promise<void> {
    return writeAtomic(this.file, JSON.stringify({ version: 1, settings: this.settings }, null, 2))
  }
}
