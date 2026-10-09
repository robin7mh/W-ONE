import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Encrypts values at rest (desktop: Electron safeStorage / OS keychain). */
export interface Cipher {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

/**
 * Secrets (the LLM API key) in one JSON file, mode 0600. With a cipher the
 * values are encrypted by the OS keychain (desktop); on a headless server the
 * file permissions are the protection — or pass the key via environment.
 * Values never leave the core: no channel ever returns a secret.
 */
export class SecretStore {
  private cache?: Record<string, string>

  constructor(
    private readonly file: string,
    private readonly cipher?: Cipher
  ) {}

  async get(name: string): Promise<string | undefined> {
    const stored = (await this.load())[name]
    if (stored === undefined) return undefined
    try {
      return this.cipher ? this.cipher.decrypt(stored) : stored
    } catch {
      return undefined // keychain changed — the user re-enters the key
    }
  }

  async set(name: string, value: string | null): Promise<void> {
    const all = { ...(await this.load()) }
    if (value === null) delete all[name]
    else all[name] = this.cipher ? this.cipher.encrypt(value) : value
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, encrypted: !!this.cipher, secrets: all }, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(tmp, this.file)
    this.cache = all
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      this.cache = parsed && typeof parsed.secrets === 'object' && parsed.secrets ? parsed.secrets : {}
    } catch {
      this.cache = {}
    }
    return this.cache!
  }
}
